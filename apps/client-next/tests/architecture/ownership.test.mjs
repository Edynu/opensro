/*
===========================================================================

ownership.test.mjs - the ownership and capability gates reject each escape

Each case appends one escape to a file of a seven-file fixture project that
both gates pass clean, and expects the specific issue it must raise. The
fixture keeps the real tree's shape where the rules look (bootstrap, runtime
root, platform and simulation modules, the UI text owner and a shared
contract), so the cases do not depend on the application sources: an edit
under src/ does not rerun them. The real tree is checked by the gates
themselves (verify:ownership, verify:capabilities).

===========================================================================
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { verifyOwnership } from "../../tools/verify-ownership.mjs";
import { verifyCapabilities } from "../../tools/verify-capabilities.mjs";

const BOOTSTRAP = "src/bootstrap.ts";
const RUNTIME = "src/engine/runtime/runtime.ts";
const PLATFORM = "src/engine/runtime/platform/platform.ts";
const HOST = "src/engine/runtime/simulation/host.ts";
const UI = "src/engine/runtime/ui/ui.ts";
const TEXT = "src/engine/runtime/ui/text/text.ts";
const SESSION = "src/engine/contracts/session.ts";

const SOURCES = {
	[BOOTSTRAP]: 'import "./engine/runtime/runtime";\n',
	[RUNTIME]: 'import "./platform/platform";\nimport "./simulation/host";\nimport "./ui/ui";\n',
	[PLATFORM]: "export function platform() { return 1; }\n",
	[HOST]: "export function createSimulationHost() { return 1; }\n",
	[UI]: 'import "./text/text";\n',
	[TEXT]: "export function text() { return 1; }\n",
	[SESSION]: "export interface Session { id: number; }\n"
};
const MANIFEST = {
	version: 1,
	root: RUNTIME,
	bootstrap: BOOTSTRAP,
	modules: { [RUNTIME]: BOOTSTRAP, [PLATFORM]: RUNTIME, [HOST]: RUNTIME, [UI]: RUNTIME, [TEXT]: UI },
	internals: {},
	workers: {},
	contracts: {}
};

/*
================
withFixture

Writes the fixture, applies one appended edit and hands the directory to fn.
A case that changes the project's shape passes its own sources and manifest.
================
*/
function withFixture( edit, fn, { sources = SOURCES, manifest = MANIFEST } = {} ) {
	const dir = fs.mkdtempSync( path.join( os.tmpdir(), "sro-ownership-" ) );
	const write = ( name, text ) => {
		fs.mkdirSync( path.dirname( path.join( dir, name ) ), { recursive: true } );
		fs.writeFileSync( path.join( dir, name ), text );
	};
	try {
		for ( const [name, text] of Object.entries( sources ) ) write( name, text );
		write( "src/engine/ownership.json", JSON.stringify( manifest ) );
		write( "execution-contract.json", "{}" );
		if ( edit ) fs.appendFileSync( path.join( dir, edit.file ), edit.code );
		return fn( dir );
	} finally {
		fs.rmSync( dir, { recursive: true, force: true } );
	}
}

/*
================
rejects

The edit must raise an issue naming its file and containing `expected`.
================
*/
function rejects( edit, check, expected ) {
	const issues = withFixture( edit, check );
	assert.ok(
		issues.some( issue => issue.includes( edit.file ) && issue.includes( expected ) ),
		`expected "${expected}" for ${edit.file}, got:\n${issues.join( "\n" )}`
	);
}

test("the fixture passes both gates clean", () => {
	withFixture( null, dir => {
		assert.deepEqual( verifyOwnership( dir ), [] );
		assert.deepEqual( verifyCapabilities( dir ), [] );
	} );
});

for (
	const [name, code, check, expected] of [
		[
			"sibling type import",
			'\nimport type { createSimulationHost } from "../simulation/host";',
			verifyOwnership,
			"forbidden import of " + HOST
		],
		[
			"legacy import",
			'\nimport "../../../../../../client/src/main";',
			verifyOwnership,
			"unresolved or external dependency"
		],
		[ "computed import", '\nconst target="x"; import(target);', verifyOwnership, "computed dynamic import" ],
		[
			"frame loop alias",
			"\nconst raf=requestAnimationFrame; raf(()=>{});",
			verifyCapabilities,
			"requestAnimationFrame"
		],
		[ "submission alias", "\nconst q:any={};const submit=q.submit; submit([]);", verifyCapabilities, "submit" ],
		[ "second frame loop", "\nrequestAnimationFrame(()=>{});", verifyCapabilities, "requestAnimationFrame" ],
		[
			"submission bypass",
			'\nconst q:any={};q["submit"]([]);',
			verifyCapabilities,
			"submit belongs to a different owner"
		],
		[
			"bundle creation outside owner",
			"\nconst encoder:any={};encoder.createRenderBundleEncoder({});",
			verifyCapabilities,
			"createRenderBundleEncoder"
		],
		[
			"bundle execution outside frame",
			"\nconst pass:any={};pass.executeBundles([]);",
			verifyCapabilities,
			"executeBundles"
		],
		[ "extra socket", '\nconst socket = new WebSocket("ws://localhost");', verifyCapabilities, "WebSocket" ],
		[
			"computed global socket",
			'\nconst socket = globalThis["Web"+"Socket"];',
			verifyCapabilities,
			"computed global capability access"
		],
		[
			"GPU allocator",
			"\nconst gpu:any={};gpu.createBuffer({size:4,usage:1});",
			verifyCapabilities,
			"createBuffer"
		],
		[ "GPU entry point", "\nconst stolen=navigator.gpu;", verifyCapabilities, "navigator.gpu" ],
		[ "extra timer", "\nsetTimeout(()=>{},0);", verifyCapabilities, "setTimeout" ],
		[ "raw device", "\nlet stolen:GPUDevice;", verifyCapabilities, "GPUDevice" ],
		[
			"async frame helper",
			"\nasync function hidden(){await Promise.resolve();}",
			verifyCapabilities,
			"asynchronous execution"
		]
	]
) {
	test(`reject ${name}`, () => rejects( { file: PLATFORM, code }, check, expected ));
}

test("reject shared mutable session cache", () => {
	rejects( { file: SESSION, code: "\nconst sessionCache = new Map();" }, verifyOwnership, "shared module state" );
});
test("reject shared top-level mutable counter", () => {
	rejects( { file: SESSION, code: "\nlet epoch = 0;" }, verifyOwnership, "shared module state" );
});
test("reject browser font rasterizer returning to UI text", () => {
	rejects(
		{ file: TEXT, code: "\nconst canvas = new OffscreenCanvas(2048,1024);" },
		verifyCapabilities,
		"OffscreenCanvas"
	);
});
test("reject browser text context returning to UI text", () => {
	rejects(
		{ file: TEXT, code: "\nconst canvas:any={}; canvas.getContext('2d');" },
		verifyCapabilities,
		"getContext"
	);
});
test("ordinary object methods do not crash capability checking", () => {
	withFixture( { file: PLATFORM, code: "\nconst text = ({}).toString();" }, dir => {
		assert.deepEqual( verifyCapabilities( dir ), [] );
	} );
});

/*
================
Readonly data tables cannot hide executable module state.
================
*/
test("admit readonly literal tables but reject mutable or executable tables", () => {
	withFixture(
		{ file: SESSION, code: "\nconst rows = [{id: 1, values: [-1, true, null]}] as const;" },
		dir => assert.deepEqual( verifyOwnership( dir ), [] )
	);
	for (
		const code of [
			"\nconst rows = [1];",
			"\nconst rows = [new Map()] as const;",
			"\nconst rows = [cache] as const;",
			"\nconst rows = {...cache} as const;"
		]
	) {
		rejects( { file: SESSION, code }, verifyOwnership, "shared module state" );
	}
});

/*
================
A worker entry builds its own instance of another owner's module only when
the manifest lists the module as that worker's replica.
================
*/
test("a worker imports another owner's module only as a listed replica", () => {
	const ENTRY = "src/engine/runtime/simulation/worker/entry.ts";
	const sources = {
		...SOURCES,
		[HOST]: "export function createSimulationHost() {\n" +
			'\treturn new Worker( new URL( "./worker/entry.ts", import.meta.url ), { type: "module" } );\n}\n',
		[ENTRY]: 'import { platform } from "../../platform/platform";\nplatform();\n'
	};
	const manifest = ( replicas ) => ({
		...MANIFEST,
		modules: { ...MANIFEST.modules, [ENTRY]: HOST },
		workers: { [ENTRY]: HOST },
		...(replicas ? { replicas } : {})
	});
	const ownership = replicas => withFixture( null, verifyOwnership, { sources, manifest: manifest( replicas ) } );
	assert.ok( ownership().some( issue => issue === `${ENTRY}: forbidden import of ${PLATFORM}` ) );
	assert.deepEqual( ownership( { [PLATFORM]: [ ENTRY ] } ), [] );
	// Only a worker entry may hold a replica, only of an owned module.
	assert.ok( ownership( { [PLATFORM]: [ UI ] } ).includes( `Invalid replica: ${PLATFORM} -> ${UI}` ) );
	assert.ok( ownership( { [SESSION]: [ ENTRY ] } ).includes( `Invalid replica: ${SESSION}` ) );
	assert.ok( ownership( { [PLATFORM]: [] } ).includes( `Invalid replica: ${PLATFORM}` ) );
	// A replica opens the module to its worker, not to its worker's siblings.
	withFixture(
		{ file: TEXT, code: '\nimport { platform } from "../../platform/platform";' },
		dir =>
			assert.ok( verifyOwnership( dir ).some( issue => issue === `${TEXT}: forbidden import of ${PLATFORM}` ) ),
		{ sources, manifest: manifest( { [PLATFORM]: [ ENTRY ] } ) }
	);
});
