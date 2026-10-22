/*
===========================================================================

particle-kernel.ts - one particle graph's frame, on flat memory

particle-graph.ts advanceParticleGraph ported onto one graph instance's
flat state (particle-record.ts), so any thread can run it: the region
shift, the root's holder frame, then each whole 20 Hz tick due: the live
elements' tick start, retirement and release, emission into released or
new slots, the sibling index, and each emitter's births in slot order
(created, moved, commanded). Afterwards the drawn emitters' GPU records
are written (particle-output.ts).

The run reads the current half and writes the other, copying only each
emitter's used rows, so a chunk run again after a stalled worker starts
from the same state; the owner (renderer/characters/particle-graphs.ts)
switches halves after the phase. Element operations are particle-step.ts.
Every expression keeps the object code's order and float32 stores, so
given the same random table and cursor the state and records are the same
bits (particle-kernel.test.mjs drives both). Allocation-free.

===========================================================================
*/
import { LINK_MATRIX, LINK_TRANSLATE, LINK_TURN } from "@/engine/foundation/animation/particle-holder-link";
import {
	D_BASE,
	D_BIRTHS,
	D_COMMANDS,
	D_EMISSION,
	D_FOLLOW_DEPTH,
	D_FRAMES,
	D_KEEP_MATRIX,
	D_KEEP_ORIGIN,
	D_LOCAL_MOTION,
	D_LOOP,
	D_MATRIX,
	D_MATRIX_DEPTH,
	D_MOTION,
	D_PARENT,
	D_PARENTS,
	D_POSITION_DEPTH,
	D_POSITIONS,
	D_PROGRAM,
	D_RECORDS,
	D_ROTATIONS,
	D_SCALES,
	D_SHAPE_MOTION,
	D_SIBLINGS,
	D_SLOTS,
	D_PARENT_SLOTS,
	D_STATE,
	D_VELOCITY_DEPTH,
	E_AGE,
	E_ALIVE,
	E_BORN,
	E_CHILDREN,
	E_CLOCK_BIRTH,
	E_FRAME,
	E_GROUP,
	E_HAS_TICK,
	E_ORIGIN,
	E_PARENT,
	E_POSITION,
	E_PRESENT,
	E_PREVIOUS,
	E_RELEASED,
	E_ROOT_LINK,
	E_SCALE,
	E_SERIAL,
	E_TICK_POSITION,
	E_TICK_SCALE,
	E_VELOCITY,
	ELEMENT_FLOATS,
	ELEMENT_WORDS,
	F_DELTA,
	F_LOCAL,
	F_MATRIX,
	F_ROTATION,
	F_SHAPE,
	F_TICK_MATRIX,
	F_TICK_ROTATION,
	G_CURRENT,
	G_DEF,
	G_FRAMES,
	G_KEEP_ROOTS,
	G_SHIFT_X,
	G_SHIFT_Z,
	G_STATE,
	G_STOP,
	G_TIME,
	G_TRANSFORM,
	GD_ELEMENTS,
	GD_ELEMENTS_AT,
	GD_EMITTERS,
	GD_HALF_FLOATS,
	GD_HALF_WORDS,
	GD_HEADER,
	GD_HORIZON,
	H_FRAME,
	H_HEADER,
	H_SERIAL,
	K_ORDERED,
	LIST_COUNT,
	LIST_VALUES,
	M_INVERSE,
	M_MATRIX,
	M_PREVIOUS,
	PARTICLE_GRAPH_RECORD,
	Q_ATTRACTION,
	Q_ATTRACTION_FRAMES,
	Q_ATTRACTION_SET,
	Q_CONE,
	Q_R_VELOCITY,
	Q_ROTATION_FRAMES,
	Q_SHAPE,
	Q_SPIN,
	Q_SPIN_FRAMES,
	Q_VECTORS,
	S_ARRAYS,
	S_GROUPS,
	S_LIVE,
	S_ROWS,
	W_DEF,
	W_ELEMENTS,
	W_FRAMES,
	W_HALF,
	W_INHERITED,
	W_OLD_ROOT,
	W_ROOT,
	W_SAMPLE_POSITION,
	W_SAMPLE_SCALE,
	W_SAMPLE_VELOCITY,
	W_SCRATCH,
	W_TOTAL
} from "./particle-record";
import {
	advanceMotion,
	affineAt,
	ancestorOf,
	attractAt,
	commandsAt,
	copyMatrix,
	emissionAt,
	framesAt,
	identityAt,
	initializeAt,
	inverseAt,
	listIncludes,
	multiplyAt,
	type ParticleViews,
	stateAt,
	vectorsAt
} from "./particle-step";
import { writeEmitterRecords } from "./particle-output";

// A2E980: whole 50 ms effect ticks.
const TICKS_PER_SECOND = 20;

/*
================
emitterAt

Emitter n's D_* record.
================
*/
function emitterAt( v: ParticleViews, n: number ): number {
	return v.particleDefs[v.particleWork[W_DEF]! + GD_HEADER + n]!;
}

/*
================
emitterState

Emitter record def's S_* state in the working half.
================
*/
function emitterState( v: ParticleViews, def: number ): number {
	return v.particleWork[W_HALF]! + v.particleDefs[def + D_STATE]!;
}

/*
================
ownerSlot

The slot of a group owner in its emitter (the root's is 0), which indexes
the group totals of an emission emitter def.
================
*/
function ownerSlot( v: ParticleViews, def: number, owner: number ): number {
	const parent = v.particleDefs[def + D_PARENT]!;
	return parent < 0 ? 0 : owner - v.particleDefs[emitterAt( v, parent ) + D_BASE]!;
}

/*
================
groupsAt

An emission emitter's group owners (Map order) in the working half; the
totals follow them, one per owner slot.
================
*/
function groupsAt( v: ParticleViews, def: number ): number {
	return emitterState( v, def ) + S_ARRAYS + 2 * v.particleDefs[def + D_SLOTS]!;
}

/*
================
groupTotalAt

The total of owner's group of emission emitter def.
================
*/
function groupTotalAt( v: ParticleViews, def: number, owner: number ): number {
	return groupsAt( v, def ) + v.particleDefs[def + D_PARENT_SLOTS]! + ownerSlot( v, def, owner );
}

/*
================
hasGroup
================
*/
function hasGroup( v: ParticleViews, def: number, owner: number ): boolean {
	const s = v.particleState, order = groupsAt( v, def ), count = s[emitterState( v, def ) + S_GROUPS]!;
	for ( let i = 0; i < count; i++ ) if ( s[order + i] === owner ) return true;
	return false;
}

/*
================
openGroups

Element e of emitter n was born: every emission child emitter gains its
group, last in Map order, with a zero total.
================
*/
function openGroups( v: ParticleViews, n: number, e: number ) {
	const s = v.particleState, d = v.particleDefs, emitters = d[v.particleWork[W_DEF]! + GD_EMITTERS]!;
	for ( let c = 0; c < emitters; c++ ) {
		const child = emitterAt( v, c );
		if ( d[child + D_PARENT] !== n || d[child + D_EMISSION] !== 1 ) continue;
		const state = emitterState( v, child ), count = s[state + S_GROUPS]!;
		s[groupsAt( v, child ) + count] = e;
		s[state + S_GROUPS] = count + 1;
		s[groupTotalAt( v, child, e )] = 0;
	}
}

/*
================
closeGroups

Released element e of emitter n leaves every Map it keys.
================
*/
function closeGroups( v: ParticleViews, n: number, e: number ) {
	const s = v.particleState, d = v.particleDefs, emitters = d[v.particleWork[W_DEF]! + GD_EMITTERS]!;
	for ( let c = 0; c < emitters; c++ ) {
		const child = emitterAt( v, c );
		if ( d[child + D_PARENT] !== n || d[child + D_EMISSION] !== 1 ) continue;
		const state = emitterState( v, child ), order = groupsAt( v, child ), count = s[state + S_GROUPS]!;
		let found = -1;
		for ( let i = 0; i < count; i++ ) {
			if ( s[order + i] === e ) {
				found = i;
				break;
			}
		}
		if ( found < 0 ) continue;
		for ( let i = found; i < count - 1; i++ ) s[order + i] = s[order + i + 1]!;
		s[state + S_GROUPS] = count - 1;
	}
}

/*
================
snapshotTick

particle-presentation.ts snapshotParticleTick of element e with its
element frame.
================
*/
function snapshotTick( v: ParticleViews, e: number ) {
	const s = v.particleState, f = v.particleFrames, at = stateAt( v, e ), frames = framesAt( v, e );
	for ( let axis = 0; axis < 3; axis++ ) {
		s[at + E_TICK_POSITION + axis] = s[at + E_POSITION + axis]!;
		s[at + E_TICK_SCALE + axis] = s[at + E_SCALE + axis]!;
	}
	for ( let i = 0; i < 16; i++ ) {
		f[frames + F_TICK_ROTATION + i] = f[frames + F_ROTATION + i]!;
		f[frames + F_TICK_MATRIX + i] = f[frames + F_MATRIX + i]!;
	}
	s[at + E_HAS_TICK] = 1;
}

/*
================
copy3At
================
*/
function copy3At( s: Float64Array, from: number, to: number ) {
	s[to] = s[from]!;
	s[to + 1] = s[from + 1]!;
	s[to + 2] = s[from + 2]!;
}

/*
================
rootLinkFlagsAt

particle-holder-link.ts rootLinkFlags over element indices.
================
*/
function rootLinkFlagsAt( v: ParticleViews, position: number, follow: number, matrix: number ): number {
	const s = v.particleState, root = v.particleWork[W_ROOT]!;
	let flags = 0;
	if ( position >= 0 && (position === root || (s[stateAt( v, position ) + E_ROOT_LINK]! & LINK_MATRIX) !== 0) ) {
		flags |= LINK_TURN;
	}
	if ( follow >= 0 && (follow === root || (s[stateAt( v, follow ) + E_ROOT_LINK]! & LINK_TRANSLATE) !== 0) ) {
		flags |= LINK_TRANSLATE;
	}
	if ( matrix >= 0 && (matrix === root || (s[stateAt( v, matrix ) + E_ROOT_LINK]! & LINK_MATRIX) !== 0) ) {
		flags |= LINK_MATRIX;
	}
	return flags;
}

// ============================================================================

/*
================
copyHalf

The working half from the current one: header, each emitter's state
(used births and parents, listed groups), each emitter's used rows of
elements and the root.
================
*/
function copyHalf( v: ParticleViews, from: number, fromFrames: number ) {
	const s = v.particleState, d = v.particleDefs, f = v.particleFrames, w = v.particleWork;
	const def = w[W_DEF]!, half = w[W_HALF]!, emitters = d[def + GD_EMITTERS]!, at = d[def + GD_ELEMENTS_AT]!;
	const shift = from - half, frames = w[W_FRAMES]!;
	s.copyWithin( half, from, from + H_HEADER );
	for ( let n = 0; n < emitters; n++ ) {
		const emitter = emitterAt( v, n ), state = emitterState( v, emitter );
		const rows = s[state + shift + S_ROWS]!, base = d[emitter + D_BASE]!;
		s.copyWithin( state, state + shift, state + shift + S_ARRAYS );
		if ( d[emitter + D_EMISSION] === 1 ) {
			const slots = d[emitter + D_SLOTS]!, births = state + S_ARRAYS, order = groupsAt( v, emitter );
			s.copyWithin( births, births + shift, births + shift + rows );
			s.copyWithin( births + slots, births + slots + shift, births + slots + shift + rows );
			const count = s[state + S_GROUPS]!;
			s.copyWithin( order, order + shift, order + shift + count );
			for ( let i = 0; i < count; i++ ) {
				const total = groupTotalAt( v, emitter, s[order + i]! );
				s[total] = s[total + shift]!;
			}
		}
		s.copyWithin(
			half + at + base * ELEMENT_WORDS,
			from + at + base * ELEMENT_WORDS,
			from + at + (base + rows) * ELEMENT_WORDS
		);
		f.copyWithin(
			frames + base * ELEMENT_FLOATS,
			fromFrames + base * ELEMENT_FLOATS,
			fromFrames + (base + rows) * ELEMENT_FLOATS
		);
	}
	const root = d[def + GD_ELEMENTS]!;
	s.copyWithin(
		half + at + root * ELEMENT_WORDS,
		from + at + root * ELEMENT_WORDS,
		from + at + (root + 1) * ELEMENT_WORDS
	);
	f.copyWithin(
		frames + root * ELEMENT_FLOATS,
		fromFrames + root * ELEMENT_FLOATS,
		fromFrames + (root + 1) * ELEMENT_FLOATS
	);
}

/*
================
shiftOrigin

A region crossing: every retained element and the root move by the shift.
================
*/
function shiftOrigin( v: ParticleViews, shiftX: number, shiftZ: number ) {
	const s = v.particleState, d = v.particleDefs, emitters = d[v.particleWork[W_DEF]! + GD_EMITTERS]!;
	for ( let n = 0; n < emitters; n++ ) {
		const emitter = emitterAt( v, n ), rows = s[emitterState( v, emitter ) + S_ROWS]!, base = d[emitter + D_BASE]!;
		for ( let b = 0; b < rows; b++ ) {
			const e = stateAt( v, base + b );
			if ( s[e + E_PRESENT] !== 1 ) continue;
			s[e + E_POSITION]! += shiftX;
			s[e + E_POSITION + 2]! += shiftZ;
			s[e + E_ORIGIN]! += shiftX;
			s[e + E_ORIGIN + 2]! += shiftZ;
			s[e + E_PREVIOUS]! += shiftX;
			s[e + E_PREVIOUS + 2]! += shiftZ;
		}
	}
	const root = stateAt( v, v.particleWork[W_ROOT]! );
	s[root + E_POSITION]! += shiftX;
	s[root + E_POSITION + 2]! += shiftZ;
}

/*
================
startTick

The live elements' tick start: their pose snapshot, a looping clock's
wrap, their age, and retirement past their frames.
================
*/
function startTick( v: ParticleViews, tick: number, stop: number, keepRoots: boolean ) {
	const s = v.particleState,
		d = v.particleDefs,
		f = v.particleFrames,
		emitters = d[v.particleWork[W_DEF]! + GD_EMITTERS]!;
	for ( let n = 0; n < emitters; n++ ) {
		const emitter = emitterAt( v, n ), rows = s[emitterState( v, emitter ) + S_ROWS]!, base = d[emitter + D_BASE]!;
		const frames = d[emitter + D_FRAMES]!;
		const loops = d[emitter + D_LOOP] === 1 ||
			keepRoots && d[emitter + D_PARENT]! < 0 && tick / TICKS_PER_SECOND < stop;
		for ( let b = 0; b < rows; b++ ) {
			const e = base + b, at = stateAt( v, e );
			if ( s[at + E_PRESENT] !== 1 || s[at + E_ALIVE] !== 1 ) continue;
			copy3At( s, at + E_POSITION, at + E_PREVIOUS );
			snapshotTick( v, e );
			if ( loops && tick - s[at + E_CLOCK_BIRTH]! >= frames ) {
				s[at + E_CLOCK_BIRTH]! += Math.floor( (tick - s[at + E_CLOCK_BIRTH]!) / frames ) * frames;
			}
			s[at + E_AGE] = tick - s[at + E_CLOCK_BIRTH]!;
			if ( s[at + E_AGE]! >= frames ) {
				s[at + E_ALIVE] = 0;
				const owner = s[at + E_GROUP]!;
				if ( owner >= 0 ) {
					const total = groupTotalAt( v, emitter, owner );
					s[total] = Math.fround( s[total]! - 1 );
				}
				copy3At( s, at + E_POSITION, at + E_ORIGIN );
				identityAt( f, framesAt( v, e ) + F_DELTA );
			}
		}
	}
}

/*
================
releaseElements

AF2A40 returns capacity on retirement, even while descendants retain the
dead parent: identity is released only once the last descendant lets it
go, so this repeats until a pass releases none.
================
*/
function releaseElements( v: ParticleViews ) {
	const s = v.particleState, d = v.particleDefs, emitters = d[v.particleWork[W_DEF]! + GD_EMITTERS]!;
	let released = true;
	while ( released ) {
		released = false;
		for ( let n = 0; n < emitters; n++ ) {
			const emitter = emitterAt( v, n ),
				rows = s[emitterState( v, emitter ) + S_ROWS]!,
				base = d[emitter + D_BASE]!;
			for ( let b = 0; b < rows; b++ ) {
				const e = base + b, at = stateAt( v, e );
				if (
					s[at + E_PRESENT] !== 1 || s[at + E_ALIVE] === 1 || s[at + E_CHILDREN] !== 0 ||
					s[at + E_RELEASED] === 1
				) continue;
				s[at + E_RELEASED] = 1;
				s[stateAt( v, s[at + E_PARENT]! ) + E_CHILDREN]!--;
				closeGroups( v, n, e );
				released = true;
			}
		}
	}
}

/*
================
emit

An emission emitter's groups emit into released or new slots, reserved
before any birth is evaluated.
================
*/
function emit( v: ParticleViews, emitter: number, tick: number ) {
	const s = v.particleState, d = v.particleDefs, w = v.particleWork;
	const state = emitterState( v, emitter ), order = groupsAt( v, emitter ), count = s[state + S_GROUPS]!;
	const base = d[emitter + D_BASE]!, slots = d[emitter + D_SLOTS]!, births = state + S_ARRAYS;
	for ( let i = 0; i < count; i++ ) {
		const owner = s[order + i]!, ownerAt = stateAt( v, owner );
		if ( s[ownerAt + E_ALIVE] !== 1 ) continue;
		const total = groupTotalAt( v, emitter, owner );
		const emitted = emissionAt( v, emitter, s[total]!, s[ownerAt + E_AGE]! );
		s[total] = w[W_TOTAL]!;
		for ( let k = 0; k < emitted; k++ ) {
			const rows = s[state + S_ROWS]!;
			let slot = rows;
			for ( let b = 0; b < rows; b++ ) {
				const at = stateAt( v, base + b );
				if ( s[at + E_PRESENT] === 1 && s[at + E_RELEASED] === 1 ) {
					slot = b;
					break;
				}
			}
			if ( slot >= slots ) throw Error( "Particle live capacity exceeded" );
			s[stateAt( v, base + slot ) + E_PRESENT] = 0;
			s[births + slot] = tick;
			s[births + slots + slot] = owner;
			s[state + S_ROWS] = Math.max( rows, slot + 1 );
		}
	}
}

/*
================
indexSiblings

An emitter whose elements read their sibling: its alive elements in birth
(serial) order, each given the latest earlier one of the same parent.
================
*/
function indexSiblings( v: ParticleViews, emitter: number ) {
	const s = v.particleState, d = v.particleDefs, w = v.particleWork;
	const elements = d[w[W_DEF]! + GD_ELEMENTS]!, scratch = w[W_SCRATCH]!;
	const ordered = scratch + K_ORDERED, siblings = ordered + elements, latest = siblings + elements + 1;
	const parent = d[emitter + D_PARENT]!;
	if ( parent < 0 ) s[latest + elements] = -1;
	else {
		const first = d[emitterAt( v, parent ) + D_BASE]!, end = first + d[emitterAt( v, parent ) + D_SLOTS]!;
		for ( let p = first; p < end; p++ ) s[latest + p] = -1;
	}
	const rows = s[emitterState( v, emitter ) + S_ROWS]!, base = d[emitter + D_BASE]!;
	let count = 0;
	for ( let b = 0; b < rows; b++ ) {
		const e = base + b, at = stateAt( v, e );
		s[siblings + e] = -1;
		if ( s[at + E_PRESENT] !== 1 || s[at + E_ALIVE] !== 1 ) continue;
		// Insertion by serial: slots are recycled, serials keep birth order.
		let i = count++;
		while ( i > 0 && s[stateAt( v, s[ordered + i - 1]! ) + E_SERIAL]! > s[at + E_SERIAL]! ) {
			s[ordered + i] = s[ordered + i - 1]!;
			i--;
		}
		s[ordered + i] = e;
	}
	for ( let i = 0; i < count; i++ ) {
		const e = s[ordered + i]!, owner = s[stateAt( v, e ) + E_PARENT]!;
		s[siblings + e] = s[latest + owner]!;
		s[latest + owner] = e;
	}
}

/*
================
birthElement

A new element of emitter n in slot b of parent: its program's sample at
the parent, the parent's frame and position, its groups, and the
velocity it inherits.
================
*/
function birthElement(
	v: ParticleViews,
	n: number,
	emitter: number,
	b: number,
	parent: number,
	birth: number,
	sibling: number
) {
	const s = v.particleState, d = v.particleDefs, f = v.particleFrames, w = v.particleWork;
	const e = d[emitter + D_BASE]! + b, at = stateAt( v, e ), frames = framesAt( v, e );
	const parentAt = stateAt( v, parent ), parentFrames = framesAt( v, parent );
	const commanded = d[emitter + D_COMMANDS]! >= 0, program = commanded ? -1 : d[emitter + D_PROGRAM]!;
	initializeAt( v, program, -1, -1, parentFrames + F_MATRIX );
	w[W_INHERITED] = s[parentAt + E_VELOCITY]!;
	w[W_INHERITED + 1] = s[parentAt + E_VELOCITY + 1]!;
	w[W_INHERITED + 2] = s[parentAt + E_VELOCITY + 2]!;
	for ( let i = 0; i < 3; i++ ) {
		s[at + E_POSITION + i] = Math.fround( w[W_SAMPLE_POSITION + i]! + s[parentAt + E_POSITION + i]! );
		s[at + E_VELOCITY + i] = w[W_SAMPLE_VELOCITY + i]!;
		s[at + E_SCALE + i] = w[W_SAMPLE_SCALE + i]!;
		s[at + E_PREVIOUS + i] = s[at + E_POSITION + i]!;
		s[at + E_ORIGIN + i] = s[parentAt + E_POSITION + i]!;
	}
	const shape = program < 0 ? -1 : d[program + Q_SHAPE]!;
	if ( shape >= 0 ) copyMatrix( d, shape, f, frames + F_ROTATION );
	else identityAt( f, frames + F_ROTATION );
	s[at + E_FRAME] = 0;
	const state = emitterState( v, emitter ), half = w[W_HALF]!;
	s[half + H_SERIAL]!++;
	s[at + E_SERIAL] = s[half + H_SERIAL]!;
	s[at + E_BORN] = birth;
	s[at + E_CLOCK_BIRTH] = birth;
	s[at + E_AGE] = 0;
	s[at + E_ALIVE] = 1;
	s[at + E_CHILDREN] = 0;
	s[at + E_RELEASED] = 0;
	s[at + E_ROOT_LINK] = 0;
	s[at + E_GROUP] = d[emitter + D_EMISSION] === 1 && hasGroup( v, emitter, parent ) ? parent : -1;
	s[at + E_PARENT] = parent;
	s[at + E_PRESENT] = 1;
	s[at + E_HAS_TICK] = 0;
	copyMatrix( f, parentFrames + F_MATRIX, f, frames + F_MATRIX );
	identityAt( f, frames + F_DELTA );
	identityAt( f, frames + F_LOCAL );
	identityAt( f, frames + F_SHAPE );
	// Births out of slot order leave undefined rows below this one. A run
	// again after a stalled worker finds this half's rows from the first
	// try there, so they are cleared, not assumed empty.
	const rows = s[state + S_ROWS]!;
	for ( let hole = rows; hole < b; hole++ ) s[stateAt( v, d[emitter + D_BASE]! + hole ) + E_PRESENT] = 0;
	s[state + S_ROWS] = Math.max( rows, b + 1 );
	if ( d[emitter + D_SIBLINGS] === 1 ) {
		const elements = d[w[W_DEF]! + GD_ELEMENTS]!, latest = w[W_SCRATCH]! + K_ORDERED + 2 * elements + 1;
		s[latest + parent] = e;
	}
	s[parentAt + E_CHILDREN]!++;
	openGroups( v, n, e );
	if ( d[emitter + D_MATRIX_DEPTH]! < 0 ) {
		const x = f[frames + F_MATRIX + 12]!, y = f[frames + F_MATRIX + 13]!, z = f[frames + F_MATRIX + 14]!;
		identityAt( f, frames + F_MATRIX );
		f[frames + F_MATRIX + 12] = x;
		f[frames + F_MATRIX + 13] = y;
		f[frames + F_MATRIX + 14] = z;
	}
	const matrix = d[emitter + D_MATRIX]!;
	if ( matrix >= 0 && !commanded ) copyMatrix( d, matrix, f, frames + F_MATRIX );
	const follow = ancestorOf( v, e, d[emitter + D_FOLLOW_DEPTH]! );
	const followAt = follow < 0 ? -1 : stateAt( v, follow );
	const inheritsVelocity = commanded || program < 0 || d[program + Q_CONE]! < 0;
	for ( let i = 0; i < 3; i++ ) {
		w[W_INHERITED + i] = Math.fround( w[W_INHERITED + i]! - (follow < 0 ? 0 : s[followAt + E_VELOCITY + i]!) );
		s[at + E_POSITION + i] = Math.fround( s[at + E_POSITION + i]! + w[W_INHERITED + i]! );
		if ( inheritsVelocity ) s[at + E_VELOCITY + i] = Math.fround( s[at + E_VELOCITY + i]! + w[W_INHERITED + i]! );
	}
	if ( program >= 0 && d[program + Q_VECTORS]! >= 0 ) vectorsAt( v, e, d[program + Q_VECTORS]!, 0, sibling, false );
}

/*
================
moveElement

A live element's tick: carried by its position, matrix and velocity
parents and its follow, then its motion program, shape spin and vectors.
================
*/
function moveElement( v: ParticleViews, emitter: number, e: number, age: number, sibling: number ) {
	const s = v.particleState, d = v.particleDefs, f = v.particleFrames, m = v.particleMatrices;
	const at = stateAt( v, e ), frames = framesAt( v, e ), position = at + E_POSITION, velocity = at + E_VELOCITY;
	if ( d[emitter + D_KEEP_ORIGIN] === 1 ) copy3At( s, position, at + E_ORIGIN );
	const positionParent = ancestorOf( v, e, d[emitter + D_POSITION_DEPTH]! ),
		matrixParent = ancestorOf( v, e, Math.max( 0, d[emitter + D_MATRIX_DEPTH]! ) ),
		velocityParent = ancestorOf( v, e, d[emitter + D_VELOCITY_DEPTH]! ),
		follow = ancestorOf( v, e, d[emitter + D_FOLLOW_DEPTH]! );
	if ( positionParent >= 0 ) {
		const origin = stateAt( v, positionParent ) + E_ORIGIN;
		affineAt(
			f,
			framesAt( v, positionParent ) + F_DELTA,
			s[position]! - s[origin]!,
			s[position + 1]! - s[origin + 1]!,
			s[position + 2]! - s[origin + 2]!,
			s,
			position
		);
		for ( let i = 0; i < 3; i++ ) s[position + i] = Math.fround( s[position + i]! + s[origin + i]! );
	}
	if ( matrixParent >= 0 ) {
		multiplyAt( f, framesAt( v, matrixParent ) + F_DELTA, f, frames + F_MATRIX, m, M_MATRIX );
		copyMatrix( m, M_MATRIX, f, frames + F_MATRIX );
	}
	if ( d[emitter + D_LOCAL_MOTION] === 1 ) {
		multiplyAt( f, frames + F_MATRIX, f, frames + F_LOCAL, m, M_MATRIX );
		copyMatrix( m, M_MATRIX, f, frames + F_MATRIX );
	}
	if ( velocityParent >= 0 ) {
		affineAt(
			f,
			framesAt( v, velocityParent ) + F_DELTA,
			s[velocity]!,
			s[velocity + 1]!,
			s[velocity + 2]!,
			s,
			velocity
		);
	}
	if ( follow >= 0 ) {
		const followAt = stateAt( v, follow );
		for ( let i = 0; i < 3; i++ ) {
			s[position + i] = Math.fround(
				s[position + i]! + s[followAt + E_POSITION + i]! - s[followAt + E_ORIGIN + i]!
			);
		}
	}
	advanceMotion( v, e, d[emitter + D_MOTION]!, s[at + E_FRAME]! + 1 );
	if ( d[emitter + D_SHAPE_MOTION] === 1 ) {
		multiplyAt( f, frames + F_ROTATION, f, frames + F_SHAPE, m, M_MATRIX );
		copyMatrix( m, M_MATRIX, f, frames + F_ROTATION );
	}
	const program = d[emitter + D_COMMANDS]! >= 0 ? -1 : d[emitter + D_PROGRAM]!;
	if ( program >= 0 && d[program + Q_VECTORS]! >= 0 ) vectorsAt( v, e, d[program + Q_VECTORS]!, age, sibling, false );
}

/*
================
frameIncludes

(frames ?? [ 0 ]).includes( age ): a program frame list, absent for the
first frame only.
================
*/
function frameIncludes( d: Float64Array, list: number, age: number ): boolean {
	return list < 0 ? age === 0 : listIncludes( d, list, age );
}

/*
================
commandElement

A live element's tick after it was created or moved: its holder links,
commands, program rotation, spin and attraction, its emitter's scale,
position and rotation tracks, its kept matrix's delta, its frame.
================
*/
function commandElement(
	v: ParticleViews,
	emitter: number,
	e: number,
	parent: number,
	age: number,
	sibling: number,
	tick: number
) {
	const s = v.particleState, d = v.particleDefs, f = v.particleFrames;
	const at = stateAt( v, e ), frames = framesAt( v, e ), matrixDepth = d[emitter + D_MATRIX_DEPTH]!;
	// Parents tick first, so each sees its ancestors' links.
	s[at + E_ROOT_LINK] = rootLinkFlagsAt(
		v,
		ancestorOf( v, e, d[emitter + D_POSITION_DEPTH]! ),
		ancestorOf( v, e, d[emitter + D_FOLLOW_DEPTH]! ),
		matrixDepth > 0 ? ancestorOf( v, e, matrixDepth ) : -1
	);
	commandsAt( v, e, emitter, age, sibling );
	const commanded = d[emitter + D_COMMANDS]! >= 0, program = commanded ? -1 : d[emitter + D_PROGRAM]!;
	if ( program >= 0 ) {
		const rVelocity = d[program + Q_R_VELOCITY]!, spin = d[program + Q_SPIN]!;
		if ( rVelocity >= 0 && frameIncludes( d, d[program + Q_ROTATION_FRAMES]!, age ) ) {
			copyMatrix( d, rVelocity, f, frames + F_LOCAL );
		}
		if ( spin >= 0 && frameIncludes( d, d[program + Q_SPIN_FRAMES]!, age ) ) {
			copyMatrix( d, spin, f, frames + F_SHAPE );
		}
		if ( d[program + Q_ATTRACTION_SET] === 1 && frameIncludes( d, d[program + Q_ATTRACTION_FRAMES]!, age ) ) {
			attractAt( v, e, parent, d[program + Q_ATTRACTION]! );
		}
	}
	const scales = d[emitter + D_SCALES]!, scaleAt = Math.min( age, d[scales + LIST_COUNT]! - 1 );
	// Every particle owns its scale, so the frame's scale is written into it.
	if ( scaleAt >= 0 ) {
		for ( let i = 0; i < 3; i++ ) s[at + E_SCALE + i] = d[scales + LIST_VALUES + scaleAt * 3 + i]!;
	}
	const positions = d[emitter + D_POSITIONS]!, positionCount = d[positions + LIST_COUNT]!;
	if ( !commanded && positionCount > 0 ) {
		const value = positions + LIST_VALUES + Math.min( age, positionCount - 1 ) * 3;
		const position = at + E_POSITION, from = stateAt( v, parent ) + E_POSITION;
		affineAt( f, framesAt( v, parent ) + F_MATRIX, d[value]!, d[value + 1]!, d[value + 2]!, s, position );
		for ( let i = 0; i < 3; i++ ) s[position + i] = Math.fround( s[position + i]! + s[from + i]! );
	}
	const rotations = d[emitter + D_ROTATIONS]!, rotationCount = d[rotations + LIST_COUNT]!;
	if ( !commanded && rotationCount > 0 ) {
		copyMatrix( d, rotations + LIST_VALUES + Math.min( age, rotationCount - 1 ) * 16, f, frames + F_MATRIX );
	}
	s[at + E_FRAME] = age;
	if ( s[at + E_BORN] === tick ) {
		copy3At( s, at + E_POSITION, at + E_PREVIOUS );
		snapshotTick( v, e );
	}
}

/*
================
birthsOf

Emitter n's births in slot order this tick: each due element created,
or moved and commanded while it lives, or held dead.
================
*/
function birthsOf( v: ParticleViews, n: number, emitter: number, tick: number, stop: number ) {
	const s = v.particleState, d = v.particleDefs, f = v.particleFrames, m = v.particleMatrices, w = v.particleWork;
	const emission = d[emitter + D_EMISSION] === 1, indexed = d[emitter + D_SIBLINGS] === 1;
	const state = emitterState( v, emitter ), base = d[emitter + D_BASE]!, frames = d[emitter + D_FRAMES]!;
	const slots = d[emitter + D_SLOTS]!, defBirths = d[emitter + D_BIRTHS]!, defParents = d[emitter + D_PARENTS]!;
	const loops = d[emitter + D_LOOP] === 1, parentEmitter = d[emitter + D_PARENT]!;
	const elements = d[w[W_DEF]! + GD_ELEMENTS]!, scratch = w[W_SCRATCH]!;
	const siblings = scratch + K_ORDERED + elements, latest = siblings + elements + 1;
	const count = emission ? s[state + S_ROWS]! : d[defBirths + LIST_COUNT]!;
	for ( let b = 0; b < count; b++ ) {
		const birth = emission ? s[state + S_ARRAYS + b]! : d[defBirths + LIST_VALUES + b]!;
		const elapsed = tick - birth, e = base + b, at = stateAt( v, e );
		const existing = b < s[state + S_ROWS]! && s[at + E_PRESENT] === 1;
		const age = existing ? s[at + E_AGE]! : loops && elapsed >= 0 ? elapsed % frames : elapsed;
		if ( age < 0 || (!existing && birth / TICKS_PER_SECOND >= stop) ) continue;
		let parent = -1;
		if ( emission ) parent = s[state + S_ARRAYS + slots + b]!;
		else if ( parentEmitter < 0 ) parent = elements;
		else {
			const of = emitterAt( v, parentEmitter ), index = d[defParents + LIST_VALUES + b]!;
			const candidate = d[of + D_BASE]! + index;
			if (
				index >= 0 && index < s[emitterState( v, of ) + S_ROWS]! &&
				s[stateAt( v, candidate ) + E_PRESENT] === 1
			) parent = candidate;
		}
		if ( parent < 0 ) continue;
		const keptMatrix = d[emitter + D_KEEP_MATRIX] === 1 && existing;
		if ( keptMatrix ) copyMatrix( f, framesAt( v, e ) + F_MATRIX, m, M_PREVIOUS );
		let sibling = -1;
		if ( emission ) {
			if ( indexed ) sibling = existing ? s[siblings + e]! : s[latest + parent]!;
		} else if ( b > 0 && d[defParents + LIST_VALUES + b - 1] === d[defParents + LIST_VALUES + b] ) {
			if ( b - 1 < s[state + S_ROWS]! && s[stateAt( v, e - 1 ) + E_PRESENT] === 1 ) sibling = e - 1;
		}
		if ( !existing ) birthElement( v, n, emitter, b, parent, birth, sibling );
		else if ( age < frames ) moveElement( v, emitter, e, age, sibling );
		if ( age < frames ) {
			commandElement( v, emitter, e, parent, age, sibling, tick );
			// The object code takes the kept matrix's delta just before the
			// element's frame and birth snapshot, which neither read it nor
			// write what it reads: taking it after them is the same.
			if ( keptMatrix ) {
				inverseAt( m, M_PREVIOUS, m, M_INVERSE );
				multiplyAt( f, framesAt( v, e ) + F_MATRIX, m, M_INVERSE, f, framesAt( v, e ) + F_DELTA );
			}
		} else {
			copy3At( s, at + E_POSITION, at + E_ORIGIN );
			identityAt( f, framesAt( v, e ) + F_DELTA );
		}
	}
}

/*
================
advanceGraph

particle-graph.ts advanceParticleGraph on the working half.
================
*/
function advanceGraph( v: ParticleViews, record: number ) {
	const g = v.particleGraphs, s = v.particleState, d = v.particleDefs, f = v.particleFrames;
	const m = v.particleMatrices, w = v.particleWork, def = w[W_DEF]!, half = w[W_HALF]!;
	const time = g[record + G_TIME]!, stop = g[record + G_STOP]!, keepRoots = g[record + G_KEEP_ROOTS] === 1;
	const shiftX = g[record + G_SHIFT_X]!, shiftZ = g[record + G_SHIFT_Z]!, transform = record + G_TRANSFORM;
	const target = Math.min( Math.floor( time * TICKS_PER_SECOND + 1e-6 ), d[def + GD_HORIZON]! );
	const first = s[half + H_FRAME]!;
	if ( target < first || !Number.isSafeInteger( target ) ) throw Error( "Invalid particle graph time" );
	// Only a region crossing shifts the origin.
	if ( shiftX !== 0 || shiftZ !== 0 ) shiftOrigin( v, shiftX, shiftZ );
	// The holder basis advances only with a tick (particle-graph.ts).
	if ( target === first ) return;
	const root = w[W_ROOT]!, rootAt = stateAt( v, root ), rootFrames = framesAt( v, root );
	w[W_OLD_ROOT] = s[rootAt + E_POSITION]!;
	w[W_OLD_ROOT + 1] = s[rootAt + E_POSITION + 1]!;
	w[W_OLD_ROOT + 2] = s[rootAt + E_POSITION + 2]!;
	copyMatrix( f, rootFrames + F_MATRIX, m, M_PREVIOUS );
	copyMatrix( g, transform, f, rootFrames + F_MATRIX );
	f[rootFrames + F_MATRIX + 12] = f[rootFrames + F_MATRIX + 13] = f[rootFrames + F_MATRIX + 14] = 0;
	inverseAt( m, M_PREVIOUS, m, M_INVERSE );
	multiplyAt( f, rootFrames + F_MATRIX, m, M_INVERSE, f, rootFrames + F_DELTA );
	const emitters = d[def + GD_EMITTERS]!;
	for ( let tick = first + 1; tick <= target; tick++ ) {
		for ( let i = 0; i < 3; i++ ) {
			s[rootAt + E_ORIGIN + i] = first < 0 ? g[transform + 12 + i]! : w[W_OLD_ROOT + i]!;
			s[rootAt + E_POSITION + i] = g[transform + 12 + i]!;
		}
		if ( tick > first + 1 ) {
			copy3At( s, rootAt + E_POSITION, rootAt + E_ORIGIN );
			identityAt( f, rootFrames + F_DELTA );
		}
		s[rootAt + E_AGE] = tick;
		startTick( v, tick, stop, keepRoots );
		releaseElements( v );
		for ( let n = 0; n < emitters; n++ ) {
			const emitter = emitterAt( v, n );
			if ( d[emitter + D_EMISSION] === 1 && tick / TICKS_PER_SECOND < stop ) emit( v, emitter, tick );
			if ( d[emitter + D_SIBLINGS] === 1 ) indexSiblings( v, emitter );
			birthsOf( v, n, emitter, tick, stop );
		}
	}
	s[half + H_FRAME] = target;
}

/*
================
advanceParticleGraphAt

One graph instance's frame: the working half from the current one,
advanced, and its drawn emitters' records written.
================
*/
export function advanceParticleGraphAt( v: ParticleViews, slot: number ) {
	const g = v.particleGraphs, d = v.particleDefs, s = v.particleState, w = v.particleWork;
	const record = slot * PARTICLE_GRAPH_RECORD, def = g[record + G_DEF]!, current = g[record + G_CURRENT]!;
	const halfWords = d[def + GD_HALF_WORDS]!, halfFloats = d[def + GD_HALF_FLOATS]!;
	const state = g[record + G_STATE]!, frames = g[record + G_FRAMES]!;
	const half = state + (1 - current) * halfWords, framesHalf = frames + (1 - current) * halfFloats;
	w[W_DEF] = def;
	w[W_HALF] = half;
	w[W_ELEMENTS] = half + d[def + GD_ELEMENTS_AT]!;
	w[W_FRAMES] = framesHalf;
	w[W_SCRATCH] = state + 2 * halfWords;
	w[W_ROOT] = d[def + GD_ELEMENTS]!;
	copyHalf( v, state + current * halfWords, frames + current * halfFloats );
	advanceGraph( v, record );
	const records = frames + 2 * halfFloats, emitters = d[def + GD_EMITTERS]!;
	for ( let n = 0; n < emitters; n++ ) {
		const emitter = emitterAt( v, n ), at = d[emitter + D_RECORDS]!;
		if ( at < 0 ) continue;
		const emitterHalf = emitterState( v, emitter );
		s[emitterHalf + S_LIVE] = writeEmitterRecords(
			v,
			d[emitter + D_BASE]!,
			s[emitterHalf + S_ROWS]!,
			records + at
		);
	}
}
