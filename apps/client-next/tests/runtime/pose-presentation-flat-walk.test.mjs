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

const REGION_SIZE = 1920;
const DUNGEON_REGION = 0x8000 | 3;
const ACTORS = 12;
const FRAMES = 1500;
// Chain points are one SAMPLE_DISTANCE apart (walking-history.ts).
const SAMPLE_DISTANCE = 2;
const MAX_POINTS = 256;
const WALK_SPEED = 30;
const TICK_MS = 50;

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

/*
================
createRandom
================
*/
function createRandom( seed ) {
	return () => (seed = (Math.imul( seed, 1664525 ) + 1013904223) >>> 0) / 2 ** 32;
}

/*
================
regionPose

A pose at world coordinates: outdoors re-anchored to its sector, in a
dungeon kept local.
================
*/
function regionPose( dungeon, wx, y, wz, angle ) {
	if ( dungeon ) return { regionId: DUNGEON_REGION, x: wx, y, z: wz, angle };
	const rx = Math.floor( wx / REGION_SIZE ), rz = Math.floor( wz / REGION_SIZE );
	return { regionId: rx | (rz << 8), x: wx - rx * REGION_SIZE, y, z: wz - rz * REGION_SIZE, angle };
}

/*
================
createWalk

One actor's walk: a chain with hills and turns, started near a sector
corner outdoors so it crosses region borders, or inside a dungeon.
================
*/
function createWalk( random, gid ) {
	const dungeon = gid % 4 === 3;
	let wx = dungeon ? 100 + random() * 50 : 96 * REGION_SIZE - 40 + random() * 30;
	let wz = dungeon ? 100 + random() * 50 : 97 * REGION_SIZE - 40 + random() * 30;
	let heading = random() * Math.PI * 2, y = random() * 20;
	const count = 2 + Math.floor( random() ** 2 * (MAX_POINTS - 2) ), points = [];
	for ( let i = 0; i < count; i++ ) {
		points.push( regionPose( dungeon, wx, y, wz, Math.floor( random() * 65536 ) ) );
		heading += (random() - .5) * .6;
		wx += Math.cos( heading ) * SAMPLE_DISTANCE;
		wz += Math.sin( heading ) * SAMPLE_DISTANCE;
		y += (random() - .5) * 1.5;
	}
	return { points, walked: 0, revision: 1, atMs: 0, published: points.slice( 0, 2 ) };
}

/*
================
alongWalk

The point a distance along the chain, by straight edges in world space.
================
*/
function alongWalk( walk, distance ) {
	const { points } = walk;
	for ( let i = 1; i < points.length; i++ ) {
		const from = points[i - 1], to = points[i];
		const fx = from.x + (from.regionId & 0x8000 ? 0 : (from.regionId & 0xff) * REGION_SIZE),
			fz = from.z + (from.regionId & 0x8000 ? 0 : ((from.regionId >>> 8) & 0x7f) * REGION_SIZE);
		const tx = to.x + (to.regionId & 0x8000 ? 0 : (to.regionId & 0xff) * REGION_SIZE),
			tz = to.z + (to.regionId & 0x8000 ? 0 : ((to.regionId >>> 8) & 0x7f) * REGION_SIZE);
		const length = Math.hypot( tx - fx, to.y - from.y, tz - fz );
		if ( distance <= length ) {
			const t = length ? distance / length : 0;
			return {
				pose: regionPose(
					(from.regionId & 0x8000) !== 0,
					fx + (tx - fx) * t,
					from.y + (to.y - from.y) * t,
					fz + (tz - fz) * t,
					to.angle
				),
				edge: i
			};
		}
		distance -= length;
	}
	return { pose: points.at( -1 ), edge: points.length - 1 };
}

/*
================
sampleOf

The frame's input for one walk. A receipt bumps the revision; the chain
is republished as a fresh array, as a structured clone delivers it.
================
*/
function sampleOf( random, walk, kind ) {
	const end = walk.points.at( -1 ), start = walk.points[0];
	const moving = walk.walked < walk.length;
	const path = walk.published.slice();
	if ( kind < .5 ) return { atMs: walk.atMs, revision: walk.revision, moving, walkingPath: path };
	if ( kind < .7 ) {
		return {
			atMs: walk.atMs,
			revision: walk.revision,
			moving,
			from: start,
			to: end,
			durationMs: walk.length / WALK_SPEED * 1000,
			transition: { relocation: 0, reason: "receipt", eligible: true, pathEligible: true, walkingPath: path }
		};
	}
	if ( kind < .85 ) {
		return {
			atMs: walk.atMs,
			revision: walk.revision,
			moving,
			from: start,
			to: end,
			durationMs: walk.length / WALK_SPEED * 1000,
			walkingPath: path,
			ownLeg: random() < .5
		};
	}
	return { atMs: walk.atMs, revision: walk.revision, moving, to: end };
}

/*
================
sameBits
================
*/
function sameBits( actual, expected, label ) {
	for ( const key of [ "regionId", "x", "y", "z", "angle" ] ) {
		assert.ok( Object.is( actual[key], expected[key] ), `${label} ${key}: ${actual[key]} != ${expected[key]}` );
	}
}

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

/*
================
pick
================
*/
function pick( random, values ) {
	return values[Math.floor( random() * values.length )];
}

/*
================
legOf

The walk's leg around its current edge, as the object a publication holds:
the same object while the leg stands, a new one when it moves.
================
*/
function legOf( walk, at ) {
	const from = walk.points[Math.max( 0, at.edge - 1 )],
		to = walk.points[Math.min( walk.points.length - 1, at.edge + 1 )];
	if ( walk.leg?.from !== from || walk.leg?.to !== to ) walk.leg = { from, to };
	// Now and then a leg end moves a little, below and above the threshold
	// at which a recovery path is kept.
	if ( walk.jitter ) {
		const nudge = walk.jitter;
		walk.jitter = 0;
		walk.leg = { from: { ...from, x: from.x + nudge }, to: { ...to, z: to.z - nudge } };
	}
	return walk.leg;
}

/*
================
shapedSample

Every input shape the pose rules branch on: missing revision or moving,
reused or fresh leg-end objects, skill displacements and their clock,
corridors, turns, previous paths, relocations, ineligible transitions and
each reason, with or without a chain.
================
*/
function shapedSample( random, walk, at, simulationMs ) {
	const leg = legOf( walk, at );
	const input = { atMs: walk.atMs };
	if ( random() < .85 ) input.revision = walk.revision;
	const moving = random();
	if ( moving < .75 ) input.moving = walk.walked < walk.length;
	else if ( moving < .9 ) input.moving = false;
	if ( random() < .7 ) input.to = random() < .7 ? leg.to : { ...leg.to };
	if ( random() < .6 ) input.from = leg.from;
	const duration = random();
	if ( duration < .6 ) input.durationMs = 120 + random() * 400;
	else if ( duration < .7 ) input.durationMs = 0;
	else if ( duration < .75 ) input.durationMs = Infinity;
	if ( random() < .15 ) {
		input.displacement = true;
		if ( random() < .85 ) input.startedAtMs = walk.legStartedMs ?? simulationMs;
	}
	if ( random() < .3 ) input.ownLeg = random() < .8;
	if ( walk.chained && random() < .6 ) input.walkingPath = walk.chain;
	if ( random() < .7 ) {
		const corner = walk.points[Math.min( walk.points.length - 1, at.edge )];
		input.transition = {
			relocation: random() < .97 ? walk.relocation : ++walk.relocation,
			reason: pick( random, [ "receipt", "input", "correction", "native", "cast", "spawn" ] ),
			eligible: pick( random, [ true, true, true, false, undefined ] ),
			pathEligible: pick( random, [ true, false, undefined ] ),
			logicalDistance: pick( random, [ 0, 0, 3, undefined ] ),
			...(random() < .4 ? { corridor: { from: leg.from, to: leg.to } } : {}),
			...(random() < .3 ? { previousPath: { from: walk.points[0], to: leg.from } } : {}),
			...(random() < .3 ?
				{ turn: { incoming: { from: leg.from, to: corner }, outgoing: { from: corner, to: leg.to } } } :
				{}),
			...(walk.chained && random() < .3 ? { walkingPath: walk.chain } : {})
		};
	}
	return input;
}

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
	for ( const [past, reason] of [ [ .1, "correction" ], [ .3, "native" ], [ .05, "cast" ] ] ) {
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
