/*
===========================================================================

pose-kernel-threads.test.mjs - the pose phase on worker threads, bit for bit

Two pose presentations see the same seeded frames: one runs its pose
phase on this thread, the other on real worker threads over shared,
growable memory (tests/helpers/frame-kernel-threads.mjs runs the shipping
frame-jobs loop and kernel dispatch, as the browser's frame workers do).
Every drawn pose must match bit for bit, with more characters than the
tables start with, so they grow while the workers hold views on them.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
	SAMPLE_DISTANCE,
	TICK_MS,
	WALK_SPEED,
	alongWalk,
	createRandom,
	createWalk,
	sameBits,
	shapedSample
} from "../helpers/walk-scenario.mjs";
import { createThreadedWorkers } from "../helpers/frame-kernel-threads.mjs";

const { createPosePresentation } = await import( "../../src/engine/runtime/characters/pose-presentation.ts" );
const { INITIAL_POSE_SLOTS } = await import( "../../src/engine/foundation/kernels/frame-kernels.ts" );

const THREADS = 4;
const ACTORS = 300;
const FRAMES = 240;

test("a pose phase on worker threads draws every pose as one thread does", async () => {
	assert.ok( ACTORS > INITIAL_POSE_SLOTS, "the tables must grow under the workers" );
	const workers = await createThreadedWorkers( THREADS );
	try {
		const random = createRandom( 0x7ead );
		const inline = createPosePresentation(), threaded = createPosePresentation( workers );
		inline.origin( 0 );
		threaded.origin( 0 );
		const walks = Array.from( { length: ACTORS }, ( _, gid ) => {
			const walk = createWalk( random, gid );
			walk.length = (walk.points.length - 1) * SAMPLE_DISTANCE;
			walk.relocation = 0;
			walk.chain = walk.points.slice( 0, 2 );
			walk.chained = gid % 3 !== 0;
			walk.lag = .03;
			return walk;
		} );
		let now = 0, compared = 0;
		for ( let frame = 0; frame < FRAMES; frame++ ) {
			now += frame % 97 === 0 ? .3 : 1 / 240 + random() * (1 / 30);
			const samples = new Map();
			for ( let gid = 0; gid < ACTORS; gid++ ) {
				const walk = walks[gid];
				if ( random() < .02 ) walk.lag = .1 + random() * .1;
				else if ( random() < .1 ) walk.lag = .03;
				const simulationMs = Math.floor( (now - walk.lag) * 1000 / TICK_MS ) * TICK_MS;
				if ( simulationMs > walk.atMs ) {
					walk.walked = Math.min( walk.length, walk.walked + WALK_SPEED * (simulationMs - walk.atMs) / 1000 );
					walk.atMs = simulationMs;
					const at = alongWalk( walk, walk.walked );
					// A republished chain is a new object, written to the arena again.
					if ( random() < .3 ) {
						walk.chain = walk.points.slice( 0, Math.min( walk.points.length, at.edge + 2 ) );
					}
					walk.target = at.pose;
					walk.at = at;
					if ( random() < .08 ) {
						walk.revision++;
						walk.legStartedMs = simulationMs;
						walk.target = alongWalk( walk, Math.max( 0, walk.walked - random() * 6 ) ).pose;
					}
				}
				walk.target ??= walk.points[0];
				walk.at ??= alongWalk( walk, 0 );
				if ( random() < .9 ) samples.set( gid, shapedSample( random, walk, walk.at, simulationMs ) );
			}
			inline.samples( samples );
			threaded.samples( samples );
			const requests = [];
			for ( let gid = 0; gid < ACTORS; gid++ ) {
				if ( random() < .8 ) requests.push( { gid, target: walks[gid].target } );
			}
			inline.prepare( requests, now );
			threaded.prepare( requests, now );
			for ( let gid = 0; gid < ACTORS; gid++ ) {
				const walk = walks[gid], calls = 1 + Math.floor( random() * 3 );
				for ( let call = 0; call < calls; call++ ) {
					const facing = random() < .05;
					const target = facing ? { ...walk.target, angle: (walk.target.angle + 4000) % 65536 } : walk.target;
					const settled = random() < .02;
					sameBits(
						threaded.pose( gid, target, now, settled ),
						inline.pose( gid, target, now, settled ),
						`frame ${frame} gid ${gid} call ${call}`
					);
					compared++;
				}
				assert.equal( threaded.moving( gid ), inline.moving( gid ), `moving ${frame} ${gid}` );
			}
		}
		assert.ok( workers.phases() === FRAMES, "every frame ran its pose phase on the threads" );
		assert.ok( compared > FRAMES * ACTORS );
	} finally {
		await workers.close();
	}
});
