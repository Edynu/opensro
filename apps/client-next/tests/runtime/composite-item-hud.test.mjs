/*
===========================================================================

composite-item-hud.test.mjs - the premium package window's geometry

Expectations are worked from 6AF780's constants (buttons at +0x1F/+0x3A,
150 x 25, 0x22 apart; tile, frame and window grown by 0x14, 0x22 and 0x24
per button from 0, 0x0F and 0x46), not read back from the source.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

const { compositeItemCaption, compositeItemLayout, createCompositeItemHud } = await import(
	"../../src/engine/runtime/ui/hud/composite-item-hud.ts"
);

test("6AF780 grows the window to its rows plus the cancel button", () => {
	const three = compositeItemLayout( 3 );
	assert.deepEqual( three.buttons, [ [ 31, 58, 150, 25 ], [ 31, 92, 150, 25 ], [ 31, 126, 150, 25 ], [
		31,
		160,
		150,
		25
	] ] );
	assert.equal( three.tileHeight, 80 );
	assert.equal( three.frameHeight, 151 );
	assert.equal( three.height, 214 );
	assert.equal( compositeItemLayout( 0 ).buttons.length, 1 );
});

test("a button reads the item name and its uses left", () => {
	assert.equal( compositeItemCaption( "Reverse return", 3 ), "Reverse return(3)" );
});

test("the window holds one package until it closes", () => {
	const hud = createCompositeItemHud();
	assert.equal( hud.packageId(), null );
	hud.open( 10130 );
	assert.equal( hud.packageId(), 10130 );
	hud.open( 10131 );
	assert.equal( hud.packageId(), 10131 );
	hud.close();
	assert.equal( hud.packageId(), null );
});
