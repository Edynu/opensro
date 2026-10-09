/*
===========================================================================

sun-shadow-math.test.mjs - the experimental cascade's orthographic matrix

Property tests through the matrix, not of its spelling: points transform,
the cascade maps its volume to [0,1] axes, and the texel snap holds the
matrix steady between sub-texel camera steps.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

const { sunShadowMatrix, SHADOW_EXTENT, SHADOW_DEPTH, SHADOW_SIZE } = await import(
	"../../src/engine/foundation/rendering/sun-shadow-math.ts"
);

const DIAGONAL = [ 0.70710678, 0.70710678, 0 ];

/*
================
transform
================
*/
function transform( matrix, point ) {
	const out = [ 0, 0, 0 ];
	for ( let row = 0; row < 3; row++ ) {
		out[row] = (matrix[row] ?? 0) * (point[0] ?? 0) + (matrix[4 + row] ?? 0) * (point[1] ?? 0) +
			(matrix[8 + row] ?? 0) * (point[2] ?? 0) + (matrix[12 + row] ?? 0);
	}
	return out;
}

test("the eye sits at the cascade centre, mid-depth", () => {
	const matrix = sunShadowMatrix( [ 10, 20, 30 ], DIAGONAL );
	const eye = transform( matrix, [ 10, 20, 30 ] );
	// The centre snaps to whole cascade texels, so the eye holds within
	// half a texel of the NDC centre.
	const halfTexel = 1 / SHADOW_SIZE;
	assert.ok( Math.abs( eye[0] ) < halfTexel + 1e-9 && Math.abs( eye[1] ) < halfTexel + 1e-9, "NDC centre" );
	assert.ok( Math.abs( eye[2] - 0.5 ) < 1e-6, "mid-depth" );
});

test("the extent maps to the NDC border on both axes", () => {
	const matrix = sunShadowMatrix( [ 0, 0, 0 ], DIAGONAL, 100, 400 );
	// Each matrix row is its light axis scaled (row 0 by 1/extent, row 1
	// likewise), so a row times extent^2 is one extent along its axis.
	const right = [ matrix[0], matrix[4], matrix[8] ].map( v => v * 100 * 100 );
	const edge = transform( matrix, right );
	assert.ok( Math.abs( Math.abs( edge[0] ) - 1 ) < 1e-6, "right border" );
	assert.ok( Math.abs( edge[1] ) < 1e-6, "no cross-axis drift" );
	const up = [ matrix[1], matrix[5], matrix[9] ].map( v => v * 100 * 100 );
	const top = transform( matrix, up );
	assert.ok( Math.abs( Math.abs( top[1] ) - 1 ) < 1e-6, "up border" );
});

test("the depth span maps to [0,1] along the light", () => {
	const matrix = sunShadowMatrix( [ 0, 0, 0 ], DIAGONAL, SHADOW_EXTENT, SHADOW_DEPTH );
	// Row 2 is the light axis scaled by 1/(2*depth); times 2*depth^2 it is
	// one depth span along the light.
	const forward = [ matrix[2], matrix[6], matrix[10] ].map( v => v * 2 * SHADOW_DEPTH * SHADOW_DEPTH );
	const near = transform( matrix, forward.map( v => -v ) );
	const far = transform( matrix, forward );
	assert.ok( Math.abs( near[2] ) < 1e-6, "near face at 0" );
	assert.ok( Math.abs( far[2] - 1 ) < 1e-6, "far face at 1" );
});

test("sub-texel camera travel leaves the matrix unchanged; a full texel steps it", () => {
	const texel = 2 * SHADOW_EXTENT / SHADOW_SIZE;
	const steady = sunShadowMatrix( [ 0, 0, 0 ], DIAGONAL );
	const nudged = sunShadowMatrix( [ 0, 0, texel * 0.49 ], DIAGONAL );
	assert.deepEqual( nudged, steady, "half a texel snaps back" );
	const stepped = sunShadowMatrix( [ 0, 0, texel * 1.5 ], DIAGONAL );
	assert.notDeepEqual( stepped, steady, "over a texel the cascade follows" );
});

test("a vertical light tilts its basis instead of throwing", () => {
	const matrix = sunShadowMatrix( [ 5, 5, 5 ], [ 0, 1, 0 ] );
	const eye = transform( matrix, [ 5, 5, 5 ] );
	assert.ok( Math.abs( eye[2] - 0.5 ) < 1e-6 );
	assert.throws( () => sunShadowMatrix( [ 0, 0, 0 ], [ 0, 0, 0 ] ), "a lightless cascade is invalid" );
});

test("maximum follow zoom keeps the player and nearby ground inside the unfaded cascade", () => {
	const target = [ 3200, 120, -1920 ];
	const cameraDistance = 150, targetLift = 20, nearbyRadius = 100;
	const fullShadowNdc = 0.9;
	for ( const light of [ DIAGONAL, [ 0, 1, 0 ], [ 1, 0.1, 0 ] ] ) {
		for ( const yaw of [ 0, Math.PI / 2, Math.PI, Math.PI * 1.5 ] ) {
			for ( const pitch of [ 0.19, 0.9 ] ) {
				const eye = [
					target[0] + Math.sin( yaw ) * Math.cos( pitch ) * cameraDistance,
					target[1] + targetLift + Math.sin( pitch ) * cameraDistance,
					target[2] + Math.cos( yaw ) * Math.cos( pitch ) * cameraDistance
				];
				const matrix = sunShadowMatrix( eye, light );
				for ( const x of [ -nearbyRadius, 0, nearbyRadius ] ) {
					for ( const z of [ -nearbyRadius, 0, nearbyRadius ] ) {
						const point = transform( matrix, [ target[0] + x, target[1], target[2] + z ] );
						assert.ok( Math.abs( point[0] ) < fullShadowNdc, "ground stays within the horizontal fade" );
						assert.ok( Math.abs( point[1] ) < fullShadowNdc, "ground stays within the vertical fade" );
						assert.ok( point[2] > 0 && point[2] < 1, "ground stays between depth planes" );
					}
				}
			}
		}
	}
});
