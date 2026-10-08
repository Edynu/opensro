/*
===========================================================================

character-cloth-palette.test.mjs - palette sharing preserves rendered cloth

The frozen pre-optimization renderer output includes draw order, per-instance
palettes, cloth vertex bytes, materials and the native presentation RNG trace.
This is an old-versus-new behavioral oracle, not two copies of the new owner.

===========================================================================
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { captureClothPalettes } from "../helpers/character-cloth-palette-fixture.mjs";
const baseline = JSON.parse(
	readFileSync( new URL( "../fixtures/cloth/palette-owner-before.json", import.meta.url ), "utf8" )
);

test("moving cloth uploads current placements through membership, fade, lights, preview and device changes", () => {
	const actual = captureClothPalettes( false, false, { moving: true, variants: true } );
	assert.ok( actual.frames.every( frame => frame.draws === 0 || frame.clothPlacementWrites > 0 ) );
});

test("an unrelated lazy clip cannot reset standing peers' cloth state or random sequence", () => {
	const actual = captureClothPalettes( true, true );
	assert.deepEqual( actual.frames.map( frame => frame.digest ), baseline.frames );
	assert.ok( actual.gpuCalls > 0, "cloth batches offer their palettes to the GPU" );
});

for ( const gpuAvailable of [ false, true ] ) {
	test(`cloth and static palettes retain exact renderer output with GPU callback ${gpuAvailable}`, () => {
		const actual = captureClothPalettes( gpuAvailable );
		// Cloth batches offer their palettes to the GPU like any batch (the
		// fixture refuses, so CPU palettes stand); solver steps take their own.
		assert.equal( actual.gpuCalls > 0, gpuAvailable );
		assert.ok(
			actual.frames.some( frame => frame.pinsDraws > 0 ),
			"frames between solver steps must draw the GPU-skinned pins"
		);
		assert.equal( actual.frames.length, baseline.frames.length );
		assert.ok(
			actual.frames.some( frame => frame.draws > 0 && frame.clothPlacementWrites === 0 ),
			"retained cloth with unchanged placement must keep simulating without placement uploads"
		);
		assert.ok( actual.frames.some( frame => frame.poseEligibility.gpuSamples > 0 ) );
		for ( const frame of actual.frames ) {
			assert.equal( frame.poseEligibility.sharedPaletteSamples, frame.poseEligibility.gpuSamples );
			assert.equal( frame.poseEligibility.clothSamples, frame.poseEligibility.gpuSamples );
			assert.equal( frame.poseEligibility.gpuPaletteSamples, 0 );
		}
		assert.ok(
			actual.boneWriteBytes < baseline.boneWriteBytes,
			"identical body palettes must reduce real queue upload bytes while preserving rendered output"
		);
		for ( let frame = 0; frame < actual.frames.length; frame++ ) {
			for ( const [name, digest] of Object.entries( actual.frames[frame].primitives ) ) {
				assert.equal(
					digest,
					baseline.primitives[name][frame],
					`frame ${frame}, primitive ${name}: instance transforms, palettes or cloth vertices differ`
				);
			}
			assert.equal(
				actual.frames[frame].digest,
				baseline.frames[frame],
				`frame ${frame}: draw order, material or RNG differs`
			);
		}
		assert.ok( actual.frames.some( frame => frame.randomCalls > 0 ), "the oracle must exercise cloth RNG" );
	});
}

test("far cloth is GPU skinned in its model's batch and reaches the solver range with the native state", () => {
	// gid 3 stands beyond the state band (300 units), crosses it, and enters
	// the solver range (200 units); its twin waits in the band all along.
	const FAR = .5, BAND = .3, NEAR = 0;
	const walked = captureClothPalettes( true, false, {
		lod: ( frame, gid ) => gid !== 3 ? NEAR : frame < 40 ? FAR : frame < 45 ? BAND : NEAR
	} );
	const kept = captureClothPalettes( true, false, {
		lod: ( frame, gid ) => gid !== 3 ? NEAR : frame < 45 ? BAND : NEAR
	} );
	assert.ok( walked.frames.slice( 0, 40 ).some( frame => frame.clothShadingDraws > 0 ) );
	assert.ok( walked.frames.slice( 40 ).every( frame => frame.clothShadingDraws === 0 ) );
	assert.ok( kept.frames.every( frame => frame.clothShadingDraws === 0 ) );
	assert.ok( walked.frames.slice( 45 ).some( frame => frame.randomCalls > 0 ), "the solver must run after entry" );
	for ( let frame = 40; frame < walked.frames.length; frame++ ) {
		assert.equal( walked.frames[frame].digest, kept.frames[frame].digest, `frame ${frame} differs` );
	}
});
