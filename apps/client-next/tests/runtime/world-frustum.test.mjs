/*
===========================================================================

world-frustum.test.mjs - tests for world-math.ts

Loads the TypeScript sources directly through the shared native loader
(tests/helpers/native-source-loader.mjs), so the tests exercise the same
modules the client ships, not a per-test bundle.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { pathToFileURL as sourceFileUrl } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import { root } from "../../tools/project.mjs";

const { viewProjection, prepareViewFrustum, visibleFrustumBox, visibleFrustumAabb } = await import(
	sourceFileUrl( `${root}/src/engine/foundation/rendering/world-math.ts` ).href
);
test("transformed box rejection preserves the explicit eight-corner clip oracle under rotation, shear, scale and reflection", () => {
	let seed = 17;
	const random = () => ((seed = (Math.imul( seed, 1664525 ) + 1013904223) >>> 0) / 2 ** 32);
	let rejected = 0, accepted = 0;
	for ( let trial = 0; trial < 4000; trial++ ) {
		const view = viewProjection( {
				eye: [ 20, 30, -50 ],
				target: [ 0, 0, 0 ],
				near: 1,
				far: 3500,
				fov: Math.PI / 3
			}, 1.3 ),
			planes = prepareViewFrustum( view );
		const m = new Float32Array( 32 );
		for ( let c = 0; c < 3; c++ ) for ( let r = 0; r < 3; r++ ) m[16 + c * 4 + r] = (random() - .5) * 8;
		for ( let r = 0; r < 3; r++ ) m[28 + r] = (random() - .5) * 6000;
		m[31] = 1;
		const b = [ -random() * 200, -random() * 40, -random() * 80, random() * 200, random() * 40, random() * 80 ];
		const corners = Array.from( { length: 8 }, ( _, mask ) => {
			const local = [ b[mask & 1 ? 3 : 0], b[mask & 2 ? 4 : 1], b[mask & 4 ? 5 : 2] ];
			const world = Array.from(
				{ length: 3 },
				( _, r ) => m[28 + r] + local.reduce( ( sum, v, c ) => sum + v * m[16 + c * 4 + r], 0 )
			);
			return Array.from(
				{ length: 4 },
				( _, r ) => view[12 + r] + world.reduce( ( sum, v, c ) => sum + v * view[c * 4 + r], 0 )
			);
		} );
		const clipped = corners.map( ( [x, y, z, w] ) => [ w + x, w - x, w + y, w - y, z, w - z ] );
		const oracle = !Array.from( { length: 6 }, ( _, p ) => corners.every( ( _, i ) => clipped[i][p] < 0 ) ).some(
			Boolean
		);
		const visible = visibleFrustumBox( planes, b, m, 16 );
		if ( oracle ) {
			assert.ok( visible, `lost an intersecting box ${trial}` );
			accepted++;
		}
		if ( !visible ) {
			assert.equal( oracle, false );
			rejected++;
		}
	}
	assert.ok( rejected > 1000 && accepted > 100, "exercise both decisions" );
});

test("axis-aligned terrain rejection preserves an independent eight-corner plane oracle", () => {
	let seed = 2402033;
	const random = () => ((seed = (Math.imul( seed, 1664525 ) + 1013904223) >>> 0) / 2 ** 32);
	for ( let trial = 0; trial < 10000; trial++ ) {
		const x = (random() - .5) * 6000,
			y = (random() - .5) * 400,
			z = (random() - .5) * 6000,
			b = [ x, y, z, x + 320, y + random() * 600, z + 320 ];
		const f = prepareViewFrustum(
			viewProjection( {
				eye: [ 0, 40, 0 ],
				target: [ Math.sin( trial ), 0, Math.cos( trial ) ],
				near: 1,
				far: 3500,
				fov: Math.PI / 3
			}, 1.3 )
		);
		const corners = Array.from(
			{ length: 8 },
			( _, mask ) => [ b[mask & 1 ? 3 : 0], b[mask & 2 ? 4 : 1], b[mask & 4 ? 5 : 2] ]
		);
		const oracle = Array.from(
			{ length: 6 },
			( _, i ) =>
				corners.some( p => f[i * 5] * p[0] + f[i * 5 + 1] * p[1] + f[i * 5 + 2] * p[2] + f[i * 5 + 3] >= 0 )
		).every( Boolean );
		if ( oracle ) assert.ok( visibleFrustumAabb( f, b ), `seed 2402033 case ${trial}` );
	}
});
