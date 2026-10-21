/*
===========================================================================

walking-chain.ts - certified walking chains in the walk arena

A walk's certified sample chain (walking-history.ts: up to 256 points, one
every 2 units) is searched several times per actor per frame by the pose
kernel (pose-kernel.ts): where a pose lies on it, where a candidate past
its end lands, and where a distance along it ends. A chain is one arena
entry: its point count, then POSE_WORDS doubles a point. Poses are offsets
into the calling thread's scratch, and results are written there.

Every expression keeps worldVector's (pose-presentation.ts, before the
kernel) and interpolateMovement's (native-movement.ts) operation order, so
results are bit-identical (pose-presentation-flat-walk.test.mjs).
Allocation-free.

===========================================================================
*/
import { hypot2, hypot3 } from "@/engine/foundation/math/hypot";
import {
	REGION_SIZE,
	isDungeonRegion,
	sameCoordinateSpace,
	sectorX,
	sectorY
} from "@/engine/foundation/world/world-space";
import { POSE_WORDS } from "./pose-record";

// How far off a chain a pose may lie and still be on it.
export const CHAIN_TOLERANCE = 0.01;
// A located point: the edge it lies on, its fraction along that edge, its
// distance from the chain's start, and its distance off the chain.
export const LOCATED_EDGE = 0;
export const LOCATED_FRACTION = 1;
export const LOCATED_DISTANCE = 2;
export const LOCATED_ERROR = 3;
export const LOCATED_WORDS = 4;

/*
================
offsetX

regionOffsetXZ's X component (world-space.ts, 0x00888140).
================
*/
export function offsetX( fromRegion: number, toRegion: number ): number {
	return isDungeonRegion( fromRegion ) || isDungeonRegion( toRegion ) ?
		0 :
		(sectorX( toRegion ) - sectorX( fromRegion )) * REGION_SIZE;
}

/*
================
offsetZ

regionOffsetXZ's Z component.
================
*/
export function offsetZ( fromRegion: number, toRegion: number ): number {
	return isDungeonRegion( fromRegion ) || isDungeonRegion( toRegion ) ?
		0 :
		(sectorY( toRegion ) - sectorY( fromRegion )) * REGION_SIZE;
}

/*
================
chainPoints
================
*/
export function chainPoints( arena: Float64Array, chain: number ): number {
	return arena[chain]!;
}

/*
================
chainPoint

interpolateMovement( chain[edge - 1], chain[edge], t ) into out. Chain
points are plain poses (walking-history.ts historyPose), so the dungeon
branch's spread of the end point is these five fields.
================
*/
export function chainPoint(
	s: Float64Array,
	out: number,
	arena: Float64Array,
	chain: number,
	edge: number,
	t: number
) {
	const from = chain + 1 + (edge - 1) * POSE_WORDS, to = chain + 1 + edge * POSE_WORDS;
	const fromRegion = arena[from]!, toRegion = arena[to]!;
	const fx = arena[from + 1]!, fy = arena[from + 2]!, fz = arena[from + 3]!;
	const tx = arena[to + 1]!, ty = arena[to + 2]!, tz = arena[to + 3]!;
	if ( !sameCoordinateSpace( fromRegion, toRegion ) ) {
		s[out] = fromRegion;
		s[out + 1] = fx;
		s[out + 2] = fy;
		s[out + 3] = fz;
		s[out + 4] = arena[from + 4]!;
		return;
	}
	if ( isDungeonRegion( fromRegion ) ) {
		s[out] = toRegion;
		s[out + 1] = fx + (tx - fx) * t;
		s[out + 2] = fy + (ty - fy) * t;
		s[out + 3] = fz + (tz - fz) * t;
		s[out + 4] = arena[to + 4]!;
		return;
	}
	const wx = fx + sectorX( fromRegion ) * REGION_SIZE, wz = fz + sectorY( fromRegion ) * REGION_SIZE;
	const x = wx + (tx + sectorX( toRegion ) * REGION_SIZE - wx) * t,
		z = wz + (tz + sectorY( toRegion ) * REGION_SIZE - wz) * t;
	s[out] = Math.floor( x / REGION_SIZE ) | (Math.floor( z / REGION_SIZE ) << 8);
	s[out + 1] = x % REGION_SIZE;
	s[out + 2] = fy + (ty - fy) * t;
	s[out + 3] = z % REGION_SIZE;
	s[out + 4] = arena[to + 4]!;
}

/*
================
chainEnd

The chain's last point into out.
================
*/
function chainEnd( s: Float64Array, out: number, arena: Float64Array, chain: number ) {
	const at = chain + 1 + (arena[chain]! - 1) * POSE_WORDS;
	for ( let i = 0; i < POSE_WORDS; i++ ) s[out + i] = arena[at + i]!;
}

/*
================
locateOnChain

Locate the pose at s[pose] on the chain. Writes the best edge, fraction,
distance and error into s[located ...]; false when no edge holds the pose
or the chain leaves the pose's coordinate space.
================
*/
export function locateOnChain(
	s: Float64Array,
	pose: number,
	arena: Float64Array,
	chain: number,
	located: number
): boolean {
	const region = s[pose]!, count = arena[chain]!;
	let distance = 0, found = false;
	for ( let edge = 1; edge < count; edge++ ) {
		const from = chain + 1 + (edge - 1) * POSE_WORDS, to = from + POSE_WORDS;
		const fromRegion = arena[from]!, toRegion = arena[to]!;
		if ( !sameCoordinateSpace( toRegion, fromRegion ) || !sameCoordinateSpace( region, fromRegion ) ) return false;
		const fx = arena[from + 1]!, fy = arena[from + 2]!, fz = arena[from + 3]!;
		const sx = arena[to + 1]! - fx + offsetX( fromRegion, toRegion ),
			sy = arena[to + 2]! - fy,
			sz = arena[to + 3]! - fz + offsetZ( fromRegion, toRegion );
		const px = s[pose + 1]! - fx + offsetX( fromRegion, region ),
			py = s[pose + 2]! - fy,
			pz = s[pose + 3]! - fz + offsetZ( fromRegion, region );
		const planar2 = sx ** 2 + sz ** 2;
		const fraction = planar2 ?
			Math.max( 0, Math.min( 1, (px * sx + pz * sz) / planar2 ) ) :
			sy ?
			Math.max( 0, Math.min( 1, py / sy ) ) :
			0;
		const length = hypot3( sx, sy, sz );
		const miss = hypot2( px - sx * fraction, pz - sz * fraction );
		if ( miss <= CHAIN_TOLERANCE ) {
			const error = miss + Math.abs( py - sy * fraction );
			// Every caller asks for the latest qualifying edge (latest = true).
			if (
				!found ||
				(error <= CHAIN_TOLERANCE && s[located + LOCATED_ERROR]! <= CHAIN_TOLERANCE) ||
				error < s[located + LOCATED_ERROR]!
			) {
				s[located + LOCATED_EDGE] = edge;
				s[located + LOCATED_FRACTION] = fraction;
				s[located + LOCATED_DISTANCE] = distance + length * fraction;
				s[located + LOCATED_ERROR] = error;
				found = true;
			}
		}
		distance += length;
	}
	return found;
}

/*
================
nearestOnChain

The chain's point nearest the pose at s[pose] in the plane, into out;
false when the chain has no edge or leaves the pose's coordinate space.
================
*/
export function nearestOnChain( s: Float64Array, out: number, pose: number, arena: Float64Array, chain: number ) {
	const region = s[pose]!, count = arena[chain]!;
	let bestEdge = 0, bestFraction = 0, bestMiss = 0;
	for ( let edge = 1; edge < count; edge++ ) {
		const from = chain + 1 + (edge - 1) * POSE_WORDS, to = from + POSE_WORDS;
		const fromRegion = arena[from]!, toRegion = arena[to]!;
		if ( !sameCoordinateSpace( toRegion, fromRegion ) || !sameCoordinateSpace( region, fromRegion ) ) return false;
		const fx = arena[from + 1]!, fz = arena[from + 3]!;
		const sx = arena[to + 1]! - fx + offsetX( fromRegion, toRegion ),
			sz = arena[to + 3]! - fz + offsetZ( fromRegion, toRegion );
		const px = s[pose + 1]! - fx + offsetX( fromRegion, region ),
			pz = s[pose + 3]! - fz + offsetZ( fromRegion, region );
		const planar2 = sx ** 2 + sz ** 2;
		const fraction = planar2 ?
			Math.max( 0, Math.min( 1, (px * sx + pz * sz) / planar2 ) ) :
			0;
		const miss = hypot2( px - sx * fraction, pz - sz * fraction );
		if ( !bestEdge || miss < bestMiss ) {
			bestEdge = edge;
			bestFraction = fraction;
			bestMiss = miss;
		}
	}
	if ( !bestEdge ) return false;
	chainPoint( s, out, arena, chain, bestEdge, bestFraction );
	return true;
}

/*
================
spendOnChain

The point a distance along the chain's edges, into out. Reached only
after both ends of a recovery were located on the chain, so it has two
points or more and every edge shares one coordinate space.
================
*/
export function spendOnChain( s: Float64Array, out: number, arena: Float64Array, chain: number, distance: number ) {
	const count = arena[chain]!;
	for ( let edge = 1; edge < count; edge++ ) {
		const from = chain + 1 + (edge - 1) * POSE_WORDS, to = from + POSE_WORDS;
		const fromRegion = arena[from]!, toRegion = arena[to]!;
		const length = hypot3(
			arena[to + 1]! - arena[from + 1]! + offsetX( fromRegion, toRegion ),
			arena[to + 2]! - arena[from + 2]!,
			arena[to + 3]! - arena[from + 3]! + offsetZ( fromRegion, toRegion )
		);
		if ( distance <= length ) {
			chainPoint( s, out, arena, chain, edge, length ? distance / length : 0 );
			return;
		}
		distance -= length;
	}
	chainEnd( s, out, arena, chain );
}

/*
================
chainEdgeSpan

An edge's span into s[out ...]: x, y, z in world units.
================
*/
export function chainEdgeSpan( s: Float64Array, out: number, arena: Float64Array, chain: number, edge: number ) {
	const from = chain + 1 + (edge - 1) * POSE_WORDS, to = from + POSE_WORDS;
	const fromRegion = arena[from]!, toRegion = arena[to]!;
	s[out] = arena[to + 1]! - arena[from + 1]! + offsetX( fromRegion, toRegion );
	s[out + 1] = arena[to + 2]! - arena[from + 2]!;
	s[out + 2] = arena[to + 3]! - arena[from + 3]! + offsetZ( fromRegion, toRegion );
}
