/*
===========================================================================

fortress-appearance.test.mjs - tests for fortress-appearance.ts

Loads the TypeScript sources directly through the shared native loader
(tests/helpers/native-source-loader.mjs), so the tests exercise the same
modules the client ships, not a per-test bundle.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { pathToFileURL as sourceFileUrl } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const { fortressAppearance: f } = await import(
	sourceFileUrl( "src/engine/foundation/animation/fortress-appearance.ts" ).href
);
const state = {
	worldId: 1,
	worlds: [ { id: 1, code: "war" } ],
	fortresses: [ { id: 99, code: "war" } ],
	wars: [ { id: 99, flags: 1 } ],
	registered: [ 10 ],
	listId: 99
};
test("uniforms use guild relations, not fortress IDs; empty registry is neutral", () => {
	assert.equal( f( -1, 255, 255, false, state, 10, 10, [] ), 0 );
	assert.equal( f( -1, 255, 255, false, state, 10, 20, [] ), 3 );
	assert.equal( f( -1, 255, 255, false, state, 20, 10, [] ), 3 );
	assert.equal( f( -1, 255, 255, false, state, 20, 30, [] ), 4 );
	assert.equal( f( -1, 255, 255, false, state, 20, 30, [ 30 ] ), 0 );
	assert.equal( f( -1, 255, 255, false, state, 20, 20, [] ), 0 );
	assert.equal( f( 3, 255, 255, false, { ...state, registered: [] }, 20, 30, [] ), 0 );
	assert.equal( f( 3, 255, 255, false, state, 0, 30, [] ), 0 );
});
test("war end and normal-clothes restore, team precedence and no-write are exact", () => {
	assert.equal( f( 3, 255, 255, true, state, 10, 20, [] ), -1 );
	assert.equal( f( 3, 255, 255, false, { ...state, wars: [] }, 10, 20, [] ), -1 );
	for ( const normal of [ false, true ] ) {
		for ( const war of [ state, undefined ] ) {
			assert.equal( f( -1, 0, 0, normal, war, 0, 0, [] ), 3 );
			assert.equal( f( 3, 0, 1, normal, war, 0, 0, [] ), 4 );
			assert.equal( f( 4, 0, 255, normal, war, 0, 0, [] ), 4 );
			assert.equal( f( -1, 0, 2, normal, war, 0, 0, [] ), -1 );
		}
	}
});
