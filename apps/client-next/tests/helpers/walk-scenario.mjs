/*
===========================================================================

walk-scenario.mjs - seeded walks and sample inputs for pose presentation tests

Generates characters walking certified chains (outdoors across region
borders, or in a dungeon) and the sample inputs a frame would publish for
them, in every shape the pose rules branch on, from one seeded random
source, so two presentations driven with the same seed see the same
inputs. sameBits compares two drawn poses bit for bit.

An input's chain comes in both forms: walkingPath for the frozen object
code, walkingChain as the simulation worker publishes it (chainOf).

===========================================================================
*/
import assert from "node:assert/strict";

const { flattenWalkingPath } = await import( "../../src/engine/foundation/gameplay/walking-history.ts" );

const REGION_SIZE = 1920;
const DUNGEON_REGION = 0x8000 | 3;
// Chain points are one SAMPLE_DISTANCE apart (walking-history.ts).
export const SAMPLE_DISTANCE = 2;
const MAX_POINTS = 256;
export const WALK_SPEED = 30;
export const TICK_MS = 50;
// One published flat chain per chain object (chainOf).
const flatChains = new WeakMap();

/*
================
createRandom
================
*/
export function createRandom( seed ) {
	return () => (seed = (Math.imul( seed, 1664525 ) + 1013904223) >>> 0) / 2 ** 32;
}

/*
================
chainOf

A chain as the simulation worker publishes it (walking-history.ts
flattenWalkingPath), one flat array per chain object, as the worker's
own cache gives.
================
*/
export function chainOf( points ) {
	let chain = flatChains.get( points );
	if ( !chain ) {
		chain = flattenWalkingPath( points );
		flatChains.set( points, chain );
	}
	return chain;
}

/*
================
regionPose

A pose at world coordinates: outdoors re-anchored to its sector, in a
dungeon kept local.
================
*/
export function regionPose( dungeon, wx, y, wz, angle ) {
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
export function createWalk( random, gid ) {
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
export function alongWalk( walk, distance ) {
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
export function sampleOf( random, walk, kind ) {
	const end = walk.points.at( -1 ), start = walk.points[0];
	const moving = walk.walked < walk.length;
	const path = walk.published.slice();
	if ( kind < .5 ) {
		return { atMs: walk.atMs, revision: walk.revision, moving, walkingPath: path, walkingChain: chainOf( path ) };
	}
	if ( kind < .7 ) {
		return {
			atMs: walk.atMs,
			revision: walk.revision,
			moving,
			from: start,
			to: end,
			durationMs: walk.length / WALK_SPEED * 1000,
			transition: {
				relocation: 0,
				reason: "receipt",
				eligible: true,
				pathEligible: true,
				walkingPath: path,
				walkingChain: chainOf( path )
			}
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
			walkingChain: chainOf( path ),
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
export function sameBits( actual, expected, label ) {
	for ( const key of [ "regionId", "x", "y", "z", "angle" ] ) {
		assert.ok( Object.is( actual[key], expected[key] ), `${label} ${key}: ${actual[key]} != ${expected[key]}` );
	}
}

/*
================
pick
================
*/
export function pick( random, values ) {
	return values[Math.floor( random() * values.length )];
}

/*
================
legOf

The walk's leg around its current edge, as the object a publication holds:
the same object while the leg stands, a new one when it moves.
================
*/
export function legOf( walk, at ) {
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
export function shapedSample( random, walk, at, simulationMs ) {
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
	if ( walk.chained && random() < .6 ) {
		input.walkingPath = walk.chain;
		input.walkingChain = chainOf( walk.chain );
	}
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
			...(walk.chained && random() < .3 ? { walkingPath: walk.chain, walkingChain: chainOf( walk.chain ) } : {})
		};
	}
	return input;
}
