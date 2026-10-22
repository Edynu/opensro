/*
===========================================================================

particle-output.ts - the GPU records of a flat particle graph's elements

particle-records.ts writeGraphRecord and particle-presentation.ts
tickRotationStep ported onto the particle kernel's tables: after a run,
each live element of a drawn emitter gets the record the GPU particle
pass draws it from (particle-shader.ts), written with the graph's holder
link as characters.ts gives every graph one, and every other used slot is
hidden. The records are the object code's bits: same operations, same
float32 stores. Allocation-free.

===========================================================================
*/
import { LINK_MATRIX, LINK_TRANSLATE, LINK_TURN } from "@/engine/foundation/animation/particle-holder-link";
import {
	PARTICLE_RECORD,
	RECORD_BIRTH,
	RECORD_FLAGS,
	RECORD_LIVE,
	RECORD_MATRIX,
	RECORD_MATRIX_STEP,
	RECORD_MOTION,
	RECORD_POSITION,
	RECORD_POSITION_MOTION,
	RECORD_PRESENTED,
	RECORD_ROTATION,
	RECORD_ROTATION_STEP,
	RECORD_SCALE,
	RECORD_SCALE_MOTION,
	RECORD_TICK,
	RECORD_VELOCITY
} from "@/engine/foundation/animation/particle-records";
import { PARTICLE_TICKS_PER_SECOND } from "@/engine/foundation/animation/particle-presentation";
import {
	E_ALIVE,
	E_CLOCK_BIRTH,
	E_FRAME,
	E_HAS_TICK,
	E_ORIGIN,
	E_POSITION,
	E_PRESENT,
	E_PREVIOUS,
	E_ROOT_LINK,
	E_SCALE,
	E_TICK_POSITION,
	E_TICK_SCALE,
	E_VELOCITY,
	F_DELTA,
	F_MATRIX,
	F_ROTATION,
	F_TICK_MATRIX,
	F_TICK_ROTATION,
	M_TURNED,
	W_ROOT,
	W_ROTATION,
	W_SHIFT
} from "./particle-record";
import { framesAt, multiplyAt, type ParticleViews, stateAt } from "./particle-step";

// particle-presentation.ts: a tick turn past this is a reset, not motion;
// a determinant below this is singular.
const MAX_TICK_ROTATION_RAD = 1.5707963267948966;
const MIN_DETERMINANT = 1e-12;

/*
================
invert3At

particle-presentation.ts invert3: the inverse of the upper 3x3 of the
column-major 4x4 at m[at], column-major into work[w..w+8]. False when it
is singular.
================
*/
function invert3At( m: Float32Array, at: number, work: Float64Array, w: number ): boolean {
	const a = m[at]!, b = m[at + 4]!, c = m[at + 8]!;
	const d = m[at + 1]!, e = m[at + 5]!, f = m[at + 9]!;
	const g = m[at + 2]!, h = m[at + 6]!, i = m[at + 10]!;
	const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
	if ( !Number.isFinite( det ) || Math.abs( det ) < MIN_DETERMINANT ) return false;
	work[w] = (e * i - f * h) / det;
	work[w + 1] = (f * g - d * i) / det;
	work[w + 2] = (d * h - e * g) / det;
	work[w + 3] = (c * h - b * i) / det;
	work[w + 4] = (a * i - c * g) / det;
	work[w + 5] = (b * g - a * h) / det;
	work[w + 6] = (b * f - c * e) / det;
	work[w + 7] = (c * d - a * f) / det;
	work[w + 8] = (a * e - b * d) / det;
	return true;
}

/*
================
stepRotationAt

particle-presentation.ts stepRotation: with previous^-1 at work[w], the
step at work[w + 9] and its axis and angle at work[w + 18..21]. False
when the step is not a rotation or too large to be motion.
================
*/
function stepRotationAt( m: Float32Array, at: number, work: Float64Array, w: number ): boolean {
	for ( let column = 0; column < 3; column++ ) {
		for ( let row = 0; row < 3; row++ ) {
			work[w + 9 + column * 3 + row] = work[w + row]! * m[at + column * 4]! +
				work[w + 3 + row]! * m[at + column * 4 + 1]! +
				work[w + 6 + row]! * m[at + column * 4 + 2]!;
		}
	}
	for ( let column = 0; column < 3; column++ ) {
		const x = work[w + 9 + column * 3]!, y = work[w + 10 + column * 3]!, z = work[w + 11 + column * 3]!;
		if ( Math.abs( x * x + y * y + z * z - 1 ) > 2e-3 ) return false;
	}
	const cos = Math.max( -1, Math.min( 1, (work[w + 9]! + work[w + 13]! + work[w + 17]! - 1) / 2 ) );
	const angle = Math.acos( cos );
	if ( angle > MAX_TICK_ROTATION_RAD || angle < 1e-7 ) return false;
	let x = work[w + 14]! - work[w + 16]!, y = work[w + 15]! - work[w + 11]!, z = work[w + 10]! - work[w + 12]!;
	const length = Math.sqrt( x * x + y * y + z * z );
	if ( length < 1e-9 ) return false;
	x /= length;
	y /= length;
	z /= length;
	work[w + 18] = x;
	work[w + 19] = y;
	work[w + 20] = z;
	work[w + 21] = angle;
	return true;
}

/*
================
tickRotationStepAt

particle-presentation.ts tickRotationStep: the rotation from the matrix at
previous[previousAt] to the one at current[currentAt] as axis and angle,
into out[outAt..outAt+3]; zero when it did not turn or is no rotation.
================
*/
function tickRotationStepAt(
	previous: Float32Array,
	previousAt: number,
	current: Float32Array,
	currentAt: number,
	out: Float32Array,
	outAt: number,
	work: Float64Array
) {
	out[outAt] =
		out[outAt + 1] =
		out[outAt + 2] =
		out[outAt + 3] =
			0;
	const p = previousAt, c = currentAt;
	if (
		previous[p] === current[c] && previous[p + 1] === current[c + 1] && previous[p + 2] === current[c + 2] &&
		previous[p + 4] === current[c + 4] && previous[p + 5] === current[c + 5] &&
		previous[p + 6] === current[c + 6] && previous[p + 8] === current[c + 8] &&
		previous[p + 9] === current[c + 9] && previous[p + 10] === current[c + 10]
	) return;
	if ( !invert3At( previous, p, work, W_ROTATION ) || !stepRotationAt( current, c, work, W_ROTATION ) ) return;
	out[outAt] = work[W_ROTATION + 18]!;
	out[outAt + 1] = work[W_ROTATION + 19]!;
	out[outAt + 2] = work[W_ROTATION + 20]!;
	out[outAt + 3] = work[W_ROTATION + 21]!;
}

/*
================
rootTickShiftAt

particle-holder-link.ts rootTickShift of element e into W_SHIFT: the part
of its last tick motion its holder links caused.
================
*/
function rootTickShiftAt( v: ParticleViews, e: number, flags: number ) {
	const s = v.particleState, f = v.particleFrames, w = v.particleWork;
	const root = w[W_ROOT]!, at = stateAt( v, e ), rootAt = stateAt( v, root ), delta = framesAt( v, root ) + F_DELTA;
	const previous = at + E_PREVIOUS, origin = rootAt + E_ORIGIN, position = rootAt + E_POSITION;
	const x = s[previous]! - s[origin]!, y = s[previous + 1]! - s[origin + 1]!, z = s[previous + 2]! - s[origin + 2]!;
	for ( let axis = 0; axis < 3; axis++ ) {
		let shift = 0;
		if ( flags & LINK_TURN ) {
			shift += f[delta + axis]! * x + f[delta + 4 + axis]! * y + f[delta + 8 + axis]! * z + s[origin + axis]! -
				s[previous + axis]!;
		}
		if ( flags & LINK_TRANSLATE ) shift += s[position + axis]! - s[origin + axis]!;
		w[W_SHIFT + axis] = shift;
	}
}

/*
================
writeTickPoseAt

particle-records.ts writeTickPose of element e into the record at at.
================
*/
function writeTickPoseAt( v: ParticleViews, e: number, at: number ) {
	const s = v.particleState, f = v.particleFrames, state = stateAt( v, e ), frames = framesAt( v, e );
	const ticked = s[state + E_HAS_TICK] === 1;
	for ( let axis = 0; axis < 3; axis++ ) {
		const position = s[state + E_POSITION + axis]!, scale = s[state + E_SCALE + axis]!;
		f[at + RECORD_POSITION + axis] = position;
		f[at + RECORD_SCALE + axis] = scale;
		f[at + RECORD_POSITION_MOTION + axis] = ticked ? position - s[state + E_TICK_POSITION + axis]! : 0;
		f[at + RECORD_SCALE_MOTION + axis] = ticked ? scale - s[state + E_TICK_SCALE + axis]! : 0;
		f[at + RECORD_VELOCITY + axis] = s[state + E_VELOCITY + axis]!;
	}
	f[at + RECORD_TICK] = s[state + E_FRAME]!;
	for ( let i = 0; i < 16; i++ ) f[at + RECORD_ROTATION + i] = f[frames + F_ROTATION + i]!;
	if ( ticked ) {
		tickRotationStepAt(
			f,
			frames + F_TICK_ROTATION,
			f,
			frames + F_ROTATION,
			f,
			at + RECORD_ROTATION_STEP,
			v.particleWork
		);
	} else f.fill( 0, at + RECORD_ROTATION_STEP, at + RECORD_ROTATION_STEP + 4 );
}

/*
================
writeRecordAt

particle-records.ts writeGraphRecord of live element e, with the graph's
holder link, into the record of slot (records area at records).
================
*/
export function writeRecordAt( v: ParticleViews, e: number, records: number, slot: number ) {
	const s = v.particleState, f = v.particleFrames, m = v.particleMatrices, w = v.particleWork;
	const at = records + slot * PARTICLE_RECORD, state = stateAt( v, e ), frames = framesAt( v, e );
	const flags = s[state + E_ROOT_LINK]!;
	rootTickShiftAt( v, e, flags );
	for ( let i = 0; i < 16; i++ ) f[at + RECORD_MATRIX + i] = f[frames + F_MATRIX + i]!;
	for ( let axis = 0; axis < 3; axis++ ) {
		const position = s[state + E_POSITION + axis]!;
		f[at + RECORD_MATRIX + 12 + axis] = position;
		f[at + RECORD_MOTION + axis] = position - s[state + E_PREVIOUS + axis]! - w[W_SHIFT + axis]!;
	}
	if ( s[state + E_HAS_TICK] === 1 ) {
		if ( flags & LINK_MATRIX ) {
			multiplyAt( f, framesAt( v, w[W_ROOT]! ) + F_DELTA, f, frames + F_TICK_MATRIX, m, M_TURNED );
			tickRotationStepAt( m, M_TURNED, f, frames + F_MATRIX, f, at + RECORD_MATRIX_STEP, w );
		} else {
			tickRotationStepAt( f, frames + F_TICK_MATRIX, f, frames + F_MATRIX, f, at + RECORD_MATRIX_STEP, w );
		}
	} else f.fill( 0, at + RECORD_MATRIX_STEP, at + RECORD_MATRIX_STEP + 4 );
	writeTickPoseAt( v, e, at );
	f[at + RECORD_BIRTH] = s[state + E_CLOCK_BIRTH]! / PARTICLE_TICKS_PER_SECOND;
	f[at + RECORD_FLAGS] = RECORD_LIVE | RECORD_PRESENTED | flags;
}

/*
================
writeEmitterRecords

The records of an emitter's used slots (base its slot 0's element, rows
its rows): live elements written, the others hidden. Returns the live.
================
*/
export function writeEmitterRecords( v: ParticleViews, base: number, rows: number, records: number ): number {
	const s = v.particleState, f = v.particleFrames;
	let live = 0;
	for ( let b = 0; b < rows; b++ ) {
		const state = stateAt( v, base + b );
		if ( s[state + E_PRESENT] === 1 && s[state + E_ALIVE] === 1 ) {
			writeRecordAt( v, base + b, records, b );
			live++;
		} else f[records + b * PARTICLE_RECORD + RECORD_FLAGS] = 0;
	}
	return live;
}
