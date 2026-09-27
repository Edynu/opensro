/*
===========================================================================

scenery-modifiers.test.mjs - tests for scenery-modifiers.ts,
texture-motion.ts, geometry.ts

Loads the TypeScript sources directly through the shared native loader
(tests/helpers/native-source-loader.mjs), so the tests exercise the same
modules the client ships, not a per-test bundle.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadDataAsset } from "../../../../scripts/build/shared/jmxAssetIO.mjs";
import { parseJmxResourceBsr } from "../../../../scripts/build/world/objects/formats.mjs";
import { defined } from "../helpers/defined.mjs";
const { sceneryMaterial } = await import( "../../src/engine/foundation/rendering/scenery-modifiers.ts" );
const { createTextureMotion } = await import( "../../src/engine/foundation/rendering/texture-motion.ts" );
const { copyMaterial } = await import( "../../src/engine/foundation/rendering/geometry.ts" );
const base = {
	color: [ .58, .58, .58, 1 ],
	alphaCutoff: 128 / 255,
	blend: false,
	doubleSided: false,
	objectFade: true
};
test("native waterfall retains alpha, depth policy, authored colors and signed UV velocity", async () => {
	const bytes = await loadDataAsset( "res/nature/particle/cj_waterfall02_01.bsr" );
	const { modifiers } = parseJmxResourceBsr( bytes );
	const warnings = [];
	const material = sceneryMaterial( base, modifiers, 0, m => warnings.push( m ) );
	assert.deepEqual( warnings, [] );
	assert.equal( material.blend, true );
	assert.equal( material.depthWrite, false );
	assert.equal( material.surfaceAlpha, true );
	assert.equal(
		material.alphaCutoff,
		base.alphaCutoff,
		"disabled modifier alpha-test override preserves the source policy"
	);
	assert.equal( material.doubleSided, true );
	assert.deepEqual( material.uvVelocity, [ 0, 0, 0, 0, 0, Math.fround( -1.91 ) ] );
	assert.equal( material.color[0], Math.fround( .58 ) );
	assert.equal( defined( material.ambient )[0], Math.fround( .58 ) );
	assert.equal( base.alphaCutoff, 128 / 255 );
	assert.equal( base.blend, false );
	const owned = copyMaterial( material );
	assert.notEqual( owned.uvVelocity, material.uvVelocity );
	const other = sceneryMaterial(
		base,
		{ materialModifiers: [], textureModifiers: defined( modifiers ).textureModifiers },
		1,
		() => {}
	);
	assert.equal( other.uvVelocity, undefined, "indexed UV modifier must not affect a sibling material" );
});
test("texture motion preserves shear, scrolling, float32 accumulation and stopped clocks", () => {
	const motion = createTextureMotion( [ .25, -.5, .75, 1, -2, 3 ] );
	const matrix = motion.matrix;
	assert.equal( motion.step( 10 ), false );
	assert.equal( motion.step( 10.5 ), true );
	assert.equal( motion.matrix, matrix );
	assert.deepEqual( [ ...matrix ], [ 1.125, .375, -1, 0, -.25, 1.5, 1.5, 0 ] );
	assert.equal( motion.step( 10.5 ), false );
	assert.throws( () => motion.step( NaN ) );
	motion.step( 11 );
	assert.deepEqual( [ ...matrix ], [ 1.25, .75, -2, 0, -.5, 2, 3, 0 ] );
});
test("truncated material and UV records cannot become partial scenery products", async () => {
	const bytes = await loadDataAsset( "res/nature/particle/waterfall-turtle01-1.bsr" );
	const begin = bytes.readUInt32LE( 0x24 ), end = defined( parseJmxResourceBsr( bytes ).modifiers ).next;
	for ( let n = begin; n < end; n++ ) {
		assert.throws( () => parseJmxResourceBsr( bytes.subarray( 0, n ) ), `truncation ${n}` );
	}
});

test("native NPC alpha comparisons, texture multiplication and untouched depth state survive projection", async () => {
	for (
		const [source, compare, squared] of [ [ "res/npc/npc/khotanshop_designer.bsr", 6, false ], [
			"res/npc/npc/centralasiashop_warehouse.bsr",
			8,
			false
		], [ "res/npc/npc/centralasiasystem_flyship.bsr", undefined, true ] ]
	) {
		const { modifiers } = parseJmxResourceBsr( await loadDataAsset( source ) );
		const modifier = defined( modifiers ).materialModifiers[0], warnings = [];
		const material = sceneryMaterial(
			{ ...base, depthWrite: false },
			modifiers,
			modifier.baseWords[3],
			m => warnings.push( m )
		);
		assert.deepEqual( warnings, [], source );
		assert.equal( material.alphaCompare, compare, source );
		assert.equal( material.textureAlphaSquared, squared, source );
		assert.equal( material.depthWrite, false, "zero override must not enable depth writes" );
		assert.doesNotThrow( () => copyMaterial( material ) );
	}
});
