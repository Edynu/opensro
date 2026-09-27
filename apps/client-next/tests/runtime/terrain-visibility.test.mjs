/*
===========================================================================

terrain-visibility.test.mjs - tests for terrain-visibility.ts, world-math.ts

Loads the TypeScript sources directly through the shared native loader
(tests/helpers/native-source-loader.mjs), so the tests exercise the same
modules the client ships, not a per-test bundle.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
const { createTerrainVisibility } = await import( "../../src/engine/foundation/rendering/terrain-visibility.ts" );
const { prepareViewFrustum, visibleFrustumSphere, visibleSphere, viewProjection } = await import(
	"../../src/engine/foundation/rendering/world-math.ts"
);
test("terrain material slices share only exact bounds and re-evaluate for every camera frame", () => {
	fc.assert(
		fc.property(
			fc.array(
				fc.tuple(
					fc.integer( { min: -1000, max: 1000 } ),
					fc.integer( { min: -1000, max: 1000 } ),
					fc.integer( { min: 0, max: 200 } )
				),
				{ minLength: 1, maxLength: 100 }
			),
			rows => {
				const owner = createTerrainVisibility(),
					volumes = rows.flatMap( ( [x, z, radius] ) =>
						Array.from( { length: 3 }, () => ({ center: [ x, 0, z ], radius }) )
					);
				for ( const volume of volumes ) owner.admit( volume );
				const indices = owner.indices( volumes );
				for ( const x of [ 0, 150, -300, 500 ] ) {
					const f = prepareViewFrustum(
							viewProjection( {
								eye: [ x, 10, 0 ],
								target: [ 0, 0, 900 ],
								fov: Math.PI / 3,
								near: 1,
								far: 2000
							}, 1 )
						),
						mask = owner.begin( f );
					for ( let i = 0; i < volumes.length; i++ ) {
						const v = volumes[i];
						assert.equal( owner.visible( v ), visibleFrustumSphere( f, ...v.center, v.radius ) );
						assert.equal( mask[indices[i]] === 1, owner.visible( v ) );
					}
					assert.equal( owner.stats().evaluations, owner.stats().volumes );
				}
			}
		),
		{ seed: 2402031, numRuns: 1000 }
	);
});
test("compiled slots survive admission growth without retaining a stale mask", () => {
	const owner = createTerrainVisibility(), first = { center: [ 0, 0, 20 ], radius: 1 };
	owner.admit( first );
	const indices = owner.indices( [ first ] ),
		f = prepareViewFrustum(
			viewProjection( { eye: [ 0, 0, 0 ], target: [ 0, 0, 100 ], fov: Math.PI / 3, near: 1, far: 2000 }, 1 )
		);
	const old = owner.begin( f );
	for ( let i = 0; i < 100; i++ ) owner.admit( { center: [ i * 100, 0, 20 ], radius: 2 } );
	const next = owner.begin( f );
	assert.notEqual( old, next );
	assert.equal( next[indices[0]], 1 );
	assert.throws( () => owner.indices( [ { center: [ 0, 0, 20 ], radius: 1 } ] ), /not admitted/ );
});

test("shared character frustum exactly preserves per-actor sphere decisions", () => {
	fc.assert(
		fc.property(
			fc.tuple(
				fc.integer( { min: -4000, max: 4000 } ),
				fc.integer( { min: -1000, max: 1000 } ),
				fc.integer( { min: -4000, max: 4000 } ),
				fc.integer( { min: 0, max: 3000 } )
			),
			fc.integer( { min: -1000, max: 1000 } ),
			( [x, y, z, radius], heading ) => {
				const angle = heading / 100,
					view = viewProjection( {
						eye: [ 30, 80, -200 ],
						target: [ 30 + Math.sin( angle ) * 100, 20, -200 + Math.cos( angle ) * 100 ],
						fov: Math.PI / 3,
						near: 1,
						far: 4000
					}, 1.3 );
				assert.equal(
					visibleFrustumSphere( prepareViewFrustum( view ), x, y, z, radius ),
					visibleSphere( view, [ x, y, z ], radius )
				);
			}
		),
		{ seed: 2402034, numRuns: 10000 }
	);
});
