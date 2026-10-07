/*
===========================================================================

grab-pet-presentation.test.mjs - retained summoner slot states

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import assert from "node:assert/strict";
import test from "node:test";

const { createCompanionRentals } = await import(
	"../../src/engine/runtime/simulation/worker/session/world/gameplay/inventory/companion-rentals.ts"
);
const { itemSlotWash, itemSlotOverlays } = await import(
	"../../src/engine/foundation/ui/item-slot-effects.ts"
);

test("active pets glow; expired and dead pets are blue", () => {
	// 54FC80: the summoned state shows only the animated edge glow.
	assert.equal(
		itemSlotOverlays( { summon: { state: 2, remainingSeconds: 60 } }, [ 0, 0, 32, 32 ], 0, 0 ).length,
		1
	);
	for (
		const summon of [ { state: 4 }, { state: 3, remainingSeconds: 0 }, { state: 2, remainingSeconds: 0 }, {
			state: 1,
			remainingSeconds: 0
		} ]
	) {
		assert.deepEqual( itemSlotWash( { summon } ), [ 0, 0x4b / 255, 0x7e / 255, 0x80 / 255 ] );
		assert.deepEqual( itemSlotOverlays( { summon }, [ 0, 0, 32, 32 ], 0, 0 ), [] );
	}
	assert.equal( itemSlotWash( { summon: { state: 3 } } ), null );
});

test("rental countdown keeps its deadline and renewed bodies replace it", () => {
	const clock = createCompanionRentals();
	/** @type {import('../../src/engine/contracts/gameplay').InventoryItem} */
	let item = {
		slot: 13,
		refObjId: 1,
		typeFlags: 4300,
		quantity: 1,
		plus: 0,
		durability: 0,
		variance: "0",
		magic: [],
		summon: { state: 2, remainingSeconds: 2, rentals: [] }
	};
	assert.deepEqual( clock.step( [ item ], 100 ), [] );
	assert.deepEqual( clock.step( [ item ], 1099 ), [] );
	item = clock.step( [ item ], 1100 )[0];
	assert.ok( item.summon );
	assert.equal( item.summon.remainingSeconds, 1 );
	item = clock.step( [ item ], 2100 )[0];
	assert.ok( item.summon );
	assert.equal( item.summon.remainingSeconds, 0 );
	assert.deepEqual( itemSlotOverlays( item, [ 0, 0, 32, 32 ], 0, 0 ), [] );
	item = { ...item, summon: { ...item.summon, remainingSeconds: 60 } };
	assert.deepEqual( clock.step( [ item ], 2200 ), [] );
	assert.equal( clock.step( [ item ], 3200 )[0].summon?.remainingSeconds, 59 );
});
