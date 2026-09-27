/*
===========================================================================

Source Encoding Gate

Every maintained text source is UTF-8 without a byte-order mark and uses LF
line endings. PowerShell scripts are the exception to LF (.gitattributes
checks them out as CRLF) and must be ASCII-only, because Windows PowerShell
5.1 reads a BOM-less file in the ANSI codepage.

The usual way to break this is writing a file through Windows PowerShell 5.1
(`>`, Out-File, Set-Content), which emits the ANSI codepage or a BOM and CRLF.
That is how a "…" in scripts/build/shared/jmxAssetIO.mjs became two invalid
bytes. Write files with an editor, the agent's file tools, or Node/Python.

Data (testdata/, fixtures/, .json/.tsv/.txt) is out of this gate's scope:
its encoding belongs to its producer, and native captures may hold legacy
codepage bytes on purpose. Its line endings are still LF, because
.gitattributes stores every text file as LF; a test that hashes a data file
must hash the LF bytes a clean checkout produces.

`--fix` strips byte-order marks and converts CRLF to LF, the two transforms
that cannot change meaning. Invalid UTF-8 is reported and must be repaired by
hand, because only a person can tell what the bytes were meant to say.

===========================================================================
*/

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rebuildRoot = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), "..", ".." );

const SOURCE_ROOTS = [
	"apps",
	"scripts",
	"docs"
];

// Top-level files outside SOURCE_ROOTS that are maintained by hand.
const ROOT_FILE_EXTENSIONS = new Set( [ ".md", ".mjs", ".yaml", ".yml" ] );

const SOURCE_EXTENSIONS = new Set( [
	".c",
	".cc",
	".cjs",
	".cpp",
	".css",
	".cts",
	".go",
	".h",
	".hcl",
	".hpp",
	".html",
	".js",
	".jsx",
	".md",
	".mjs",
	".mts",
	".ps1",
	".psm1",
	".py",
	".scss",
	".sh",
	".ts",
	".tsx",
	".yaml",
	".yml"
] );

// PowerShell is Windows-native tooling: ASCII-only, and CRLF is allowed
// because .gitattributes checks it out that way (apps/server/.gitattributes).
const POWERSHELL_EXTENSIONS = new Set( [ ".ps1", ".psm1" ] );

const EXCLUDED_DIRECTORIES = new Set( [
	"__pycache__",
	"bin",
	"fixtures",
	"logs",
	"node_modules",
	"obj",
	"scratch",
	"temp",
	"testdata",
	"vendor"
] );

const UTF8_BOM = Buffer.from( [ 0xef, 0xbb, 0xbf ] );
const CARRIAGE_RETURN = 0x0d;

/*
================
collectSourceFiles
================
*/
function collectSourceFiles( directory, files ) {
	for ( const entry of readdirSync( directory, { withFileTypes: true } ) ) {
		const absolute = path.join( directory, entry.name );
		if ( entry.isDirectory() ) {
			if ( !EXCLUDED_DIRECTORIES.has( entry.name ) && !entry.name.startsWith( "." ) ) {
				collectSourceFiles( absolute, files );
			}
			continue;
		}
		if ( entry.isFile() && SOURCE_EXTENSIONS.has( path.extname( entry.name ).toLowerCase() ) ) {
			files.push( absolute );
		}
	}
}

/*
================
collectRootFiles
================
*/
function collectRootFiles( files ) {
	for ( const entry of readdirSync( rebuildRoot, { withFileTypes: true } ) ) {
		if ( entry.isFile() && ROOT_FILE_EXTENSIONS.has( path.extname( entry.name ).toLowerCase() ) ) {
			files.push( path.join( rebuildRoot, entry.name ) );
		}
	}
}

/*
================
isValidUtf8
================
*/
function isValidUtf8( bytes ) {
	try {
		new TextDecoder( "utf-8", { fatal: true } ).decode( bytes );
		return true;
	} catch {
		return false;
	}
}

/*
================
inspect

Returns the list of problems for one file's bytes.
================
*/
function inspect( bytes, extension ) {
	const problems = [];
	if ( bytes.subarray( 0, 3 ).equals( UTF8_BOM ) ) {
		problems.push( "byte-order mark" );
	}
	if ( bytes.includes( CARRIAGE_RETURN ) && !POWERSHELL_EXTENSIONS.has( extension ) ) {
		problems.push( "CR line endings" );
	}
	if ( !isValidUtf8( bytes ) ) {
		problems.push( "invalid UTF-8" );
	} else if ( POWERSHELL_EXTENSIONS.has( extension ) && bytes.some( ( byte ) => byte > 0x7f ) ) {
		problems.push( "non-ASCII in a PowerShell script" );
	}
	return problems;
}

/*
================
normalize

Strips a byte-order mark and converts CRLF to LF. Lone CRs are left alone:
they are not line endings, and removing them could change meaning.
================
*/
function normalize( bytes ) {
	const body = bytes.subarray( 0, 3 ).equals( UTF8_BOM ) ? bytes.subarray( 3 ) : bytes;
	return Buffer.from( body.toString( "latin1" ).replaceAll( "\r\n", "\n" ), "latin1" );
}

/*
================
main
================
*/
function main() {
	const fix = process.argv.includes( "--fix" );
	const files = [];

	for ( const root of SOURCE_ROOTS ) {
		const absolute = path.join( rebuildRoot, root );
		if ( !statSync( absolute, { throwIfNoEntry: false } )?.isDirectory() ) {
			throw new Error( `maintained source root is missing: ${root}` );
		}
		collectSourceFiles( absolute, files );
	}
	collectRootFiles( files );

	const failures = [];
	let fixed = 0;
	for ( const absolute of files.sort() ) {
		const relative = path.relative( rebuildRoot, absolute ).split( path.sep ).join( "/" );
		const extension = path.extname( absolute ).toLowerCase();
		let bytes = readFileSync( absolute );
		let problems = inspect( bytes, extension );

		if ( fix && problems.length > 0 ) {
			const normalized = normalize( bytes );
			if ( !normalized.equals( bytes ) ) {
				writeFileSync( absolute, normalized );
				bytes = normalized;
				fixed++;
				problems = inspect( bytes, extension );
			}
		}
		if ( problems.length > 0 ) {
			failures.push( `\t${relative}: ${problems.join( ", " )}` );
		}
	}

	if ( fix ) {
		process.stdout.write( `source-encoding: normalized ${fixed} file(s)\n` );
	}
	if ( failures.length > 0 ) {
		process.stderr.write(
			`${failures.length} source file(s) are not UTF-8 without BOM and LF:\n${failures.join( "\n" )}\n` +
				"Run `node scripts/checks/check_source_encoding.mjs --fix` for BOMs and CRLF; " +
				"repair invalid UTF-8 and non-ASCII PowerShell by hand.\n"
		);
		process.exit( 1 );
	}
	process.stdout.write( `source-encoding: ${files.length} maintained files are UTF-8, no BOM, LF\n` );
}

main();
