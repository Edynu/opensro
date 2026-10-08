/*
===========================================================================

cos-hud.test.mjs - asset-independent clock cursor and confirmation lifecycle

The HUD nominates an occupied slot; the worker validates it on confirmation.
Targeting survives a closed inventory but not world exit or source replacement.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
const { createCosHud } = await import( "../../src/engine/runtime/ui/hud/cos-hud.ts" );

/*
================
clockItem
================
*/
function clockItem() {
	return {
		slot: 13,
		refObjId: 8985,
		typeFlags: 0x66ec,
		quantity: 1,
		plus: 0,
		durability: 0,
		variance: "0",
		magic: []
	};
}

test("clock targeting confirms any occupied slot exactly once", () => {
	for ( const slot of [ 0, 13, 14, 44 ] ) {
		const hud = createCosHud(), clock = clockItem();
		hud.armClock( clock );
		assert.equal( hud.clockCursor(), 0xa6 );
		assert.equal( hud.reconcileClock( [ clock ], true ), false );
		assert.equal( hud.chooseClockTarget( undefined ), false );
		assert.equal( hud.clockCursor(), 0xa6 );
		assert.equal( hud.chooseClockTarget( { ...clock, slot } ), true );
		assert.equal( hud.clockCursor(), null );
		assert.equal( hud.chooseClockTarget( { ...clock, slot: 45 } ), false );
		assert.deepEqual( hud.takeRenewal(), { kind: "item-use", slot: 13, summonerSlot: slot } );
		assert.equal( hud.takeRenewal(), null );
		assert.equal( hud.clockCursor(), null );
	}
});

test("clock cancellation and world/source changes clear both cursor and confirmation", () => {
	const clock = clockItem();
	for ( const confirmed of [ false, true ] ) {
		for ( const change of [ "cancel", "reset", "world", "removed", "replaced", "depleted" ] ) {
			const hud = createCosHud();
			hud.armClock( clock );
			if ( confirmed ) hud.chooseClockTarget( { ...clock, slot: 14 } );
			if ( change === "cancel" ) hud.takeRenewal();
			else if ( change === "reset" ) hud.reset();
			else {
				const items = change === "removed" ? [] : [ {
					...clock,
					refObjId: change === "replaced" ? 10 : clock.refObjId,
					quantity: change === "depleted" ? 0 : 1
				} ];
				assert.equal( hud.reconcileClock( items, change !== "world" ), true );
			}
			assert.equal( hud.clockCursor(), null, change );
			assert.equal( hud.renewal(), null, change );
			assert.equal( hud.chooseClockTarget( clock ), false, change );
		}
	}
});
