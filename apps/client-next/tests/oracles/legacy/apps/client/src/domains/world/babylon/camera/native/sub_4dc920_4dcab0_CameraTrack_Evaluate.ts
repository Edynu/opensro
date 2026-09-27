/*
===========================================================================

Native Camera Track Evaluation (sub_4dc920 / sub_4dcab0)

Owner: camera/native; this address-named fold preserves native evidence-shaped behavior.

Samples a CCameraController keyframe track at a given time: clamps to the
first/last key outside the track, locates the surrounding segment, then
interpolates position, rotation and the camera scalar with the native
four-point Catmull-Rom callbacks (sub_4bf090 vec3 / sub_4bf3c0 scalar),
with the rotation channel unwrapped first by sub_4bcb00 so adjacent keys
never blend across the +/-pi seam.

===========================================================================
*/

import type { SroCameraKeyframe } from "@sro/runtime";
import {
	sub_4bf090_CameraTrack_CatmullRomVec3,
	sub_4bf3c0_CameraTrack_CatmullRomScalar,
	type Vec3Like
} from "./sub_4bf090_4bf3c0_CameraTrack_CatmullRom";
import { sub_4bcb00_CameraTrack_UnwrapAngles } from "./sub_4bcb00_CameraTrack_UnwrapAngles";

export type EvaluatedNativeCameraKey = {
	timeSeconds: number;
	sourceTimeSeconds?: number;
	sectorX: number;
	sectorY: number;
	position: Vec3Like;
	rotation: Vec3Like;
	cameraScalar: number;
	mode: number;
};

/*
================
sub_4dc920_4dcab0_EvaluateTitleCameraTracks
================
*/
export function sub_4dc920_4dcab0_EvaluateTitleCameraTracks(
	keys: SroCameraKeyframe[],
	timeSeconds: number
): EvaluatedNativeCameraKey {
	const	first = keys[0];
	const	last = keys.at( -1 ) ?? first;

	if ( !first ) {
		throw new Error( "Native title camera track needs at least one key" );
	}

	if ( timeSeconds <= first.timeSeconds ) {
		return cameraKeyToNativeEvaluation( first, first.timeSeconds );
	}

	if ( timeSeconds >= last.timeSeconds ) {
		return cameraKeyToNativeEvaluation( last, last.timeSeconds );
	}

	const	segment = findNativeCameraSegment( keys, timeSeconds );
	if ( !segment ) {
		return cameraKeyToNativeEvaluation( last, last.timeSeconds );
	}

	const	{ amount, segmentIndex } = segment;
	const	previousIndex = segmentIndex === 0 ? segmentIndex : segmentIndex - 1;
	const	currentIndex = segmentIndex;
	const	nextIndex = segmentIndex + 1;
	const	nextNextIndex = segmentIndex === keys.length - 2 ? segmentIndex + 1 : segmentIndex + 2;

	const	previous = keys[previousIndex];
	const	current = keys[currentIndex];
	const	next = keys[nextIndex];
	const	nextNext = keys[nextNextIndex];

	return {
		timeSeconds,
		sourceTimeSeconds: current.sourceTimeSeconds,
		sectorX: current.sectorX,
		sectorY: current.sectorY,
		position: sub_4bf090_CameraTrack_CatmullRomVec3(
			amount,
			previous.position,
			current.position,
			next.position,
			nextNext.position
		),
		rotation: {
			x: evaluateNativeAngleScalar( amount, previous.rotation.x, current.rotation.x, next.rotation.x, nextNext.rotation.x ),
			y: evaluateNativeAngleScalar( amount, previous.rotation.y, current.rotation.y, next.rotation.y, nextNext.rotation.y ),
			z: evaluateNativeAngleScalar( amount, previous.rotation.z, current.rotation.z, next.rotation.z, nextNext.rotation.z )
		},
		cameraScalar: sub_4bf3c0_CameraTrack_CatmullRomScalar(
			amount,
			previous.mode,
			current.mode,
			next.mode,
			nextNext.mode
		),
		mode: current.mode
	};
}

/*
================
findNativeCameraSegment
================
*/
function findNativeCameraSegment(
	keys: SroCameraKeyframe[],
	timeSeconds: number
): { amount: number; segmentIndex: number } | null {
	for ( let keyIndex = 0; keyIndex < keys.length; keyIndex += 1 ) {
		const	key = keys[keyIndex];

		if ( key.timeSeconds < timeSeconds ) {
			continue;
		}

		if ( keyIndex === 0 ) {
			return { amount: 0, segmentIndex: 0 };
		}

		const	previous = keys[keyIndex - 1];
		const	duration = key.timeSeconds - previous.timeSeconds;
		const	amount = duration <= 0.00009999999747378752 ? 0 : ( timeSeconds - previous.timeSeconds ) / duration;

		return {
			amount,
			segmentIndex: keyIndex - 1
		};
	}

	return null;
}

/*
================
evaluateNativeAngleScalar
================
*/
function evaluateNativeAngleScalar(
	amount: number,
	previous: number,
	current: number,
	next: number,
	nextNext: number
): number {
	const	unwrapped = sub_4bcb00_CameraTrack_UnwrapAngles( previous, current, next, nextNext );
	return sub_4bf3c0_CameraTrack_CatmullRomScalar( amount, unwrapped[0], unwrapped[1], unwrapped[2], unwrapped[3] );
}

/*
================
cameraKeyToNativeEvaluation
================
*/
function cameraKeyToNativeEvaluation( key: SroCameraKeyframe, timeSeconds: number ): EvaluatedNativeCameraKey {
	return {
		timeSeconds,
		sourceTimeSeconds: key.sourceTimeSeconds,
		sectorX: key.sectorX,
		sectorY: key.sectorY,
		position: key.position,
		rotation: key.rotation,
		cameraScalar: key.mode,
		mode: key.mode
	};
}
