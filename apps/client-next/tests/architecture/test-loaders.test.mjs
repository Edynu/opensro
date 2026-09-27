/*
===========================================================================

test-loaders.test.mjs - tests run the shipped sources, not private bundles

Tests load TypeScript sources through tests/helpers/native-source-loader.mjs:

	import '../helpers/native-source-loader.mjs';
	const { thing } = await import( '../../src/engine/.../thing.ts' );

A test that imports esbuild builds its own bundle of the sources instead,
which can diverge from what the client ships. legacy-test-loaders.txt lists
the files that still do. Each entry is `path` (legacy, waiting to migrate)
or `path # reason` (esbuild is the point of the test, for example a
mutation run through a build plugin). The ledger only shrinks: a new test
may not import esbuild without an entry, and an entry whose file no longer
imports esbuild must be removed.

===========================================================================
*/

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const clientRoot = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), "..", ".." );
const testsRoot = path.join( clientRoot, "tests" );
const ledgerPath = path.join( testsRoot, "architecture", "legacy-test-loaders.txt" );
const bundlesSources = /from\s*["']esbuild["']/;

/*
================
testFiles
================
*/
function testFiles( directory ) {
	const files = [];
	for ( const entry of readdirSync( directory, { withFileTypes: true } ) ) {
		const absolute = path.join( directory, entry.name );
		if ( entry.isDirectory() ) {
			if ( entry.name !== "fixtures" && entry.name !== "oracles" ) {
				files.push( ...testFiles( absolute ) );
			}
		} else if ( entry.name.endsWith( ".mjs" ) ) {
			files.push( absolute );
		}
	}
	return files;
}

/*
================
readLedger

Entry paths, without any trailing `# reason`.
================
*/
function readLedger() {
	return readFileSync( ledgerPath, "utf8" )
		.split( /\r?\n/ )
		.map( ( line ) => line.trim() )
		.filter( ( line ) => line.length > 0 && !line.startsWith( "#" ) )
		.map( ( line ) => line.split( " #" )[0].trim() );
}

test("tests load the shipped sources, and the esbuild ledger only shrinks", () => {
	const ledger = readLedger();
	const listed = new Set( ledger );
	const current = new Set(
		testFiles( testsRoot )
			.filter( ( file ) => bundlesSources.test( readFileSync( file, "utf8" ) ) )
			.map( ( file ) => path.relative( clientRoot, file ).split( path.sep ).join( "/" ) )
	);

	const added = [ ...current ].filter( ( file ) => !listed.has( file ) ).sort();
	const stale = ledger.filter( ( file ) => !current.has( file ) );

	assert.deepEqual(
		added,
		[],
		"these tests bundle sources with esbuild; import tests/helpers/native-source-loader.mjs instead, " +
			"or add `path # reason` to legacy-test-loaders.txt if esbuild is the point of the test"
	);
	assert.deepEqual(
		stale,
		[],
		"these ledger entries no longer import esbuild (or were removed); delete them from legacy-test-loaders.txt"
	);
});
