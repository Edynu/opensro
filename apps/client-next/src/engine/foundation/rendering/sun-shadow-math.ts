/*
===========================================================================

sun-shadow-math.ts - the experimental sun cascade's orthographic matrix

Port-only, not native. One cascade follows the shading light (the pinned
retail diagonal by default, the arc direction under Moving sunlight),
texel-snapped around the eye so a walking camera does not shimmer the
shadow edges. The matrix is a WebGPU orthographic projection of
region-relative world coordinates: NDC x/y the caster pass rasterizes,
[0,1] depth the receiver's comparison taps test.

===========================================================================
*/

// The matrices consume region-relative world units (ten per metre), not
// metres. The 96-metre radius must cover the 150-unit follow-camera rail
// as well as the scene around its target, even when the eye faces away
// from the light. Depth is a half-span: the eye sits midway between planes.
export const SHADOW_EXTENT = 960; // 96 metres * 10 world units per metre
export const SHADOW_DEPTH = 4000; // 400 metres * 10 world units per metre
export const SHADOW_SIZE = 2048; // cascade taps per axis

/*
================
sunShadowMatrix

Column-major mat4x4. The cascade centre is the eye's light-space projection
rounded to whole cascade texels: half a texel of camera travel moves no
shadow edge, at the cost of the cascade not being centred exactly on the
eye.
================
*/
export function sunShadowMatrix(
	eye: readonly [number, number, number] | readonly number[],
	light: readonly [number, number, number] | readonly number[],
	extent = SHADOW_EXTENT,
	depth = SHADOW_DEPTH
): Float32Array<ArrayBuffer> {
	const length = Math.hypot( light[0]!, light[1]!, light[2]! );
	if ( length === 0 ) throw Error( "Invalid shadow light direction" );
	// The cascade looks along -light, from the sun toward the scene.
	const forward = [ -light[0]! / length, -light[1]! / length, -light[2]! / length ];
	// A vertical light has no stable screen-up; tilt the hint toward +Z.
	const hint = Math.abs( forward[1]! ) > 0.99 ? [ 0, 0, 1 ] : [ 0, 1, 0 ];
	let right = [
		hint[1]! * forward[2]! - hint[2]! * forward[1]!,
		hint[2]! * forward[0]! - hint[0]! * forward[2]!,
		hint[0]! * forward[1]! - hint[1]! * forward[0]!
	];
	const rightLength = Math.hypot( right[0]!, right[1]!, right[2]! );
	right = [ right[0]! / rightLength, right[1]! / rightLength, right[2]! / rightLength ];
	const up = [
		forward[1]! * right[2]! - forward[2]! * right[1]!,
		forward[2]! * right[0]! - forward[0]! * right[2]!,
		forward[0]! * right[1]! - forward[1]! * right[0]!
	];
	/*
	================
	center
	================
	*/
	const center = ( axis: readonly number[] ): number => {
		const along = axis[0]! * eye[0]! + axis[1]! * eye[1]! + axis[2]! * eye[2]!;
		const texel = 2 * extent / SHADOW_SIZE;
		return Math.round( along / texel ) * texel;
	};
	const cr = center( right ),
		cu = center( up ),
		cf = forward[0]! * eye[0]! + forward[1]! * eye[1]! + forward[2]! * eye[2]!;
	// The centre walks back one depth span so the eye sits mid-cascade.
	const c = [
		right[0]! * cr + up[0]! * cu + forward[0]! * (cf - depth),
		right[1]! * cr + up[1]! * cu + forward[1]! * (cf - depth),
		right[2]! * cr + up[2]! * cu + forward[2]! * (cf - depth)
	];
	const s = 1 / extent, z = 1 / (2 * depth);
	return new Float32Array( [
		right[0]! * s,
		up[0]! * s,
		forward[0]! * z,
		0,
		right[1]! * s,
		up[1]! * s,
		forward[1]! * z,
		0,
		right[2]! * s,
		up[2]! * s,
		forward[2]! * z,
		0,
		-(right[0]! * c[0]! + right[1]! * c[1]! + right[2]! * c[2]!) * s,
		-(up[0]! * c[0]! + up[1]! * c[1]! + up[2]! * c[2]!) * s,
		-(forward[0]! * c[0]! + forward[1]! * c[1]! + forward[2]! * c[2]!) * z,
		1
	] );
}
