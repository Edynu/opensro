/*
===========================================================================

pick-volume-depth.test.mjs - tests for pick-volume.ts, picking.ts

Loads the TypeScript sources directly through the shared native loader
(tests/helpers/native-source-loader.mjs), so the tests exercise the same
modules the client ships, not a per-test bundle.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { defined } from "../helpers/defined.mjs";
const { pickVolumeDepth } = await import( "../../src/engine/foundation/rendering/pick-volume.ts" );
const { pickGeometry } = await import( "../../src/engine/foundation/rendering/picking.ts" );
const identity = () => Float32Array.of( 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 );
const bounds = [ -1, -2, -3, 1, 2, 3 ];
const box = {
	positions: Float32Array.of( -1, 2, 3, 1, 2, 3, 1, 2, -3, -1, 2, -3, -1, -2, 3, 1, -2, 3, 1, -2, -3, -1, -2, -3 ),
	indices: Uint32Array.of(
		0,
		1,
		2,
		0,
		2,
		3,
		3,
		2,
		6,
		3,
		6,
		7,
		2,
		1,
		5,
		2,
		5,
		6,
		1,
		0,
		4,
		1,
		4,
		5,
		0,
		3,
		7,
		0,
		7,
		4,
		7,
		6,
		5,
		7,
		5,
		4
	),
	transform: identity()
};
function compare( ray, m ) {
	const expected = pickGeometry( ray, box, m ), actual = pickVolumeDepth( ray, bounds, m );
	if ( expected === null ) assert.equal( actual, null );
	else {
		assert.notEqual( actual, null );
		assert.ok( Math.abs( defined( actual ) - expected ) < 1e-8, `${actual} != ${expected}` );
	}
}
test("box depth agrees with the old triangle path for reflected, scaled, rotated and sheared boxes", () => {
	const number = fc.double( { min: -20, max: 20, noNaN: true, noDefaultInfinity: true } );
	fc.assert(
		fc.property( fc.array( number, { minLength: 18, maxLength: 18 } ), values => {
			const m = identity();
			for ( let i = 0; i < 3; i++ ) for ( let j = 0; j < 3; j++ ) m[i * 4 + j] = values[i * 3 + j];
			for ( let i = 0; i < 3; i++ ) m[12 + i] = values[9 + i];
			compare( { start: values.slice( 12, 15 ), delta: values.slice( 15, 18 ) }, m );
		} ),
		{ seed: 2402026, numRuns: 4000 }
	);
});

test("shrunk seed 2402026 cases preserve subnormal transform and segment rejection", () => {
	for (
		const values of [
			[
				-7.006492321624087e-46,
				0,
				0,
				0,
				0,
				-7.006492321624087e-46,
				0,
				1.0141586244908805e-25,
				0,
				0,
				0,
				0,
				0,
				0,
				0,
				0,
				0,
				2.802596928649634e-45
			],
			[
				0,
				0,
				19.999999046325684,
				0,
				-2.500000062008294e-15,
				0,
				19.999999046325684,
				0,
				0,
				0,
				0,
				-19.999999046325684,
				0,
				0,
				0,
				0,
				0,
				-4.940656126623e-311
			]
		]
	) {
		const m = identity();
		for ( let i = 0; i < 3; i++ ) for ( let j = 0; j < 3; j++ ) m[i * 4 + j] = values[i * 3 + j];
		for ( let i = 0; i < 3; i++ ) m[12 + i] = values[9 + i];
		compare( { start: values.slice( 12, 15 ), delta: values.slice( 15, 18 ) }, m );
	}
});
test("finite surface depth preserves inside, boundary, parallel and flattened cases", () => {
	for (
		const ray of [
			{ start: [ 0, 0, 0 ], delta: [ 0, 0, 10 ] },
			{ start: [ 0, 0, 0 ], delta: [ 0, 0, 1 ] },
			{ start: [ 1, 0, 0 ], delta: [ 0, 0, 10 ] },
			{ start: [ 1, 2, -10 ], delta: [ 0, 0, 20 ] },
			{ start: [ 5, 0, 0 ], delta: [ 0, 0, 10 ] },
			{ start: [ 1, 0, 0 ], delta: [ 1, 0, 0 ] },
			{ start: [ 0, 0, 0 ], delta: [ 0, 0, 0 ] },
			{ start: [ 0, 0, -4 ], delta: [ 0, 0, 1 ] }
		]
	) {
		for ( const scale of [ 0, 1, -2 ] ) {
			const m = identity();
			m[0] = scale;
			compare( ray, m );
		}
	}
});
