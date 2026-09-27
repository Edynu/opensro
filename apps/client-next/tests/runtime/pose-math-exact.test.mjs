/*
===========================================================================

pose-math-exact.test.mjs - tests for pose-math.ts

Loads the TypeScript sources directly through the shared native loader
(tests/helpers/native-source-loader.mjs), so the tests exercise the same
modules the client ships, not a per-test bundle.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { pathToFileURL as sourceFileUrl } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const { multiply, multiplyDisjoint, compose, slerp } = await import(
	sourceFileUrl( "src/engine/foundation/math/pose-math.ts" ).href
);
const reference = ( a, b, out, offset = 0 ) => {
	for ( let c = 0; c < 4; c++ ) {
		for ( let r = 0; r < 4; r++ ) {
			let v = 0;
			for ( let k = 0; k < 4; k++ ) v += a[k * 4 + r] * b[c * 4 + k];
			out[offset + c * 4 + r] = v;
		}
	}
};
test("unrolled multiplication retains accumulation bits, offsets and alias read order", () => {
	let seed = 18;
	const random = () => ((seed = (Math.imul( seed, 1664525 ) + 1013904223) >>> 0) / 2 ** 32);
	for ( let trial = 0; trial < 300; trial++ ) {
		const a = Float32Array.from(
				{ length: 32 },
				() => random() > .1 ? (random() - .5) * 2 ** Math.floor( random() * 50 - 25 ) : -0
			),
			b = Float32Array.from( { length: 32 }, () => random() - .5 );
		for ( const alias of [ 0, 1, 2 ] ) {
			const x = a.slice(),
				y = b.slice(),
				u = a.slice(),
				v = b.slice(),
				out = alias === 1 ? x : alias === 2 ? y : new Float32Array( 32 ),
				expected = alias === 1 ? u : alias === 2 ? v : new Float32Array( 32 ),
				offset = trial % 2 * 16;
			reference( u, v, expected, offset );
			multiply( x, y, out, offset );
			assert.deepEqual( new Uint32Array( out.buffer ), new Uint32Array( expected.buffer ) );
			if ( !alias ) {
				out.fill( 0 );
				multiplyDisjoint( x, y, out, offset );
				assert.deepEqual( new Uint32Array( out.buffer ), new Uint32Array( expected.buffer ) );
			}
		}
	}
});
test("pose composition and offset quaternion sampling preserve source views", () => {
	const t = Float32Array.of( 3, 4, 5 ),
		q = Float32Array.of( .2, .3, -.4, .8 ),
		s = Float32Array.of( -2, .3, 4 ),
		out = new Float32Array( 32 ),
		length = Math.hypot( ...q ),
		[x, y, z, w] = [ ...q ].map( n => n / length );
	const expected = Float32Array.of(
		(1 - 2 * (y * y + z * z)) * s[0],
		2 * (x * y + z * w) * s[0],
		2 * (x * z - y * w) * s[0],
		0,
		2 * (x * y - z * w) * s[1],
		(1 - 2 * (x * x + z * z)) * s[1],
		2 * (y * z + x * w) * s[1],
		0,
		2 * (x * z + y * w) * s[2],
		2 * (y * z - x * w) * s[2],
		(1 - 2 * (x * x + y * y)) * s[2],
		0,
		...t,
		1
	);
	compose( t, q, s, out, 16 );
	assert.deepEqual( out.subarray( 16 ), expected );
	assert.throws( () => compose( t, q, s, new Float32Array( 15 ) ), RangeError );
	const input = Float32Array.of( ...q, ...q.map( n => -n ) );
	for ( const fraction of [ 0, .1, .5, .99, 1 ] ) {
		const a = new Float32Array( 4 ), b = new Float32Array( 4 );
		slerp( input.subarray( 0, 4 ), input.subarray( 4 ), fraction, a );
		slerp( input, input, fraction, b, 0, 4 );
		assert.deepEqual( a, b );
	}
});
