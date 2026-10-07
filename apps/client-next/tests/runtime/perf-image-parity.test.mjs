/*
===========================================================================

perf-image-parity.test.mjs - byte-exact image acceptance and noise rejection

===========================================================================
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { compareImages, compareImageTriplet } from "../../tools/perf/core/image-parity.mjs";

test("exact images produce an opaque black difference image", () => {
	const pixels = Uint8Array.from( [ 15, 20, 35, 255, 200, 0, 4, 128 ] );
	const result = compareImages( pixels, pixels.slice(), 2, 1 );
	assert.equal( result.exact, true );
	assert.equal( result.changedPixels, 0 );
	assert.deepEqual( [ ...result.diff ], [ 0, 0, 0, 255, 0, 0, 0, 255 ] );
});

test("a single channel step and alpha-only change both fail exact parity", () => {
	const baseline = Uint8Array.from( [ 0, 0, 0, 255, 0, 0, 0, 255 ] );
	const changed = Uint8Array.from( [ 1, 0, 0, 255, 0, 0, 0, 254 ] );
	const result = compareImages( baseline, changed, 2, 1 );
	assert.equal( result.exact, false );
	assert.equal( result.changedPixels, 2 );
	assert.equal( result.changedChannels, 2 );
	assert.equal( result.maxChannelError, 1 );
	assert.equal( result.meanChannelError, .25 );
	assert.deepEqual( [ ...result.diff ], [ 255, 0, 255, 255, 255, 0, 255, 255 ] );
});

test("repeat noise never grants a candidate a larger exactness tolerance", () => {
	const baseline = Uint8Array.from( [ 0, 0, 0, 255 ] );
	const repeat = Uint8Array.from( [ 1, 0, 0, 255 ] );
	const candidate = baseline.slice();
	const result = compareImageTriplet( { baseline, repeat, candidate, width: 1, height: 1 } );
	assert.equal( result.change.exact, true );
	assert.equal( result.noise.exact, false );
	assert.equal( result.accepted, false );
});

test("malformed dimensions and truncated buffers cannot pass", () => {
	const pixels = new Uint8Array( 4 );
	assert.throws( () => compareImages( pixels, pixels, 0, 1 ) );
	assert.throws( () => compareImages( pixels, pixels, 1.5, 1 ) );
	assert.throws( () => compareImages( pixels, pixels, 2, 1 ) );
	assert.throws( () => compareImages( pixels, new Uint8Array( 3 ), 1, 1 ) );
});
