/*
===========================================================================

bsr-particle-transform.test.mjs - tests for bsr-particle-transform.ts

Loads the TypeScript sources directly through the shared native loader
(tests/helpers/native-source-loader.mjs), so the tests exercise the same
modules the client ships, not a per-test bundle.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { pathToFileURL as sourceFileUrl } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const { bsrParticleRotation, bsrParticleTransform, bsrParticleRange, bsrParticleAttachment } = await import(
	sourceFileUrl( "src/engine/foundation/animation/bsr-particle-transform.ts" ).href
);
const identity = () => new Float32Array( [ 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 ] );
test("native root scaling differs from bone binding and rotation preserves attachment position", () => {
	const world = identity();
	world.set( [ 100, 200, 300 ], 12 );
	const root = bsrParticleTransform( world, null, [ 2, 3, 4 ], 2 );
	assert.deepEqual( [ ...root.matrix.slice( 12, 15 ) ], [ 104, 212, 308 ] );
	assert.equal( root.scale, 2 );
	const bone = identity();
	bone.set( [ 7, 8, 9 ], 12 );
	const bound = bsrParticleTransform( world, bone, [ 2, 3, 4 ], 2 );
	assert.deepEqual( [ ...bound.matrix.slice( 12, 15 ) ], [ 107, 208, 309 ] );
	const rotated = bsrParticleTransform( world, null, [ 2, 3, 4 ], 2, bsrParticleRotation( [ .2, .3, .4 ] ) );
	assert.deepEqual( [ ...rotated.matrix.slice( 12, 15 ) ], [ 104, 212, 308 ] );
	assert.notDeepEqual( [ ...rotated.matrix.slice( 0, 12 ) ], [ ...root.matrix.slice( 0, 12 ) ] );
	assert.deepEqual( [ ...world.slice( 12, 15 ) ], [ 100, 200, 300 ] );
	assert.deepEqual( [ ...bone.slice( 12, 15 ) ], [ 7, 8, 9 ] );
});
test("animation particle boundaries retain current-end keys and include previous-start keys exactly once", () => {
	const keys = [ 0, 50, 50, 100 ];
	assert.deepEqual( bsrParticleRange( keys, 0, 0 ), [] );
	assert.deepEqual( bsrParticleRange( keys, 0, 50 ), [ 0 ] );
	assert.deepEqual( bsrParticleRange( keys, 50, 100 ), [ 1, 2 ] );
	assert.deepEqual( bsrParticleRange( keys, 100, 101 ), [ 3 ] );
	assert.throws( () => bsrParticleRange( keys, 101, 0 ), /range/ );
});

test("imported root basis is removed and captured emitter scale remains distinct from later holder scale", () => {
	const parent = identity();
	parent[0] = -3;
	parent[5] = 3;
	parent[10] = -3;
	parent.set( [ 100, 200, 300 ], 12 );
	const attached = bsrParticleAttachment( parent, identity(), true, [ 2, 3, -4 ], 3, 2 );
	assert.deepEqual( [ ...attached.slice( 12, 15 ) ], [ 104, 212, 308 ] );
	assert.equal( attached[0], 2 );
	assert.equal( attached[5], 2 );
	assert.equal( attached[10], 2 );
	assert.deepEqual( [ ...parent.slice( 12, 15 ) ], [ 100, 200, 300 ] );
});
