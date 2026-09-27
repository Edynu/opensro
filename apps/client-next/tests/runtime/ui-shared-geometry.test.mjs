/*
===========================================================================

ui-shared-geometry.test.mjs - tests for the client modules it imports

Loads the TypeScript sources directly through the shared native loader
(tests/helpers/native-source-loader.mjs), so the tests exercise the same
modules the client ships, not a per-test bundle.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { pathToFileURL as sourceFileUrl } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
async function load( file ) {
	return import( sourceFileUrl( "src/engine/foundation/ui/" + file + ".ts" ).href );
}
const { containsPoint, topmostControlAt } = await load( "hit-test" );
const { mainPopupFrame } = await load( "main-popup" );
const { authoredClientRect } = await load( "authored-layout" );
test("topmost hit preserves paint order, disabled occlusion and half-open edges", () => {
	const controls = [ { id: "under", rect: [ 0, 0, 20, 20 ] }, {
		id: "over",
		rect: [ 5, 5, 10, 10 ],
		disabled: true
	} ];
	assert.equal( topmostControlAt( controls, 5, 5 ), controls[1] );
	assert.equal( topmostControlAt( controls, 15, 10 ), controls[0] );
	assert.equal( topmostControlAt( controls, 20, 10 ), undefined );
	assert.equal( containsPoint( [ 0, 0, 0, 20 ], 0, 1 ), false );
	assert.deepEqual( controls.map( c => c.id ), [ "under", "over" ] );
});
test("main popup retains native minimum-left and overflow policy for small viewports", () => {
	assert.deepEqual( mainPopupFrame( 1600, 900, null ), [ 1212, 422, 388, 408 ] );
	assert.deepEqual( mainPopupFrame( 300, 240, null ), [ 42, 0, 388, 408 ] );
	assert.deepEqual( mainPopupFrame( 1600, 900, [ -100, 10000 ] ), [ 42, 492, 388, 408 ] );
	assert.deepEqual( mainPopupFrame( 1600, 900, [ 500, 200 ] ), [ 500, 200, 388, 408 ] );
});
test("authored client geometry preserves natural-size fallback and asymmetric insets", () => {
	const node = { rect: [ 3, 7, 0, 0 ], size: [ 100, 40 ], client: [ 2, 4, 8, 9 ] };
	assert.deepEqual( authoredClientRect( node, 10, 20 ), [ 15, 31, 90, 27 ] );
	assert.deepEqual( node.client, [ 2, 4, 8, 9 ] );
});
