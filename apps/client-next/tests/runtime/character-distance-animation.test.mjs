/*
===========================================================================

character-distance-animation.test.mjs - the Experimental distance rate

Port-only, not native. Off, distance changes no rendered byte; on, actors
beyond 160 units keep their last skeleton sample between their 20 Hz (or
10 Hz) instants, and nearer actors are untouched.

===========================================================================
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { captureClothPalettes } from "../helpers/character-cloth-palette-fixture.mjs";

// gid 3 stands 176 units away (LOD fraction .22): inside cloth range, beyond
// the experimental rate's 160 units.
const DISTANT = ( frame, gid ) => gid === 3 ? .22 : 0;

/*
================
evaluations
================
*/
function evaluations( capture ) {
	return capture.frames.reduce( ( sum, frame ) => sum + frame.poseEvaluations, 0 );
}

test("with the option off, distance changes nothing", () => {
	const near = captureClothPalettes( true );
	const distant = captureClothPalettes( true, false, { lod: DISTANT } );
	assert.deepEqual( distant.frames.map( frame => frame.digest ), near.frames.map( frame => frame.digest ) );
	assert.equal( evaluations( distant ), evaluations( near ) );
});

test("with the option on, near actors are untouched", () => {
	const off = captureClothPalettes( true );
	const on = captureClothPalettes( true, false, { distanceAnimation: true } );
	assert.deepEqual( on.frames.map( frame => frame.digest ), off.frames.map( frame => frame.digest ) );
});

test("with the option on, a distant actor samples less often and keeps its last sample", () => {
	const off = captureClothPalettes( true, false, { lod: DISTANT } );
	const on = captureClothPalettes( true, false, { lod: DISTANT, distanceAnimation: true } );
	assert.ok( evaluations( on ) < evaluations( off ), `${evaluations( on )} vs ${evaluations( off )}` );
	assert.ok( on.frames.some( ( frame, i ) => frame.digest !== off.frames[i].digest ) );
});
