/*
===========================================================================

owned-start.test.mjs - tests for owned-start.ts

Loads the TypeScript sources directly through the shared native loader
(tests/helpers/native-source-loader.mjs), so the tests exercise the same
modules the client ships, not a per-test bundle.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { pathToFileURL as sourceFileUrl } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";

const { ownedCellStart } = await import( sourceFileUrl( "src/engine/foundation/navigation/owned-start.ts" ).href );
const oracle = JSON.parse( fs.readFileSync( "tests/fixtures/native/native-owned-start-reference.json", "utf8" ) );
const mesh = { vertices: Float32Array.from( oracle.vertices.flat() ), cells: Uint16Array.of( 0, 1, 2 ) };
test("retained-cell start correction matches original native prefix including outside-hit aliasing", () => {
	assert.equal( oracle.binarySha256, "375e868234437e815af8ce9289ddea7ec9144430f4ea24e32988a6d6c9dd108a" );
	assert.equal(
		oracle.generatorSha256,
		createHash( "sha256" ).update( fs.readFileSync( "tools/native-owned-start-reference.py" ) ).digest( "hex" )
	);
	for ( const row of oracle.rows ) {
		assert.deepEqual( ownedCellStart( mesh, 0, ...row.point ), row.result, JSON.stringify( row ) );
	}
});
