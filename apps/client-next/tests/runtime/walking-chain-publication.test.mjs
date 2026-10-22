/*
===========================================================================

walking-chain-publication.test.mjs - walking histories leave the worker flat

A movement owner's history is up to 256 point objects, republished with
every sampled step of every moving character; the main thread decoded
them from each world batch. The simulation worker now publishes each
history as one flat array in the walk arena's entry layout
(walking-history.ts publishWalkingChains). These tests hold that the flat
form is the same numbers, that nothing else about a published value
changes, and that a batch carries it through the journal, a structured
clone and the main thread's projection into the pose samples.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

const { flattenWalkingPath, publishWalkingChains } = await import(
	"../../src/engine/foundation/gameplay/walking-history.ts"
);
const { POSE_WORDS } = await import( "../../src/engine/foundation/kernels/pose-record.ts" );
const { createEntities } = await import(
	"../../src/engine/runtime/simulation/worker/session/world/entities/entities.ts"
);
const { createPresentation } = await import( "../../src/engine/runtime/presentation/presentation.ts" );
const { createPresentationSamples } = await import( "../../src/engine/runtime/characters/presentation-samples.ts" );

/*
================
history

Points with fractional, negative and large coordinates, as navigation
samples them: a flat copy must keep every bit.
================
*/
function history( count, regionId = 24744 ) {
	return Array.from( { length: count }, ( _, i ) => ({
		regionId,
		x: 1000.1 + i * 1.3333333333333333,
		y: -32.608877927064896 + i / 7,
		z: 1416.134033203125 - i * Math.PI,
		angle: (25748 + i * 13) % 65536
	}) );
}

/*
================
assertSameChain
================
*/
function assertSameChain( chain, points ) {
	assert.ok( chain instanceof Float64Array );
	assert.equal( chain.length, 1 + points.length * POSE_WORDS );
	assert.equal( chain[0], points.length );
	points.forEach( ( point, i ) => {
		const at = 1 + i * POSE_WORDS;
		for ( const [offset, key] of [ "regionId", "x", "y", "z", "angle" ].entries() ) {
			assert.ok( Object.is( chain[at + offset], point[key] ), `point ${i} ${key}` );
		}
	} );
}

/*
================
walker
================
*/
function walker( gid, points ) {
	return {
		gid,
		refObjId: 1907,
		kind: "player",
		name: `Walker${gid}`,
		regionId: points.at( -1 ).regionId,
		x: points.at( -1 ).x,
		y: points.at( -1 ).y,
		z: points.at( -1 ).z,
		heading: points.at( -1 ).angle,
		equipment: [ { slot: 1, refObjId: 3640, typeFlags: 0, plus: 0 } ],
		moving: true,
		poseAtMs: 1200,
		movementRevision: 4,
		movementPath: { from: points.at( -2 ), to: points.at( -1 ), durationMs: 100, walkingPath: points }
	};
}

test("a published history is the same numbers, in the walk arena's entry layout", () => {
	for ( const count of [ 1, 2, 194, 256 ] ) {
		assertSameChain( flattenWalkingPath( history( count ) ), history( count ) );
	}
	const dungeon = history( 3, 0x8000 | 3 );
	assertSameChain( flattenWalkingPath( dungeon ), dungeon );
});

test("publication keeps every other field and object and leaves the worker's value as it was", () => {
	const chains = new WeakMap(), points = history( 40 ), worker = walker( 7, points );
	const published = publishWalkingChains( worker, chains );
	assert.notEqual( published, worker );
	assert.equal( published.movementPath.walkingPath, undefined );
	assert.ok( !("walkingPath" in published.movementPath) );
	assertSameChain( published.movementPath.walkingChain, points );
	assert.equal( published.movementPath.from, worker.movementPath.from, "leg ends keep their identity" );
	assert.equal( published.movementPath.to, worker.movementPath.to );
	assert.equal( published.movementPath.durationMs, 100 );
	assert.equal( published.equipment, worker.equipment );
	assert.ok( !("movementTransition" in published), "an absent field stays absent" );
	for ( const key of Object.keys( worker ) ) {
		if ( key !== "movementPath" ) assert.equal( published[key], worker[key], key );
	}
	assert.equal( worker.movementPath.walkingPath, points, "the movement owner keeps its own history" );
	assert.equal( worker.movementPath.walkingChain, undefined );

	const transition = { relocation: 2, reason: "receipt", eligible: true, walkingPath: points };
	const local = publishWalkingChains( { pose: points[0], movementTransition: transition }, chains );
	assert.equal( local.movementTransition.walkingChain, published.movementPath.walkingChain, "one chain per history" );
	assert.equal( local.movementTransition.relocation, 2 );
	assert.equal( transition.walkingPath, points );

	const still = { ...worker, movementPath: { from: points[0], to: points[0] } };
	assert.equal( publishWalkingChains( still, chains ), still, "a value without a history is published as it is" );
});

test("a batch carries flat histories through a structured clone into the pose samples", () => {
	const owner = createEntities(), presentation = createPresentation();
	const near = history( 194 ), far = history( 12, 24745 );
	const first = walker( 1, near );
	owner.publish( { kind: "spawn", entity: first } );
	owner.publish( { kind: "spawn", entity: walker( 2, far ) } );
	// A transition's retained history is the one presentation follows.
	const retained = history( 30 );
	owner.publish( {
		kind: "spawn",
		entity: {
			...walker( 3, far ),
			movementTransition: { relocation: 0, reason: "receipt", eligible: true, walkingPath: retained }
		}
	} );
	owner.publish( { kind: "state", entity: { ...walker( 1, near ), poseAtMs: 1250 } } );
	// postMessage delivers a structured clone of the batch.
	const batch = structuredClone( owner.take() );
	for ( const event of batch.events ) {
		assert.equal( event.entity.movementPath.walkingPath, undefined, "no point objects cross" );
		assert.equal( event.entity.movementTransition?.walkingPath, undefined );
	}
	assert.equal( batch.events[0].entity.movementPath.walkingChain, batch.events[3].entity.movementPath.walkingChain );
	presentation.apply( batch );
	const { samples } = createPresentationSamples( presentation.entities(), null );
	assertSameChain( samples.get( 1 ).walkingChain, near );
	assertSameChain( samples.get( 2 ).walkingChain, far );
	assertSameChain( samples.get( 3 ).walkingChain, retained );
	assertSameChain( samples.get( 3 ).transition.walkingChain, retained );
	assert.equal( samples.get( 1 ).atMs, 1250 );
	assert.equal( first.movementPath.walkingPath, near, "the journal keeps the worker's value" );
});
