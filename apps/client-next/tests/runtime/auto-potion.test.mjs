/*
===========================================================================

auto-potion.test.mjs - tests for the client modules it imports

Loads the TypeScript sources directly through the shared native loader
(tests/helpers/native-source-loader.mjs), so the tests exercise the same
modules the client ships, not a per-test bundle.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { pathToFileURL as sourceFileUrl } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
async function load( path ) {
	return import( sourceFileUrl( path ).href );
}
const p = await load( "src/engine/foundation/gameplay/auto-potion.ts" );
const { createGameplay } = await load( "src/engine/runtime/simulation/worker/session/world/gameplay/gameplay.ts" );
test("native potion defaults, packed bits and exact save bytes", () => {
	assert.deepEqual( p.admittedAutoPotion( { hp: 65535, mp: 65535, cure: 65535, timing: 0 } ), p.defaultAutoPotion() );
	assert.equal( p.admittedAutoPotion( { hp: 0, mp: 0, cure: 0, timing: 1 } ).hp, 0x3211 );
	assert.deepEqual( p.autoPotionEntry( 0xb211 ), { enabled: true, percent: 50, slot: 1 } );
	assert.equal( p.autoPotionEntry( 1 ).slot, 40 );
	for ( let slot = 0; slot <= 40; slot++ ) {
		for ( const enabled of [ false, true ] ) {
			for ( const percent of [ 0, 50, 100, 127 ] ) {
				assert.deepEqual( p.autoPotionEntry( p.autoPotionWord( { slot, enabled, percent } ) ), {
					slot,
					enabled,
					percent
				} );
			}
		}
	}
	const frame = p.autoPotionSave( { hp: 0xb211, mp: 0xb212, cure: 0x8013, timing: 0x8a } );
	assert.equal( frame.opcode, 0x7541 );
	assert.deepEqual( [ ...frame.payload ], [ 2, 17, 178, 18, 178, 19, 128, 138 ] );
	assert.equal( p.autoPotionDelay( { ...p.defaultAutoPotion(), timing: 127 } ), 500 );
	assert.equal( p.autoPotionDelay( { ...p.defaultAutoPotion(), timing: 255 } ), 12700 );
	for ( const value of [ -1, 65536, NaN, 1.5 ] ) {
		assert.throws( () => p.autoPotionSave( { hp: value, mp: 0, cure: 0, timing: 1 } ) );
	}
});
test("native HP, MP and cure condition branches remain independent", () => {
	const entry = { enabled: true, percent: 50, slot: 1 },
		facts = { alive: true, hp: 50, mp: 50, maxHp: 100, maxMp: 100, abnormal: 0 };
	assert.equal( p.autoPotionEligible( 0, entry, facts ), true );
	assert.equal( p.autoPotionEligible( 0, entry, { ...facts, hp: 51 } ), false );
	assert.equal( p.autoPotionEligible( 0, entry, { ...facts, abnormal: 32 } ), false );
	assert.equal( p.autoPotionEligible( 1, entry, { ...facts, abnormal: 32 } ), true );
	assert.equal( p.autoPotionEligible( 2, entry, facts ), false );
	assert.equal( p.autoPotionEligible( 2, entry, { ...facts, abnormal: 1 } ), true );
	assert.equal( p.autoPotionEligible( 2, entry, { ...facts, abnormal: 0x4001 } ), false );
	for ( const kind of [ 0, 1, 2 ] ) {
		assert.equal( p.autoPotionEligible( kind, entry, { ...facts, alive: false, abnormal: 1 } ), false );
	}
});
test("settings commit only after successful enqueue; bootstrap replaces configuration", () => {
	let reject = true;
	const frames = [],
		g = createGameplay( f => {
			if ( reject ) throw Error( "closed" );
			frames.push( f );
		} );
	g.bootstrap( {} );
	g.seed( { gid: 1, regionId: 1, x: 0, y: 0, z: 0, heading: 0 } );
	const settings = { hp: 0xb211, mp: 0x3212, cure: 0x13, timing: 0x8a };
	assert.throws( () => g.command( { kind: "auto-potion-save", settings }, 0 ), /closed/ );
	assert.deepEqual( g.take().autoPotion, p.defaultAutoPotion() );
	reject = false;
	g.command( { kind: "auto-potion-save", settings }, 1 );
	assert.deepEqual( g.take().autoPotion, settings );
	assert.equal( frames.length, 1 );
	g.bootstrap( { character: { autoPotion: { hp: 0, mp: 0, cure: 0, timing: 0 } } } );
	assert.deepEqual( g.take().autoPotion, p.defaultAutoPotion() );
	g.dispose();
});

function automatic() {
	const sent = [],
		g = createGameplay( f => sent.push( f ) ),
		local = { gid: 1, regionId: 257, x: 0, y: 0, z: 0, heading: 0, appearanceState: [ 1, 0, 0 ] };
	g.bootstrap( {
		character: {
			hp: 40,
			mp: 100,
			maxHp: 100,
			maxMp: 100,
			autoPotion: { hp: 0xb211, mp: 0x3212, cure: 0x13, timing: 0x8a },
			quickSlots: [ { slot: 1, kind: 0x46, payload: 0 } ]
		},
		refItemSnapshot: [ { refObjId: 1, typeFlags: 0xec, nativeFields: { useCooldownDuration528: 1500 } } ],
		equipItems: [ { slot: 13, refObjId: 1, body: [ 1, 0, 0, 0, 10, 0 ] } ]
	} );
	g.seed( local );
	return { sent, g, local };
}
function abnormal( mask ) {
	const payload = new Uint8Array( 11 ), v = new DataView( payload.buffer );
	v.setUint32( 0, 1, true );
	payload[6] = 4;
	v.setUint32( 7, mask, true );
	return { opcode: 0x33a6, payload };
}
test("automatic use respects the inventory transaction, timer, death and teardown", () => {
	const { sent, g, local } = automatic();
	g.step( 0, local );
	assert.equal( sent.length, 1 );
	assert.equal( sent[0].opcode, 0x75bd );
	assert.deepEqual( [ ...sent[0].payload ], [ 13, 0xec, 0 ] );
	g.step( 999, local );
	g.step( 1000, local );
	assert.equal( sent.length, 1, "pending use prevents duplicate requests" );
	g.receive( { opcode: 0xb5bd, payload: Uint8Array.of( 2, 1 ) }, 1001 );
	g.step( 1999, local );
	assert.equal( sent.length, 1 );
	g.step( 2000, local );
	assert.equal( sent.length, 2 );
	g.receive( { opcode: 0xb5bd, payload: Uint8Array.of( 2, 1 ) }, 2001 );
	g.step( 3000, { ...local, appearanceState: [ 2, 0, 0 ] } );
	assert.equal( sent.length, 2 );
	g.step( 3001, local );
	assert.equal( sent.length, 3 );
	g.resetWorld();
	g.step( 10000 );
	assert.equal( sent.length, 3 );
	g.dispose();
	g.step( 20000, local );
	assert.equal( sent.length, 3 );
});
test("normal abnormal-state updates block HP without disarming the native retry timer", () => {
	const { sent, g, local } = automatic();
	g.receive( abnormal( 0x20 ), 0 );
	g.step( 0, local );
	assert.equal( sent.length, 0 );
	g.receive( abnormal( 0 ), 100 );
	g.step( 100, local );
	assert.equal( sent.length, 0, "clearing block does not bypass the armed timer" );
	g.step( 1000, local );
	assert.equal( sent.length, 1 );
	g.dispose();
});
test("automatic binding cannot invoke a skill, equipment, or unrelated consumable family", () => {
	for ( const kind of [ 0, 0x49, 0x4a, 0x25 ] ) {
		assert.equal( p.autoPotionItemSlot( { kind, slot: 1, payload: 0 }, [ { slot: 13, typeFlags: 0xec } ] ), null );
	}
	for ( const tid of [ 0x2c, 0x6c, 0x1ec, 0x2ec ] ) {
		assert.equal(
			p.autoPotionItemSlot( { kind: 0x46, slot: 1, payload: 0 }, [ { slot: 13, typeFlags: tid } ] ),
			null
		);
	}
	for ( const tid of [ 0xec, 0x16c ] ) {
		assert.equal(
			p.autoPotionItemSlot( { kind: 0x46, slot: 1, payload: 0 }, [ { slot: 13, typeFlags: tid } ] ),
			13
		);
	}
});
