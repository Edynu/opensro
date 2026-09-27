/*
===========================================================================

Native Camera Track Catmull-Rom (sub_4bf090 / sub_4bf3c0)

Owner: camera/native; this address-named fold preserves native evidence-shaped behavior.

The 0.5-weight four-point Catmull-Rom polynomial the native camera
controller uses for both its vec3 (position/rotation) and scalar
(camera distance) track channels, kept in float32 with Math.fround at
every native rounding point.

===========================================================================
*/

export type Vec3Like = {
	x: number;
	y: number;
	z: number;
};

/*
================
sub_4bf3c0_CameraTrack_CatmullRomScalar

Native callbacks sub_4bf090/sub_4bf3c0 use the same 0.5-weight four-point
Catmull-Rom polynomial for vec3 and scalar camera tracks.
================
*/
export function sub_4bf3c0_CameraTrack_CatmullRomScalar(
	amount: number,
	previous: number,
	current: number,
	next: number,
	nextNext: number
): number {
	const	t = Math.fround( amount );
	const	t2 = Math.fround( t * t );
	const	t3 = Math.fround( t2 * t );

	return Math.fround(
		0.5 *
			( 2 * current +
				( next - previous ) * t +
				( 2 * previous - 5 * current + 4 * next - nextNext ) * t2 +
				( -previous + 3 * current - 3 * next + nextNext ) * t3 )
	);
}

/*
================
sub_4bf090_CameraTrack_CatmullRomVec3
================
*/
export function sub_4bf090_CameraTrack_CatmullRomVec3(
	amount: number,
	previous: Vec3Like,
	current: Vec3Like,
	next: Vec3Like,
	nextNext: Vec3Like
): Vec3Like {
	return {
		x: sub_4bf3c0_CameraTrack_CatmullRomScalar( amount, previous.x, current.x, next.x, nextNext.x ),
		y: sub_4bf3c0_CameraTrack_CatmullRomScalar( amount, previous.y, current.y, next.y, nextNext.y ),
		z: sub_4bf3c0_CameraTrack_CatmullRomScalar( amount, previous.z, current.z, next.z, nextNext.z )
	};
}
