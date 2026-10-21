/*
===========================================================================

flat-pose.ts - poses and vectors in a kernel thread's scratch

The pose arithmetic of the movement presentation (pose-presentation.ts
before its kernel, native-movement.ts, world-space.ts) on flat memory: a
pose is POSE_WORDS doubles and a vector three, at offsets into one
Float64Array. Each function keeps its object original's operation order,
so results are bit-identical. Allocation-free.

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
import { CHAIN_TOLERANCE, offsetX, offsetZ } from "./walking-chain";
import { POSE_WORDS } from "./pose-record";

const DISCONTINUITY_DISTANCE = 192;

/*
================
copyPose
================
*/
export function copyPose( s: Float64Array, to: number, from: number ) {
	for ( let i = 0; i < POSE_WORDS; i++ ) s[to + i] = s[from + i]!;
}

/*
================
setVector
================
*/
export function setVector( s: Float64Array, at: number, x: number, y: number, z: number ) {
	s[at] = x;
	s[at + 1] = y;
	s[at + 2] = z;
}

/*
================
vectorLength
================
*/
export function vectorLength( s: Float64Array, at: number ): number {
	return hypot3( s[at]!, s[at + 1]!, s[at + 2]! );
}

/*
================
worldVector

worldVector( a, b ) into out: [dx, a.y - b.y, dz], [dx, dz] = worldDelta( b, a ).
False, out untouched, across coordinate spaces.
================
*/
export function worldVector( s: Float64Array, out: number, a: number, b: number ): boolean {
	const ar = s[a]!, br = s[b]!;
	if ( !sameCoordinateSpace( ar, br ) ) return false;
	s[out] = s[a + 1]! - s[b + 1]! + offsetX( br, ar );
	s[out + 1] = s[a + 2]! - s[b + 2]!;
	s[out + 2] = s[a + 3]! - s[b + 3]! + offsetZ( br, ar );
	return true;
}

/*
================
poseDistance

native-movement.ts poseDistance: the planar distance, and its throw across
coordinate spaces.
================
*/
export function poseDistance( s: Float64Array, a: number, b: number ): number {
	const ar = s[a]!, br = s[b]!;
	if ( !sameCoordinateSpace( ar, br ) ) throw new Error( "Dungeon transition requires teleport" );
	return hypot2( s[b + 1]! - s[a + 1]! + offsetX( ar, br ), s[b + 3]! - s[a + 3]! + offsetZ( ar, br ) );
}

/*
================
discontinuity
================
*/
export function discontinuity( s: Float64Array, a: number, b: number ): boolean {
	return !sameCoordinateSpace( s[a]!, s[b]! ) || poseDistance( s, a, b ) > DISCONTINUITY_DISTANCE;
}

/*
================
displace

displace( pose, v ) into out. False when v is zero: the object code then
returned the pose itself, an identity sampledLinearModel's callers test.
================
*/
export function displace( s: Float64Array, out: number, pose: number, vx: number, vy: number, vz: number ): boolean {
	if ( vx === 0 && vy === 0 && vz === 0 ) {
		copyPose( s, out, pose );
		return false;
	}
	const region = s[pose]!, x = s[pose + 1]!, y = s[pose + 2]!, z = s[pose + 3]!, angle = s[pose + 4]!;
	if ( isDungeonRegion( region ) ) {
		s[out] = region;
		s[out + 1] = x + vx;
		s[out + 3] = z + vz;
	} else {
		const wx = x + vx + sectorX( region ) * REGION_SIZE, wz = z + vz + sectorY( region ) * REGION_SIZE;
		const rx = Math.floor( wx / REGION_SIZE ), rz = Math.floor( wz / REGION_SIZE );
		s[out] = rx | (rz << 8);
		s[out + 1] = wx - rx * REGION_SIZE;
		s[out + 3] = wz - rz * REGION_SIZE;
	}
	s[out + 2] = y + vy;
	s[out + 4] = angle;
	return true;
}

/*
================
interpolate

interpolateMovement( from, to, t ) into out (native-movement.ts).
================
*/
export function interpolate( s: Float64Array, out: number, from: number, to: number, t: number ) {
	const fromRegion = s[from]!, toRegion = s[to]!;
	if ( !sameCoordinateSpace( fromRegion, toRegion ) ) {
		copyPose( s, out, from );
		return;
	}
	const fx = s[from + 1]!, fy = s[from + 2]!, fz = s[from + 3]!;
	const tx = s[to + 1]!, ty = s[to + 2]!, tz = s[to + 3]!, angle = s[to + 4]!;
	if ( isDungeonRegion( fromRegion ) ) {
		s[out] = toRegion;
		s[out + 1] = fx + (tx - fx) * t;
		s[out + 2] = fy + (ty - fy) * t;
		s[out + 3] = fz + (tz - fz) * t;
		s[out + 4] = angle;
		return;
	}
	const wx = fx + sectorX( fromRegion ) * REGION_SIZE, wz = fz + sectorY( fromRegion ) * REGION_SIZE;
	const x = wx + (tx + sectorX( toRegion ) * REGION_SIZE - wx) * t,
		z = wz + (tz + sectorY( toRegion ) * REGION_SIZE - wz) * t;
	s[out] = Math.floor( x / REGION_SIZE ) | (Math.floor( z / REGION_SIZE ) << 8);
	s[out + 1] = x % REGION_SIZE;
	s[out + 2] = fy + (ty - fy) * t;
	s[out + 3] = z % REGION_SIZE;
	s[out + 4] = angle;
}

/*
================
onCorridor

Navigation owns the chord; presentation can only move along it. A walk's
navigation proof is planar; corrections require the complete 3D chord.
================
*/
export function onCorridor( s: Float64Array, pose: number, from: number, to: number, walking: boolean ): boolean {
	const poseRegion = s[pose]!, fromRegion = s[from]!, toRegion = s[to]!;
	if ( !sameCoordinateSpace( toRegion, fromRegion ) || !sameCoordinateSpace( poseRegion, fromRegion ) ) return false;
	const fx = s[from + 1]!, fy = s[from + 2]!, fz = s[from + 3]!;
	const sx = s[to + 1]! - fx + offsetX( fromRegion, toRegion ),
		sy = walking ? 0 : s[to + 2]! - fy,
		sz = s[to + 3]! - fz + offsetZ( fromRegion, toRegion );
	const px = s[pose + 1]! - fx + offsetX( fromRegion, poseRegion ),
		py = walking ? 0 : s[pose + 2]! - fy,
		pz = s[pose + 3]! - fz + offsetZ( fromRegion, poseRegion );
	const length2 = sx ** 2 + sy ** 2 + sz ** 2;
	const t = length2 ? Math.max( 0, Math.min( 1, (px * sx + py * sy + pz * sz) / length2 ) ) : 0;
	return hypot3( px - sx * t, py - sy * t, pz - sz * t ) <= CHAIN_TOLERANCE;
}

/*
================
turn

Native 86CBA0: shortest arc, 3*pi radians/second.
================
*/
export function turn( from: number, to: number, seconds: number ): number {
	const delta = ((to - from + 98304) % 65536) - 32768, limit = seconds * 98304;
	return (from + Math.max( -limit, Math.min( limit, delta ) ) + 65536) % 65536;
}
