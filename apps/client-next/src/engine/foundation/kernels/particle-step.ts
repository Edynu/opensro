/*
===========================================================================

particle-step.ts - one particle element's operations, on flat memory

What particle-graph.ts does to one element, and particle-program.ts to a
particle, ported onto the particle kernel's tables (particle-record.ts):
the random draws, a birth's sample (initializeParticle), a tick's motion
(advanceParticle with the graph's motion program), vector and position
commands, attraction, an emitter's commands at an age, its emission, and
the 4x4 helpers they use. particle-kernel.ts runs the graph with them.

Every expression keeps the object code's operation order and its float32
stores: a value the object code kept in a Float32Array lives in
particleFrames or the thread's matrix scratch, so it rounds where it did.
The element and the graph a call works on are the registers in the
thread's particleWork (W_ELEMENTS, W_FRAMES, W_HALF); elements are
indices, -1 is none. Allocation-free.

===========================================================================
*/
import { hypot3 } from "@/engine/foundation/math/hypot";
import { SPHERE_POS_PARENT, SPHERE_POS_SELF, SPHERE_POS_SIBLING } from "@/engine/foundation/animation/particle-program";
import {
	C_BAN_ROTATION,
	C_FLAGS,
	C_FRAMES,
	C_POSITIONS,
	C_PROGRAM,
	C_ROTATIONS,
	COMMAND_RECORD,
	D_COMMANDS,
	D_DURATION,
	D_LIMIT,
	D_PERIOD,
	D_RATE,
	D_START,
	E_FRAME,
	E_PARENT,
	E_POSITION,
	E_SCALE,
	E_VELOCITY,
	ELEMENT_FLOATS,
	ELEMENT_WORDS,
	F_LOCAL,
	F_MATRIX,
	F_ROTATION,
	F_SHAPE,
	H_INDEX,
	LIST_COUNT,
	LIST_VALUES,
	M_MATRIX,
	PARTICLE_RANDOM_VALUES,
	PROGRAM_OP_CONE,
	PROGRAM_OP_CONE_FORCE,
	PROGRAM_OP_CONE_POS,
	PROGRAM_OP_SCALE,
	PROGRAM_OP_SPHERE,
	Q_ATTRACTION,
	Q_ATTRACTION_SET,
	Q_CONE,
	Q_CONE_FLAGS,
	Q_CONE_FORCE,
	Q_CONE_FORCE_FLAGS,
	Q_CONE_POS,
	Q_CONE_POS_FLAGS,
	Q_ORDER,
	Q_R_VELOCITY,
	Q_SCALE,
	Q_SCALE_FRAMES,
	Q_SHAPE,
	Q_SPHERE,
	Q_SPHERE_FLAGS,
	Q_SPIN,
	Q_VECTORS,
	V_FLAGS,
	V_FRAMES,
	V_NAME,
	V_VALUE,
	VECTOR_FORCE,
	VECTOR_RECORD,
	VECTOR_SET_POSITION,
	W_CONE,
	W_ELEMENTS,
	W_FRAMES,
	W_HALF,
	W_SAMPLE_POSITION,
	W_SAMPLE_SCALE,
	W_SAMPLE_VELOCITY,
	W_TOTAL,
	W_VECTOR
} from "./particle-record";

// initializeParticle's default op order: sphere, random scale, cone.
const DEFAULT_OPS = 3;
// An element frame passes this many particle frames at most (advanceParticle).
const MAX_PARTICLE_FRAME = 1200;
// initializeParticle gives up a sphere sample after this many tries.
const MAX_SPHERE_ATTEMPTS = 5000;
// 2 pi as the native float32 constant.
const TWO_PI_F32 = 6.2831854820251465;

/*
================
ParticleViews

The tables the particle kernel reads and writes (frame-kernels.ts), and
the thread's own scratch.
================
*/
export interface ParticleViews {
	readonly particleDefs: Float64Array;
	readonly particleGraphs: Float64Array;
	readonly particleState: Float64Array;
	readonly particleFrames: Float32Array;
	readonly particleRandom: Float32Array;
	readonly particleWork: Float64Array;
	readonly particleMatrices: Float32Array;
}

/*
================
stateAt

Element e's doubles in the current graph's working half.
================
*/
export function stateAt( v: ParticleViews, e: number ): number {
	return v.particleWork[W_ELEMENTS]! + e * ELEMENT_WORDS;
}

/*
================
framesAt

Element e's floats in the current graph's working half.
================
*/
export function framesAt( v: ParticleViews, e: number ): number {
	return v.particleWork[W_FRAMES]! + e * ELEMENT_FLOATS;
}

/*
================
parentOf
================
*/
export function parentOf( v: ParticleViews, e: number ): number {
	return v.particleState[stateAt( v, e ) + E_PARENT]!;
}

/*
================
ancestorOf

particle-graph.ts ancestor: none for depth 0, else the parent, walked up
depth - 1 more while there is one (the root is its own parent).
================
*/
export function ancestorOf( v: ParticleViews, e: number, depth: number ): number {
	if ( !depth ) return -1;
	let result = parentOf( v, e );
	for ( let n = 1; n < depth && parentOf( v, result ) !== result; n++ ) result = parentOf( v, result );
	return result;
}

/*
================
listIncludes

Whether the list at list holds value (Array includes).
================
*/
export function listIncludes( d: Float64Array, list: number, value: number ): boolean {
	const count = d[list + LIST_COUNT]!;
	for ( let i = 0; i < count; i++ ) if ( d[list + LIST_VALUES + i] === value ) return true;
	return false;
}

/*
================
nextRandom

The next value of the shared table at the graph's cursor
(initializeParticle's random).
================
*/
export function nextRandom( v: ParticleViews ): number {
	const s = v.particleState, at = v.particleWork[W_HALF]! + H_INDEX;
	const index = (s[at]! + 1) % PARTICLE_RANDOM_VALUES;
	s[at] = index;
	return v.particleRandom[index]!;
}

// ============================================================================

/*
================
identityAt

particle-graph.ts setIdentity.
================
*/
export function identityAt( m: Float32Array, at: number ) {
	m.fill( 0, at, at + 16 );
	m[at] =
		m[at + 5] =
		m[at + 10] =
		m[at + 15] =
			1;
}

/*
================
copyMatrix

A Float32Array set: 16 values stored as float32.
================
*/
export function copyMatrix( from: Float32Array | Float64Array, fromAt: number, to: Float32Array, toAt: number ) {
	for ( let i = 0; i < 16; i++ ) to[toAt + i] = from[fromAt + i]!;
}

/*
================
multiplyAt

pose-math.ts multiply: out = a * b, the same double accumulation and
float32 store. out must not alias a or b.
================
*/
export function multiplyAt(
	a: Float32Array | Float64Array,
	aAt: number,
	b: Float32Array | Float64Array,
	bAt: number,
	out: Float32Array,
	outAt: number
) {
	for ( let c = 0; c < 4; c++ ) {
		for ( let r = 0; r < 4; r++ ) {
			out[outAt + c * 4 + r] = ((0 + a[aAt + r]! * b[bAt + c * 4]! + a[aAt + 4 + r]! * b[bAt + c * 4 + 1]!) +
				a[aAt + 8 + r]! * b[bAt + c * 4 + 2]!) +
				a[aAt + 12 + r]! * b[bAt + c * 4 + 3]!;
		}
	}
}

/*
================
affineAt

particle-graph.ts affineInto: out = m * (x, y, z, 1), each component
stored as float32. The inputs are read before out is written.
================
*/
export function affineAt(
	m: Float32Array,
	at: number,
	x: number,
	y: number,
	z: number,
	out: Float64Array,
	outAt: number
) {
	const a = Math.fround( m[at]! * x + m[at + 4]! * y + m[at + 8]! * z + m[at + 12]! ),
		b = Math.fround( m[at + 1]! * x + m[at + 5]! * y + m[at + 9]! * z + m[at + 13]! ),
		c = Math.fround( m[at + 2]! * x + m[at + 6]! * y + m[at + 10]! * z + m[at + 14]! );
	out[outAt] = a;
	out[outAt + 1] = b;
	out[outAt + 2] = c;
}

/*
================
inverseAt

particle-graph.ts inverseInto: the affine inverse, its 3x3 stored as
float32 first and the translation formed from those stored values.
================
*/
export function inverseAt( m: Float32Array, at: number, out: Float32Array, o: number ) {
	const a = m[at]!, b = m[at + 4]!, c = m[at + 8]!, d = m[at + 1]!, e = m[at + 5]!, f = m[at + 9]!;
	const g = m[at + 2]!, h = m[at + 6]!, i = m[at + 10]!;
	const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
	if ( Math.abs( det ) < 1e-12 ) throw Error( "Singular particle motion matrix" );
	out[o] = (e * i - f * h) / det;
	out[o + 1] = (f * g - d * i) / det;
	out[o + 2] = (d * h - e * g) / det;
	out[o + 3] = 0;
	out[o + 4] = (c * h - b * i) / det;
	out[o + 5] = (a * i - c * g) / det;
	out[o + 6] = (b * g - a * h) / det;
	out[o + 7] = 0;
	out[o + 8] = (b * f - c * e) / det;
	out[o + 9] = (c * d - a * f) / det;
	out[o + 10] = (a * e - b * d) / det;
	out[o + 11] = 0;
	out[o + 15] = 1;
	const x = -m[at + 12]!, y = -m[at + 13]!, z = -m[at + 14]!;
	out[o + 12] = out[o + 13] = out[o + 14] = 0;
	const tx = Math.fround( out[o]! * x + out[o + 4]! * y + out[o + 8]! * z + 0 ),
		ty = Math.fround( out[o + 1]! * x + out[o + 5]! * y + out[o + 9]! * z + 0 ),
		tz = Math.fround( out[o + 2]! * x + out[o + 6]! * y + out[o + 10]! * z + 0 );
	out[o + 12] = tx;
	out[o + 13] = ty;
	out[o + 14] = tz;
}

// ============================================================================

/*
================
sampleScaleAt

particle-program.ts sampleScale: the scale graph (points: [time, x, y,
z] each) at at, into out[o..o+2].
================
*/
function sampleScaleAt( d: Float64Array, points: number, at: number, out: Float64Array, o: number ) {
	const count = d[points + LIST_COUNT]!;
	let right = -1;
	for ( let i = 0; i < count; i++ ) {
		if ( d[points + LIST_VALUES + i * 4]! >= at ) {
			right = i;
			break;
		}
	}
	if ( right < 0 ) right = count - 1;
	const left = Math.max( 0, right - 1 );
	const a = points + LIST_VALUES + left * 4, b = points + LIST_VALUES + right * 4;
	const t = left === right ? 0 : Math.max( 0, Math.min( 1, (at - d[a]!) / (d[b]! - d[a]!) ) );
	for ( let i = 0; i < 3; i++ ) out[o + i] = Math.fround( d[a + 1 + i]! * (1 - t) + d[b + 1 + i]! * t );
}

/*
================
coneVector

A cone sample (speed or distance, polar, azimuth draws) into W_CONE,
before any transform.
================
*/
function coneVector( v: ParticleViews, cone: number ) {
	const d = v.particleDefs, w = v.particleWork;
	const speed = Math.fround( nextRandom( v ) * (d[cone + 1]! - d[cone]!) + d[cone]! ),
		polar = Math.fround( nextRandom( v ) * d[cone + 2]! ),
		azimuth = Math.fround( nextRandom( v ) * TWO_PI_F32 );
	const x = Math.fround( -Math.sin( polar ) * speed );
	w[W_CONE] = Math.fround( x * Math.cos( azimuth ) );
	w[W_CONE + 1] = Math.fround( Math.cos( polar ) * speed );
	w[W_CONE + 2] = Math.fround( x * Math.sin( azimuth ) );
}

/*
================
transformCone

The cone sample by the transform's 3x3, plus its translation when
translate (cone velocities do; positions add it apart).
================
*/
function transformCone( v: ParticleViews, transformAt: number, translate: boolean ) {
	const w = v.particleWork, t = v.particleFrames;
	const x = w[W_CONE]!, y = w[W_CONE + 1]!, z = w[W_CONE + 2]!;
	for ( let i = 0; i < 3; i++ ) {
		w[W_CONE + i] = translate ?
			Math.fround(
				x * t[transformAt + i]! + y * t[transformAt + 4 + i]! + z * t[transformAt + 8 + i]! +
					t[transformAt + 12 + i]!
			) :
			Math.fround( x * t[transformAt + i]! + y * t[transformAt + 4 + i]! + z * t[transformAt + 8 + i]! );
	}
}

/*
================
initializeAt

particle-program.ts initializeParticle on program q (-1 for an empty one)
with the transform at transformAt in particleFrames: the sample's
position, velocity and scale into W_SAMPLE_*, the cursor advanced in
place. coneFlags, when not -1, stands for both the program's cone and
cone force flags, and sphereFlags for its sphere flags (a command's
sample, particle-graph.ts commands).
================
*/
export function initializeAt(
	v: ParticleViews,
	q: number,
	coneFlags: number,
	sphereFlags: number,
	transformAt: number
) {
	const d = v.particleDefs, w = v.particleWork, t = v.particleFrames;
	for ( let i = 0; i < 3; i++ ) {
		w[W_SAMPLE_POSITION + i] = 0;
		w[W_SAMPLE_VELOCITY + i] = 0;
		w[W_SAMPLE_SCALE + i] = 1;
	}
	if ( q < 0 ) return;
	const order = d[q + Q_ORDER]!, ops = order < 0 ? DEFAULT_OPS : d[order + LIST_COUNT]!;
	const sphereMode = sphereFlags >= 0 ? sphereFlags : d[q + Q_SPHERE_FLAGS]!;
	const coneMode = coneFlags >= 0 ? coneFlags : d[q + Q_CONE_FLAGS]!;
	const forceMode = coneFlags >= 0 ? coneFlags : d[q + Q_CONE_FORCE_FLAGS]!;
	for ( let k = 0; k < ops; k++ ) {
		const op = order >= 0 ?
			d[order + LIST_VALUES + k]! :
			k === 0 ?
			PROGRAM_OP_SPHERE :
			k === 1 ?
			PROGRAM_OP_SCALE :
			PROGRAM_OP_CONE;
		const sphere = d[q + Q_SPHERE]!;
		if ( op === PROGRAM_OP_SPHERE && sphere >= 0 && sphereMode !== SPHERE_POS_SIBLING ) {
			let attempts = 0, length = 0;
			do {
				for ( let i = 0; i < 3; i++ ) w[W_SAMPLE_POSITION + i] = Math.fround( (nextRandom( v ) - 0.5) * 2 );
				if ( ++attempts > MAX_SPHERE_ATTEMPTS ) throw Error( "Invalid particle random stream" );
				const x = w[W_SAMPLE_POSITION]!, y = w[W_SAMPLE_POSITION + 1]!, z = w[W_SAMPLE_POSITION + 2]!;
				length = ((0 + x * x) + y * y) + z * z;
			} while ( length > 1 );
			for ( let i = 0; i < 3; i++ ) {
				w[W_SAMPLE_POSITION + i] = Math.fround( w[W_SAMPLE_POSITION + i]! * d[sphere + i]! );
			}
		}
		const scale = d[q + Q_SCALE]!;
		if ( op === PROGRAM_OP_SCALE && scale >= 0 ) sampleScaleAt( d, scale, nextRandom( v ), w, W_SAMPLE_SCALE );
		const cone = d[q + Q_CONE]!;
		if ( op === PROGRAM_OP_CONE && cone >= 0 ) {
			coneVector( v, cone );
			if ( coneMode === 2 ) transformCone( v, transformAt, true );
			for ( let i = 0; i < 3; i++ ) w[W_SAMPLE_VELOCITY + i] = w[W_CONE + i]!;
		}
		const force = d[q + Q_CONE_FORCE]!;
		if ( op === PROGRAM_OP_CONE_FORCE && force >= 0 ) {
			coneVector( v, force );
			if ( forceMode === 2 ) transformCone( v, transformAt, true );
			for ( let i = 0; i < 3; i++ ) {
				w[W_SAMPLE_VELOCITY + i] = Math.fround( w[W_SAMPLE_VELOCITY + i]! + w[W_CONE + i]! );
			}
		}
		const position = d[q + Q_CONE_POS]!;
		if ( op === PROGRAM_OP_CONE_POS && position >= 0 ) {
			const mode = d[q + Q_CONE_POS_FLAGS]!;
			coneVector( v, position );
			if ( mode === 2 || mode === 7 ) transformCone( v, transformAt, false );
			if ( mode === 7 ) {
				for ( let i = 0; i < 3; i++ ) w[W_CONE + i] = Math.fround( w[W_CONE + i]! + t[transformAt + 12 + i]! );
			}
			for ( let i = 0; i < 3; i++ ) {
				w[W_SAMPLE_POSITION + i] = Math.fround( w[W_SAMPLE_POSITION + i]! + w[W_CONE + i]! );
			}
		}
	}
}

/*
================
advanceMotion

particle-program.ts advanceParticle of element e to frame with its
emitter's motion program q (the update program without spin and
attraction, -1 for none). A graph element never has an angular velocity.
================
*/
export function advanceMotion( v: ParticleViews, e: number, q: number, frame: number ) {
	const s = v.particleState, d = v.particleDefs, at = stateAt( v, e );
	if ( !Number.isSafeInteger( frame ) || frame < s[at + E_FRAME]! || frame > MAX_PARTICLE_FRAME ) {
		throw Error( "Invalid particle frame" );
	}
	const scale = q < 0 ? -1 : d[q + Q_SCALE]!, frames = q < 0 ? -1 : d[q + Q_SCALE_FRAMES]!;
	for ( let n = s[at + E_FRAME]!; n < frame; n++ ) {
		for ( let axis = 0; axis < 3; axis++ ) {
			s[at + E_POSITION + axis] = Math.fround( s[at + E_POSITION + axis]! + s[at + E_VELOCITY + axis]! );
		}
		if ( scale >= 0 && frames >= 0 && listIncludes( d, frames, n + 1 ) ) {
			sampleScaleAt( d, scale, nextRandom( v ), s, at + E_SCALE );
		}
	}
	s[at + E_FRAME] = frame;
}

// ============================================================================

/*
================
setPositionAt

particle-graph.ts setPosition of element e from the 3 doubles at value:
AF4410 modes 0..11 pick an additive origin and an optional matrix.
================
*/
export function setPositionAt( v: ParticleViews, e: number, value: number, flag: number, sibling: number ) {
	const s = v.particleState, d = v.particleDefs, w = v.particleWork;
	const originMode = flag % 3;
	if ( (originMode === 2 || flag >= 9) && sibling < 0 ) return;
	w[W_VECTOR] = d[value]!;
	w[W_VECTOR + 1] = d[value + 1]!;
	w[W_VECTOR + 2] = d[value + 2]!;
	if ( flag >= 3 ) {
		const basis = flag < 6 ? e : flag < 9 ? parentOf( v, e ) : sibling;
		affineAt(
			v.particleFrames,
			framesAt( v, basis ) + F_MATRIX,
			w[W_VECTOR]!,
			w[W_VECTOR + 1]!,
			w[W_VECTOR + 2]!,
			w,
			W_VECTOR
		);
	}
	const base = originMode === 1 ? parentOf( v, e ) : originMode === 2 ? sibling : -1;
	const position = stateAt( v, e ) + E_POSITION;
	if ( base >= 0 ) {
		const from = stateAt( v, base ) + E_POSITION;
		s[position] = s[from]!;
		s[position + 1] = s[from + 1]!;
		s[position + 2] = s[from + 2]!;
	}
	for ( let i = 0; i < 3; i++ ) s[position + i] = Math.fround( s[position + i]! + w[W_VECTOR + i]! );
}

/*
================
vectorsAt

particle-graph.ts vectors: the SetPosition, SetVelocity and Force
commands of the list at list scheduled on frame (all of them when
everyFrame) on element e.
================
*/
export function vectorsAt(
	v: ParticleViews,
	e: number,
	list: number,
	frame: number,
	sibling: number,
	everyFrame: boolean
) {
	const s = v.particleState, d = v.particleDefs, w = v.particleWork, count = d[list + LIST_COUNT]!;
	for ( let o = 0; o < count; o++ ) {
		const op = list + LIST_VALUES + o * VECTOR_RECORD;
		if ( !everyFrame && !listIncludes( d, d[op + V_FRAMES]!, frame ) ) continue;
		const flag = d[op + V_FLAGS]!;
		w[W_VECTOR] = d[op + V_VALUE]!;
		w[W_VECTOR + 1] = d[op + V_VALUE + 1]!;
		w[W_VECTOR + 2] = d[op + V_VALUE + 2]!;
		if ( d[op + V_NAME] === VECTOR_SET_POSITION ) {
			setPositionAt( v, e, op + V_VALUE, flag, sibling );
			continue;
		}
		if ( flag === 3 && sibling < 0 ) continue;
		if ( flag ) {
			const basis = flag === 1 ? e : flag === 2 ? parentOf( v, e ) : sibling;
			affineAt(
				v.particleFrames,
				framesAt( v, basis ) + F_MATRIX,
				w[W_VECTOR]!,
				w[W_VECTOR + 1]!,
				w[W_VECTOR + 2]!,
				w,
				W_VECTOR
			);
		}
		const velocity = stateAt( v, e ) + E_VELOCITY, force = d[op + V_NAME] === VECTOR_FORCE;
		for ( let i = 0; i < 3; i++ ) {
			s[velocity + i] = Math.fround( w[W_VECTOR + i]! + (force ? s[velocity + i]! : 0) );
		}
	}
}

/*
================
attractAt

particle-graph.ts attract: element e's velocity pulled by its offset from
source, signed strength over distance.
================
*/
export function attractAt( v: ParticleViews, e: number, source: number, strength: number ) {
	const s = v.particleState, at = stateAt( v, e ), from = stateAt( v, source ) + E_POSITION;
	const position = at + E_POSITION, velocity = at + E_VELOCITY;
	const d0 = s[position]! - s[from]!, d1 = s[position + 1]! - s[from + 1]!, d2 = s[position + 2]! - s[from + 2]!;
	const length = hypot3( d0, d1, d2 );
	// Not a negated test: a NaN distance skips the pull, as native does.
	if ( !(length > 1e-6) ) return;
	s[velocity] = Math.fround( s[velocity]! + d0 * strength / length );
	s[velocity + 1] = Math.fround( s[velocity + 1]! + d1 * strength / length );
	s[velocity + 2] = Math.fround( s[velocity + 2]! + d2 * strength / length );
}

/*
================
commandsAt

particle-graph.ts commands: emitter def's commands firing at age on
element e.
================
*/
export function commandsAt( v: ParticleViews, e: number, def: number, age: number, sibling: number ) {
	const s = v.particleState, d = v.particleDefs, f = v.particleFrames, m = v.particleMatrices;
	const w = v.particleWork, list = d[def + D_COMMANDS]!;
	if ( list < 0 ) return;
	const count = d[list + LIST_COUNT]!, at = stateAt( v, e ), matrix = framesAt( v, e ) + F_MATRIX;
	for ( let c = 0; c < count; c++ ) {
		const command = list + LIST_VALUES + c * COMMAND_RECORD;
		if ( !listIncludes( d, d[command + C_FRAMES]!, age ) ) continue;
		const flags = d[command + C_FLAGS]!, rotations = d[command + C_ROTATIONS]!;
		if ( rotations >= 0 && d[rotations + LIST_COUNT]! > 0 ) {
			const rotation = rotations + LIST_VALUES + Math.min( age, d[rotations + LIST_COUNT]! - 1 ) * 16;
			// AF4581: BAN mode 2 is frame * parent in native row storage.
			// Our transposed storage reverses those operands.
			if ( flags === 3 && sibling < 0 ) continue;
			if ( flags === 0 ) copyMatrix( d, rotation, f, matrix );
			else {
				const basis = framesAt( v, flags === 1 ? e : flags === 2 ? parentOf( v, e ) : sibling ) + F_MATRIX;
				// AF4559 appends BAN frames; AF448A prepends constant rotations.
				if ( flags === 1 && d[command + C_BAN_ROTATION] === 1 ) {
					multiplyAt( d, rotation, f, basis, m, M_MATRIX );
				} else multiplyAt( f, basis, d, rotation, m, M_MATRIX );
				copyMatrix( m, M_MATRIX, f, matrix );
			}
			continue;
		}
		const positions = d[command + C_POSITIONS]!;
		if ( positions >= 0 && d[positions + LIST_COUNT]! > 0 ) {
			const value = positions + LIST_VALUES + Math.min( age, d[positions + LIST_COUNT]! - 1 ) * 3;
			setPositionAt( v, e, value, flags, sibling );
			continue;
		}
		const q = d[command + C_PROGRAM]!;
		if ( d[q + Q_VECTORS]! >= 0 ) {
			// A command's vectors all run on the frame the command fires.
			vectorsAt( v, e, d[q + Q_VECTORS]!, age, sibling, true );
			continue;
		}
		if ( d[q + Q_R_VELOCITY]! >= 0 ) {
			copyMatrix( d, d[q + Q_R_VELOCITY]!, f, framesAt( v, e ) + F_LOCAL );
			continue;
		}
		if ( d[q + Q_SPIN]! >= 0 ) {
			copyMatrix( d, d[q + Q_SPIN]!, f, framesAt( v, e ) + F_SHAPE );
			continue;
		}
		if ( d[q + Q_SHAPE]! >= 0 ) {
			copyMatrix( d, d[q + Q_SHAPE]!, f, framesAt( v, e ) + F_ROTATION );
			continue;
		}
		if ( d[q + Q_ATTRACTION_SET] === 1 ) {
			attractAt( v, e, parentOf( v, e ), d[q + Q_ATTRACTION]! );
			continue;
		}
		// coneFlags ?? coneForceFlags ?? 0
		const own = d[q + Q_CONE_FLAGS]! >= 0 ?
			d[q + Q_CONE_FLAGS]! :
			d[q + Q_CONE_FORCE_FLAGS]! >= 0 ?
			d[q + Q_CONE_FORCE_FLAGS]! :
			0;
		if ( own === 3 && sibling < 0 ) continue;
		// 0x39 runs only with a sibling and draws no random numbers otherwise.
		const sphereFlags = d[q + Q_SPHERE_FLAGS]! >= 0 ? d[q + Q_SPHERE_FLAGS]! : SPHERE_POS_PARENT;
		if ( d[q + Q_SPHERE]! >= 0 && sphereFlags === SPHERE_POS_SIBLING && sibling < 0 ) continue;
		const basis = own === 1 ? e : own === 3 ? sibling : parentOf( v, e );
		initializeAt( v, q, own ? 2 : 0, SPHERE_POS_PARENT, framesAt( v, basis ) + F_MATRIX );
		const position = at + E_POSITION, velocity = at + E_VELOCITY;
		if ( d[q + Q_SPHERE]! >= 0 ) {
			const base = stateAt(
				v,
				sphereFlags === SPHERE_POS_SELF ? e : sphereFlags === SPHERE_POS_SIBLING ? sibling : parentOf( v, e )
			) + E_POSITION;
			for ( let i = 0; i < 3; i++ ) s[position + i] = Math.fround( w[W_SAMPLE_POSITION + i]! + s[base + i]! );
		}
		if ( d[q + Q_CONE_POS]! >= 0 ) {
			for ( let i = 0; i < 3; i++ ) s[position + i] = Math.fround( w[W_SAMPLE_POSITION + i]! + s[position + i]! );
		}
		if ( d[q + Q_CONE]! >= 0 ) {
			for ( let i = 0; i < 3; i++ ) s[velocity + i] = w[W_SAMPLE_VELOCITY + i]!;
		}
		if ( d[q + Q_CONE_FORCE]! >= 0 ) {
			for ( let i = 0; i < 3; i++ ) s[velocity + i] = Math.fround( w[W_SAMPLE_VELOCITY + i]! + s[velocity + i]! );
		}
		if ( d[q + Q_SCALE]! >= 0 ) {
			for ( let i = 0; i < 3; i++ ) s[at + E_SCALE + i] = w[W_SAMPLE_SCALE + i]!;
		}
	}
}

/*
================
emissionAt

particle-emission.ts particleEmission of emitter def from total at its
parent's frame (no period scale, no density): the count to emit; the new
total goes to W_TOTAL.
================
*/
export function emissionAt( v: ParticleViews, def: number, total: number, parentFrame: number ): number {
	const d = v.particleDefs, w = v.particleWork;
	const start = d[def + D_START]!, duration = d[def + D_DURATION]!, period = d[def + D_PERIOD]!;
	const limit = d[def + D_LIMIT]!, rate = d[def + D_RATE]!;
	if (
		!Number.isSafeInteger( start ) || !Number.isSafeInteger( duration ) || !Number.isSafeInteger( period ) ||
		!Number.isSafeInteger( limit ) || !Number.isSafeInteger( parentFrame ) || start < 0 || duration < 0 ||
		period < 0 || limit < 0 || !Number.isFinite( rate ) || rate < 0 || !Number.isFinite( total ) || total < 0
	) throw new Error( "Invalid particle emission state" );
	w[W_TOTAL] = total;
	const age = parentFrame - start;
	if ( age >= duration ) return 0;
	if ( age < 0 || period <= 0 || age % period !== 0 ) return 0;
	const next = Math.fround( Math.min( limit, total + rate ) );
	w[W_TOTAL] = next;
	return Math.trunc( next ) - Math.trunc( total );
}
