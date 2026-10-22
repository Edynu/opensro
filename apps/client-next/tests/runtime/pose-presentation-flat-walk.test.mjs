/*
===========================================================================

pose-presentation-flat-walk.test.mjs - flat walking paths keep every drawn bit

pose-presentation.ts searches a walk's certified sample chain on flat
arrays instead of Pose objects. This drives the current module and the
frozen copy from before that change (tests/fixtures/pose-presentation-
before-flat-walk.ts) with the same seeded walks, receipts, corrections,
stalls and carries, outdoors across region borders and in a dungeon, and
requires every drawn pose to match bit for bit.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { pathToFileURL as sourceFileUrl } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
	SAMPLE_DISTANCE,
	TICK_MS,
	WALK_SPEED,
	alongWalk,
	chainOf,
	createRandom,
	createWalk,
	sameBits,
	sampleOf,
	shapedSample
} from "../helpers/walk-scenario.mjs";

const ACTORS = 12;
const FRAMES = 1500;

/*
================
load
================
*/
async function load( file ) {
	return (await import( sourceFileUrl( file ).href )).createPosePresentation;
}
const current = await load( "src/engine/runtime/characters/pose-presentation.ts" ),
	reference = await load( "tests/fixtures/pose-presentation-before-flat-walk.ts" );

test("flat walking paths draw every pose bit for bit as the object chain did", () => {
	const random = createRandom( 0x5eed );
	const a = current(), b = reference();
	a.origin( 0 );
	b.origin( 0 );
	// Points are SAMPLE_DISTANCE apart in the plane; hills lengthen the
	// chain, so walking this far always stays on it.
	const walks = Array.from( { length: ACTORS }, ( _, gid ) => {
		const walk = createWalk( random, gid );
		walk.length = (walk.points.length - 1) * SAMPLE_DISTANCE;
		return walk;
	} );
	const kinds = walks.map( () => random() );
	let now = 0, compared = 0;
	for ( let frame = 0; frame < FRAMES; frame++ ) {
		now += frame % 211 === 0 ? .3 : 1 / 240 + random() * (1 / 30);
		const samples = new Map();
		for ( let gid = 0; gid < ACTORS; gid++ ) {
			const walk = walks[gid];
			if ( frame % 97 === gid ) kinds[gid] = random();
			// The simulation publishes on its own ticks, behind the frame clock.
			const simulationMs = Math.floor( (now - .03) * 1000 / TICK_MS ) * TICK_MS;
			if ( simulationMs > walk.atMs ) {
				walk.walked = Math.min( walk.length, walk.walked + WALK_SPEED * (simulationMs - walk.atMs) / 1000 );
				walk.atMs = simulationMs;
				const at = alongWalk( walk, walk.walked );
				walk.published = walk.points.slice( 0, Math.min( walk.points.length, at.edge + 2 ) );
				walk.target = at.pose;
				// A receipt or correction re-anchors the walk a little behind,
				// on the chain, so the drawn body recovers along it.
				if ( random() < .08 ) {
					walk.revision++;
					walk.target = alongWalk( walk, Math.max( 0, walk.walked - random() * 6 ) ).pose;
				}
			}
			walk.target ??= walk.points[0];
			if ( frame % 53 !== gid ) samples.set( gid, sampleOf( random, walk, kinds[gid] ) );
		}
		a.samples( samples );
		b.samples( samples );
		for ( let gid = 0; gid < ACTORS; gid++ ) {
			const walk = walks[gid], target = walk.target;
			sameBits( a.pose( gid, target, now ), b.pose( gid, target, now ), `frame ${frame} gid ${gid}` );
			// Effects pose the same actor again in its frame (presentation-events.ts).
			if ( random() < .3 ) sameBits( a.pose( gid, target, now ), b.pose( gid, target, now ), `repeat ${frame}` );
			// A WAIT hold hands a drawn pose back (actor-motion.ts carry).
			if ( random() < .01 ) {
				const held = alongWalk( walk, Math.max( 0, walk.walked - 3 ) ).pose;
				a.carry( gid, held );
				b.carry( gid, held );
			}
			assert.equal( a.moving( gid ), b.moving( gid ) );
			compared++;
		}
	}
	assert.equal( compared, FRAMES * ACTORS );
});

test("every sample input shape draws the same bits as the object chain did", () => {
	const random = createRandom( 0xfeed );
	const a = current(), b = reference();
	const walks = Array.from( { length: ACTORS }, ( _, gid ) => {
		const walk = createWalk( random, gid );
		walk.length = (walk.points.length - 1) * SAMPLE_DISTANCE;
		walk.relocation = 0;
		walk.chain = walk.points.slice( 0, 2 );
		// A third of the actors never publish a chain (monsters off the
		// navmesh, skill legs), so corridors and held paths recover them.
		walk.chained = gid % 3 !== 0;
		walk.lag = .03;
		return walk;
	} );
	let now = 0;
	for ( let frame = 0; frame < FRAMES; frame++ ) {
		// The clock origin arrives after the first frames.
		if ( frame === 20 ) {
			a.origin( 0 );
			b.origin( 0 );
		}
		now += frame % 173 === 0 ? .4 : 1 / 240 + random() * (1 / 30);
		const samples = new Map();
		for ( let gid = 0; gid < ACTORS; gid++ ) {
			const walk = walks[gid];
			// Deliveries run 30 ms behind, sometimes 100 to 200 ms (a busy
			// worker), which re-anchors the sample clock.
			if ( random() < .02 ) walk.lag = .1 + random() * .1;
			else if ( random() < .1 ) walk.lag = .03;
			if ( random() < .02 ) walk.jitter = random() < .5 ? random() * .009 : .01 + random() * .5;
			const simulationMs = Math.floor( (now - walk.lag) * 1000 / TICK_MS ) * TICK_MS;
			if ( simulationMs > walk.atMs ) {
				walk.walked = Math.min( walk.length, walk.walked + WALK_SPEED * (simulationMs - walk.atMs) / 1000 );
				walk.atMs = simulationMs;
				const at = alongWalk( walk, walk.walked );
				// A republished chain is a new object; an unchanged one is reused.
				if ( random() < .3 ) walk.chain = walk.points.slice( 0, Math.min( walk.points.length, at.edge + 2 ) );
				walk.target = at.pose;
				walk.at = at;
				if ( random() < .08 ) {
					walk.revision++;
					walk.legStartedMs = simulationMs;
					walk.target = alongWalk( walk, Math.max( 0, walk.walked - random() * 6 ) ).pose;
				}
				// A server correction off the chain, now and then.
				if ( random() < .03 ) walk.target = { ...walk.target, x: walk.target.x + (random() - .5) * 3 };
			}
			walk.target ??= walk.points[0];
			walk.at ??= alongWalk( walk, 0 );
			if ( random() < .9 ) samples.set( gid, shapedSample( random, walk, walk.at, simulationMs ) );
		}
		a.samples( samples );
		b.samples( samples );
		for ( let gid = 0; gid < ACTORS; gid++ ) {
			const walk = walks[gid], target = walk.target, settled = random() < .03;
			sameBits(
				a.pose( gid, target, now, settled ),
				b.pose( gid, target, now, settled ),
				`frame ${frame} gid ${gid}`
			);
			if ( random() < .3 ) sameBits( a.pose( gid, target, now ), b.pose( gid, target, now ), `repeat ${frame}` );
			if ( random() < .02 ) {
				const held = alongWalk( walk, Math.max( 0, walk.walked - 3 ) ).pose;
				a.carry( gid, held );
				b.carry( gid, held );
			}
			// The object code returns the stored flag, possibly undefined; its
			// caller tests only its truth (actor-motion.ts).
			assert.equal( !!a.moving( gid ), !!b.moving( gid ), `moving ${frame} ${gid}` );
		}
		if ( frame % 400 === 399 ) {
			const kept = new Set( [ 0, 2, 4, 6, 8, 10 ] );
			a.retain( kept );
			b.retain( kept );
		}
	}
});

/*
================
turnAt

A point on a straight leg: fraction t of the way from a to b.
================
*/
function turnAt( a, b, t ) {
	return {
		regionId: a.regionId,
		x: a.x + (b.x - a.x) * t,
		y: a.y + (b.y - a.y) * t,
		z: a.z + (b.z - a.z) * t,
		angle: 0
	};
}

test("a turn recovers through its corner bit for bit as the object chain did", () => {
	// A walk A -> C without a chain; a receipt re-anchors it just past the
	// corner on C -> D while the body still draws before the corner, so the
	// correction is spent along both legs of the turn (recoverTurn).
	/** @type {[ number, string ][]} */
	const turns = [ [ .1, "correction" ], [ .3, "native" ], [ .05, "cast" ] ];
	for ( const [past, reason] of turns ) {
		const a = current(), b = reference();
		a.origin( 0 );
		b.origin( 0 );
		const A = { regionId: 24744, x: 100, y: 10, z: 500, angle: 0 };
		const C = { ...A, x: 140, z: 500 }, D = { ...A, x: 140, z: 540, y: 12 };
		const incoming = { from: A, to: C }, outgoing = { from: C, to: D };
		let now = 0, revision = 1;
		for ( let frame = 0; frame < 240; frame++ ) {
			now += 1 / 60;
			const atMs = Math.floor( (now - .03) * 1000 / TICK_MS ) * TICK_MS;
			const onIncoming = frame < 90;
			if ( frame === 90 ) revision++;
			const target = onIncoming ?
				turnAt( A, C, Math.min( 1, atMs / 1800 ) ) :
				turnAt( C, D, Math.min( 1, past + (frame - 90) / 300 ) );
			const input = onIncoming ?
				{ atMs, revision, moving: true, from: A, to: C, durationMs: 1800 } :
				{
					atMs,
					revision,
					moving: frame < 200,
					from: C,
					to: D,
					durationMs: 1800,
					transition: { relocation: 0, reason, eligible: true, turn: { incoming, outgoing } }
				};
			const samples = new Map( [ [ 1, input ] ] );
			a.samples( samples );
			b.samples( samples );
			sameBits( a.pose( 1, target, now ), b.pose( 1, target, now ), `${reason} frame ${frame}` );
		}
	}
});

test("predicted calls hand out the bits the calls in order would draw", () => {
	// The current presentation computes each requested character's next two
	// calls ahead (prepare); the frozen object code just makes the calls.
	// Every way a prediction can miss is exercised: another target (a cast
	// facing), a settled call, a carry between calls, a character prepared
	// but not posed this frame, an unprepared one, and extra calls.
	const random = createRandom( 0xc0de );
	const a = current(), b = reference();
	a.origin( 0 );
	b.origin( 0 );
	const walks = Array.from( { length: ACTORS }, ( _, gid ) => {
		const walk = createWalk( random, gid );
		walk.length = (walk.points.length - 1) * SAMPLE_DISTANCE;
		walk.relocation = 0;
		walk.chain = walk.points.slice( 0, 2 );
		walk.chained = gid % 3 !== 0;
		walk.lag = .03;
		return walk;
	} );
	let now = 0;
	for ( let frame = 0; frame < FRAMES; frame++ ) {
		now += frame % 173 === 0 ? .4 : 1 / 240 + random() * (1 / 30);
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
				if ( random() < .3 ) walk.chain = walk.points.slice( 0, Math.min( walk.points.length, at.edge + 2 ) );
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
		a.samples( samples );
		b.samples( samples );
		const requests = [];
		for ( let gid = 0; gid < ACTORS; gid++ ) {
			if ( random() < .7 ) requests.push( { gid, target: walks[gid].target } );
		}
		a.prepare( requests, now );
		for ( let gid = 0; gid < ACTORS; gid++ ) {
			// Now and then a prepared character is not posed this frame at all.
			if ( random() < .05 ) continue;
			const walk = walks[gid];
			const calls = 1 + Math.floor( random() * 3 );
			for ( let call = 0; call < calls; call++ ) {
				const facing = random() < .1;
				const target = facing ? { ...walk.target, angle: (walk.target.angle + 4000) % 65536 } : walk.target;
				const settled = random() < .03;
				sameBits(
					a.pose( gid, target, now, settled ),
					b.pose( gid, target, now, settled ),
					`frame ${frame} gid ${gid} call ${call}`
				);
				assert.equal( !!a.moving( gid ), !!b.moving( gid ), `moving ${frame} ${gid} ${call}` );
				if ( random() < .03 ) {
					const held = alongWalk( walk, Math.max( 0, walk.walked - 3 ) ).pose;
					a.carry( gid, held );
					b.carry( gid, held );
				}
			}
		}
		if ( frame % 400 === 399 ) {
			const kept = new Set( [ 1, 3, 5, 7, 9, 11 ] );
			a.retain( kept );
			b.retain( kept );
		}
	}
});

test("chains compacted while a prepare writes its inputs keep every pose exact", () => {
	// Long chains republished as new objects every frame overflow the walk
	// arena in the middle of a prepare's inputs, so it compacts while
	// earlier characters' inputs already name their chains.
	const random = createRandom( 0xa7e4 );
	const a = current(), b = reference();
	a.origin( 0 );
	b.origin( 0 );
	const actors = 200;
	const walks = Array.from( { length: actors }, ( _, gid ) => {
		let walk;
		do walk = createWalk( random, gid ); while ( walk.points.length < 200 );
		walk.length = (walk.points.length - 1) * SAMPLE_DISTANCE;
		return walk;
	} );
	let now = 0;
	for ( let frame = 0; frame < 60; frame++ ) {
		now += 1 / 60;
		const samples = new Map(), requests = [];
		for ( let gid = 0; gid < actors; gid++ ) {
			const walk = walks[gid];
			const simulationMs = Math.floor( (now - .03) * 1000 / TICK_MS ) * TICK_MS;
			walk.walked = Math.min( walk.length, walk.walked + WALK_SPEED / 60 );
			walk.atMs = simulationMs;
			walk.target = alongWalk( walk, walk.walked ).pose;
			const walkingPath = walk.points.slice();
			samples.set( gid, {
				atMs: simulationMs,
				revision: 1,
				moving: true,
				walkingPath,
				walkingChain: chainOf( walkingPath )
			} );
			requests.push( { gid, target: walk.target } );
		}
		a.samples( samples );
		b.samples( samples );
		a.prepare( requests, now );
		for ( let gid = 0; gid < actors; gid++ ) {
			for ( let call = 0; call < 2; call++ ) {
				sameBits(
					a.pose( gid, walks[gid].target, now ),
					b.pose( gid, walks[gid].target, now ),
					`frame ${frame} gid ${gid} call ${call}`
				);
			}
		}
	}
});
