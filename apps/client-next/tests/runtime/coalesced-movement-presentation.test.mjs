/*
===========================================================================

coalesced-movement-presentation.test.mjs - navigation proof across a receipt

A click and its receipt can arrive before the next display frame. Exercise
the movement publisher and presentation together, without an intermediate
publication that the real main thread never received.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { product } from "../helpers/navigation-fixture.mjs";
const { createMovement } = await import(
	"../../src/engine/runtime/simulation/worker/session/world/gameplay/movement/movement.ts"
);
const { createPosePresentation } = await import( "../../src/engine/runtime/characters/pose-presentation.ts" );
const FROM = { regionId: 257, x: 100, y: 0, z: 100, angle: 0 };
const TO = { ...FROM, x: 200 };

/*
================
publish
================
*/
function publish( presentation, state ) {
	presentation.samples(
		new Map( [ [ 7, {
			atMs: state.poseAtMs,
			revision: state.movementRevision,
			moving: state.moving,
			from: state.movementPath?.from,
			to: state.movementPath?.to,
			transition: state.movementTransition
		} ] ] )
	);
}

test("a coalesced click and accepted receipt retain the admitted path behind the new anchor", () => {
	const movement = createMovement( () => {} ), navigation = product(), presentation = createPosePresentation();
	navigation.objects = [];
	movement.seed( FROM );
	movement.navigation( 257, navigation );
	presentation.origin( 0 );
	publish( presentation, movement.state() );
	presentation.pose( 7, FROM, 0 );
	movement.request( TO, 0 );
	movement.step( 16 );
	const predicted = movement.state().pose;
	movement.receive(
		new TextEncoder().encode( JSON.stringify( {
			v: 1,
			id: 1,
			gid: 7,
			accepted: true,
			serverTimeMs: 16,
			world: { spawn: TO, moveSegment: { from: FROM, startedAtMs: 0, arrivesAtMs: 2000 } }
		} ) ),
		16,
		7
	);
	const state = movement.state();
	assert.ok( state.pose && state.movementPath );
	assert.deepEqual( state.pose, predicted, "the receipt preserves the logical pose" );
	assert.ok( Math.abs( state.movementPath.from.x - 100.8 ) < 1e-9, "the logical walk remains rebased" );
	publish( presentation, state );
	assert.equal(
		presentation.pose( 7, state.pose, .02 ).x,
		FROM.x,
		"the first visible receipt must not snap over the unpublished start of the admitted path"
	);
	let previous = FROM.x;
	for ( let frame = 1; frame <= 60; frame++ ) {
		const shown = presentation.pose( 7, state.pose, .02 + frame / 240 );
		assert.ok( shown.x >= previous && shown.x <= state.pose.x );
		previous = shown.x;
	}
	assert.ok( Math.abs( previous - state.pose.x ) < .01 );
});

test("retained path evidence does not authorize a diagonal across a turn", () => {
	const presentation = createPosePresentation();
	presentation.origin( 0 );
	/** @type {import("../../src/engine/contracts/gameplay.ts").MovementTransition} */
	const transition = { relocation: 1, reason: "input", eligible: true };
	presentation.samples( new Map( [ [ 7, { atMs: 0, revision: 1, moving: false, transition } ] ] ) );
	presentation.pose( 7, FROM, 0 );
	const corner = { ...FROM, x: 101 }, target = { ...corner, z: 101 };
	presentation.samples(
		new Map( [ [ 7, {
			atMs: 16,
			revision: 2,
			moving: true,
			from: corner,
			to: { ...corner, z: 200 },
			transition: { ...transition, reason: "receipt", previousPath: { from: FROM, to: corner } }
		} ] ] )
	);
	const shown = presentation.pose( 7, target, .02 );
	assert.equal( shown.x, target.x );
	assert.equal( shown.z, target.z );
});
