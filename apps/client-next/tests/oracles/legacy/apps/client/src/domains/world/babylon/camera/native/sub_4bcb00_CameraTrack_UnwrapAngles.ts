/*
===========================================================================

Native Camera Track Angle Unwrap (sub_4bcb00)

Owner: camera/native; this address-named fold preserves native evidence-shaped behavior.

Pre-pass over the four rotation keys handed to the Catmull-Rom blend:
shifts each key by whole turns until adjacent keys are within one turn of
each other, so the interpolation never sweeps the long way around the
+/-pi seam. Exact float32 parity with 0x004bcb00..0x004bcca6, including
its deliberately asymmetric guards (see the function banner).

===========================================================================
*/

const NATIVE_PI = 3.1415927410125732;
const NATIVE_NEGATIVE_PI = -3.1415927410125732;
const NATIVE_TWO_PI = 6.2831854820251465;

/*
================
sub_4bcb00_CameraTrack_UnwrapAngles

Native 0x004bcb00..0x004bcca6, three unrolled adjacent-pair passes.

The guards and the loop conditions are deliberately asymmetric in native and
must stay that way:
  - the delta is rounded to float32 before it is compared (0x004bcb0c stores
    it with `fstp dword` and 0x004bcb12 reloads it);
  - the positive guard is strict `> pi` (0x004bcb35 `fcom st(3)` compares pi
    against the delta, then `test ah,1` / `je` skips on `pi >= delta`);
  - the negative guard is INCLUSIVE `<= -pi` (0x004bcc03 `fcomp st(1)` then
    `test ah,0x41` / `jp` skips only on `delta > -pi`);
  - neither loop re-tests the delta. They compare prior against value
    directly (0x004bcb48 and 0x004bcc14 `fcompp`), so they drive the delta to
    <= 0 and >= 0 respectively, leaving it inside 2*pi rather than pi.
Each pass writes its result back before the next pass reads it.
================
*/
export function sub_4bcb00_CameraTrack_UnwrapAngles(
	previous: number,
	current: number,
	next: number,
	nextNext: number
): [number, number, number, number] {
	const	values = [previous, current, next, nextNext].map( ( value ) => Math.fround( value ) );

	for ( let index = 1; index < values.length; index += 1 ) {
		const	prior = values[index - 1];
		let		value = values[index];
		const	delta = Math.fround( value - prior );

		if ( delta < 0 ) {
			if ( delta <= NATIVE_NEGATIVE_PI ) {
				while ( prior > value ) {
					value = Math.fround( value + NATIVE_TWO_PI );
				}
			}
		} else if ( delta > NATIVE_PI ) {
			while ( prior < value ) {
				value = Math.fround( value - NATIVE_TWO_PI );
			}
		}

		values[index] = value;
	}

	return values as [number, number, number, number];
}
