/*
===========================================================================

Go Server Verification Gate

Module hygiene (`go mod tidy -diff`, gofmt, `go vet`), golangci-lint
(.golangci.yml; pinned in its own tool module, tools/golangci-lint/go.mod, so
the repository's Go toolchain builds it), then every package returned by
`go list ./...` in bounded sequential shards, the race detector on the
concurrency-owning packages, and govulncheck (pinned in go.mod as a tool).

Tests run in shards because on Windows a monolithic `go test ./...`
oversubscribes archive-backed integration suites and can thrash for many
minutes; eight-package shards preserve the complete dynamic package set while bounding compiler,
filesystem, and database concurrency.

On Windows every Go command runs with the C compiler's own directory first
on PATH. Git for Windows ships older copies of the MinGW runtime DLLs in
Git\mingw64\bin, and a Git-launched shell (Git Bash, the pre-push hook) puts
that directory first. gcc's cc1 then loads the wrong DLLs and dies silently,
Go's probe of the external linker fails, and Go falls back to legacy link
flags that leave ASLR on - which ThreadSanitizer cannot run under
("failed to allocate ... error code: 87"). Pinning the compiler's directory
makes the race step independent of how the gate was launched.

===========================================================================
*/

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname( fileURLToPath( import.meta.url ) );
const rebuildRoot = path.resolve( scriptDirectory, "..", ".." );
const serverRoot = path.join( rebuildRoot, "apps", "server" );
const batchSize = positiveInteger( process.env.SRO_GO_TEST_BATCH_SIZE, 8 );
const packageParallelism = positiveInteger( process.env.SRO_GO_TEST_PARALLELISM, 2 );
const startedAt = performance.now();
const lintModfile = "tools/golangci-lint/go.mod";
const goEnvironment = compilerFirstEnvironment();
const racePackages = [
	"./internal/agent/api",
	"./internal/agent/server",
	"./internal/security/auth",
	"./internal/transport/worldsession",
	"./internal/cluster/shard",
	"./internal/data/store",
	"./internal/transport"
];

runGo( [ "mod", "tidy", "-diff" ], true );
runGo( [ "-C", path.dirname( lintModfile ), "mod", "tidy", "-diff" ], true );
const unformatted = run( "gofmt", [ "-l", "cmd", "internal" ], true ).stdout.trim();
if ( unformatted ) {
	throw new Error( `gofmt: unformatted files:\n${unformatted}` );
}
runGo( [ "vet", "./..." ], false );
runGo( [ "tool", `-modfile=${lintModfile}`, "golangci-lint", "run", "./..." ], false );
console.log( "server hygiene: tidy, gofmt, vet and golangci-lint passed" );

const listed = runGo( [ "list", "./..." ], true );
const packages = listed.stdout.trim().split( /\r?\n/ ).filter( Boolean );

if ( packages.length === 0 ) {
	throw new Error( "Go server package discovery returned no packages" );
}

for ( let offset = 0; offset < packages.length; offset += batchSize ) {
	const batch = packages.slice( offset, offset + batchSize );
	const first = offset + 1;
	const last = offset + batch.length;
	const batchStartedAt = performance.now();

	// These integration tests open the verified game-data projection. Go's
	// result-cache validation re-stats/re-hashes that large input set and is
	// slower than executing the tests; -count=1 keeps build caching but makes
	// every assertion run instead of paying to replay a stale result.
	runGo( [ "test", "-count=1", `-p=${packageParallelism}`, ...batch ], false );
	console.log(
		`server tests: packages ${first}-${last}/${packages.length} passed ` +
			`in ${formatSeconds( performance.now() - batchStartedAt )}s`
	);
}

runGo( [ "test", "-race", "-count=1", ...racePackages ], false );
console.log( "server race tests: passed" );
runGo( [ "tool", "govulncheck", "./..." ], false );

console.log(
	`server gates: PASS (${packages.length} packages, ${batchSize}/shard, ` +
		`${packageParallelism} package workers, ${formatSeconds( performance.now() - startedAt )}s)`
);

/*
================
runGo
================
*/
/**
 * @param {string[]} args
 * @param {boolean} capture
 * @returns {import("node:child_process").SpawnSyncReturns<string>}
 */
function runGo( args, capture ) {
	return run( "go", args, capture );
}

/*
================
run
================
*/
/**
 * @param {string} command
 * @param {string[]} args
 * @param {boolean} capture
 * @returns {import("node:child_process").SpawnSyncReturns<string>}
 */
function run( command, args, capture ) {
	const result = spawnSync( command, args, {
		cwd: serverRoot,
		encoding: "utf8",
		env: goEnvironment,
		stdio: capture ? "pipe" : "inherit"
	} );
	if ( result.error ) {
		throw result.error;
	}
	if ( result.status !== 0 ) {
		if ( capture ) {
			process.stdout.write( result.stdout ?? "" );
			process.stderr.write( result.stderr ?? "" );
		}
		throw new Error( `${command} ${args.join( " " )} exited ${result.status}` );
	}
	return result;
}

/*
================
compilerFirstEnvironment

Returns the process environment with the directory of Go's C compiler
(`go env CC`, resolved on PATH) moved to the front of PATH on Windows, so
the compiler loads its own runtime DLLs. Elsewhere, or when the compiler
cannot be found, the environment is returned unchanged and Go reports the
missing compiler itself.
================
*/
function compilerFirstEnvironment() {
	if ( process.platform !== "win32" ) {
		return process.env;
	}
	const compiler = spawnSync( "go", [ "env", "CC" ], { cwd: serverRoot, encoding: "utf8" } ).stdout?.trim() || "gcc";
	const located = spawnSync( "where.exe", [ compiler ], { encoding: "utf8" } );
	const compilerPath = located.status === 0 ? located.stdout.split( /\r?\n/ )[0].trim() : "";
	if ( compilerPath.length === 0 ) {
		return process.env;
	}

	const pathKey = Object.keys( process.env ).find( ( key ) => key.toUpperCase() === "PATH" ) ?? "PATH";
	return {
		...process.env,
		[pathKey]: `${path.dirname( compilerPath )}${path.delimiter}${process.env[pathKey] ?? ""}`
	};
}

/*
================
positiveInteger
================
*/
/**
 * @param {string | undefined} value
 * @param {number} fallback
 */
function positiveInteger( value, fallback ) {
	const parsed = Number( value );
	return Number.isInteger( parsed ) && parsed > 0 ? parsed : fallback;
}

/*
================
formatSeconds
================
*/
/** @param {number} elapsedMs */
function formatSeconds( elapsedMs ) {
	return (elapsedMs / 1000).toFixed( 1 );
}
