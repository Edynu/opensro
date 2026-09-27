/*
===========================================================================

star-flicker.test.mjs - tests for star-flicker.ts

Loads the TypeScript sources directly through the shared native loader
(tests/helpers/native-source-loader.mjs), so the tests exercise the same
modules the client ships, not a per-test bundle.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { pathToFileURL as sourceFileUrl } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { root } from "../../tools/project.mjs";
import { buildNativeSkyStarPrimitive } from "../../../../scripts/build/world/assets/copySkyImages.mjs";

const { advanceStarFlicker, initialStarFlicker } = await import(
	sourceFileUrl( path.join( root, "src/engine/foundation/rendering/star-flicker.ts" ) ).href
);
test("construction records every rejection trial; explicit continuation differs from WinMain reseeding", () => {
	const primitive = buildNativeSkyStarPrimitive();
	assert.equal( primitive.nativeRand.calls, 22780 );
	assert.equal( primitive.nativeRand.stateAfterConstruction, 3749729837 );
	// The accepted-point count alone would consume 18,000 draws, losing rejection trials.
	let state = 1;
	for ( let i = 0; i < primitive.nativeRand.calls; i++ ) {
		state = Number( (BigInt( state ) * 214013n + 2531011n) & 0xffffffffn );
	}
	assert.equal( state, primitive.nativeRand.stateAfterConstruction );
	const continued = advanceStarFlicker( initialStarFlicker( state ), 100, true ),
		restarted = advanceStarFlicker( initialStarFlicker( 1 ), 100, true );
	assert.notEqual( continued.random, restarted.random );
	assert.notDeepEqual( continued.bytes, restarted.bytes );
	assert.throws( () => buildNativeSkyStarPrimitive( -1 ) );
});
test("star timer gates ten batch trials, preserves remainders and skips catch-up rerolls", () => {
	const initial = { random: 1, tickMs: 0, bytes: Array( 10 ).fill( 255 ) };
	assert.equal( advanceStarFlicker( initial, 99, true ), initial );
	assert.equal( advanceStarFlicker( initial, 5000, false ), initial );
	const a = advanceStarFlicker( initial, 100, true ), b = advanceStarFlicker( initial, 599, true );
	assert.deepEqual( a.bytes, b.bytes );
	assert.equal( a.random, b.random );
	assert.equal( b.tickMs, 500 );
	assert.equal( advanceStarFlicker( b, 599, true ), b );
	assert.notEqual( advanceStarFlicker( b, 600, true ), b );
	assert.deepEqual( initial.bytes, Array( 10 ).fill( 255 ) );
	// Independent MSVCRT sequence: 41,18467,6334,26500 then 19169 updates
	// batch 3 to (19169&127)+128=225; remaining trials consume six values.
	assert.equal( a.bytes[3], 225 );
	assert.equal( a.bytes.filter( x => x !== 255 ).length, 1 );
});

test("conditional batch updates match emulated retail instructions across uint32 seeds", () => {
	const reference = JSON.parse(
		fs.readFileSync( path.join( root, "tests/fixtures/native/native-star-rng-reference.json" ), "utf8" )
	);
	assert.equal( reference.cases.length, 266 );
	for ( const row of reference.cases ) {
		const state = { random: row.seed, tickMs: 0, bytes: row.initial };
		const result = advanceStarFlicker( state, row.enabled ? 100 : 99, true );
		assert.equal( result.random, row.random, `seed ${row.seed}` );
		assert.deepEqual( result.bytes, row.values, `seed ${row.seed}` );
	}
});

test("invalid random state cannot silently coerce to another replay sequence", () => {
	const state = { random: 1, tickMs: 0, bytes: Array( 10 ).fill( 255 ) };
	for ( const random of [ -1, 2 ** 32, NaN, 1.5 ] ) {
		assert.throws( () => advanceStarFlicker( { ...state, random }, 100, true ) );
	}
	assert.throws( () => advanceStarFlicker( { ...state, tickMs: NaN }, 100, true ) );
	assert.throws( () => advanceStarFlicker( { ...state, bytes: Array( 10 ).fill( 256 ) }, 100, true ) );
});

test("native static-storage intensities begin at zero and only successful trials change them", () => {
	const initial = initialStarFlicker( 1, 0 );
	assert.deepEqual( initial.bytes, Array( 10 ).fill( 0 ) );
	const next = advanceStarFlicker( initial, 100, true );
	assert.equal( next.bytes[3], 225 );
	assert.equal( next.bytes.filter( n => n !== 0 ).length, 1 );
	assert.deepEqual( initial.bytes, Array( 10 ).fill( 0 ) );
	assert.throws( () => initialStarFlicker( -1 ) );
});
