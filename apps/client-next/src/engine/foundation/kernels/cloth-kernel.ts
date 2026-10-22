/*
===========================================================================

cloth-kernel.ts - one cloth wearer's frame, on flat memory

createClothVertices().update and createCloth().advance (cloth-vertices.ts,
cloth.ts) ported onto one wearer's record (cloth-record.ts), so any thread
can run it: skin the anchors from this frame's palette, re-anchor the
pins, drain the 50 ms Verlet steps with their ordered extension
constraints, and write the positions into the wearer's packed vertices.

Every expression keeps the object code's operation order and float32
stores, so for the same rand() draws the vertices are the same bits
(cloth-kernel.test.mjs drives both). The draws differ: W_RANDOM is the
wearer's own CRT state, where the object code draws for every wearer from
the one presentation stream in frame order. Port-only, not native, and
used with Worker threads only (docs/CLIENT_WORKERS_PLAN.md section 7): a
wearer's draws then never wait on another's.

Restartable and allocation-free: the current half of positions and
previous is only read; the step works on the other half, and the clock
and random state go to N_*. Anchors and vertices are rewritten from the
same inputs every time.

===========================================================================
*/
import {
	CLOTH_CONSTRAINT_PASSES,
	CLOTH_EXTENSION_TOLERANCE,
	CLOTH_FORCE_STEP,
	CLOTH_MAX_ACCUMULATOR_MS,
	CLOTH_STEP_MS
} from "@/engine/foundation/animation/cloth";
import { CRT_RAND_INCREMENT, CRT_RAND_MAX, CRT_RAND_MULTIPLIER } from "@/engine/foundation/math/crt-random";
import {
	CLOTH_JOINT_FLOATS,
	CLOTH_RECORD,
	CLOTH_VERTEX_FLOATS,
	N_ELAPSED,
	N_SETTLED,
	N_RANDOM,
	P_CONSTRAINTS,
	P_DAMPING,
	P_FORCE,
	P_FORCE_SET,
	P_GRAVITY,
	P_GRAVITY_MOBILITY,
	P_HEADER,
	P_SKINNED,
	P_VERTICES,
	P_WIND_MOBILITY,
	P_WIND_PERIOD,
	W_CURRENT,
	W_DIRECTION,
	W_ELAPSED,
	W_ENABLED,
	W_INITIALIZED,
	W_LAST_SECONDS,
	W_LAST_SET,
	W_PROGRAM,
	W_RANDOM,
	W_SECONDS,
	W_SPEED,
	W_STATE,
	W_VERTICES
} from "./cloth-record";
import type { FrameKernelViews } from "./frame-kernels";

// The object code draws random.range( 0, 32768 ): the whole rand() value.
const CLOTH_RANDOM_SPAN = 32768;

/*
================
clothProgramWords

Doubles a program of vertices and constraints takes in clothPrograms.
================
*/
export function clothProgramWords( vertices: number, constraints: number ): number {
	return P_HEADER + vertices * 16 + constraints * 3;
}

/*
================
clothStateFloats

Floats a wearer of vertices and palette joints takes in clothState: two
halves of positions and previous, anchors, palette. Its packed vertices
are in clothVertices.
================
*/
export function clothStateFloats( vertices: number, joints: number ): number {
	return vertices * (12 + 3) + joints * CLOTH_JOINT_FLOATS;
}

/*
================
clothStatePalette

Where a wearer's palette starts in clothState.
================
*/
export function clothStatePalette( state: number, vertices: number ): number {
	return state + vertices * 15;
}

/*
================
clothStateHalf

Where one half of a wearer's positions starts in clothState; its previous
positions follow them.
================
*/
export function clothStateHalf( state: number, vertices: number, half: number ): number {
	return state + half * vertices * 6;
}

/*
================
stepCloth

cloth.ts step on the positions and previous positions at positions and
positions + 3n. Returns the CRT state after its draws: one a vertex not
pinned at 1.
================
*/
function stepCloth(
	programs: Float64Array,
	program: number,
	state: Float32Array,
	positions: number,
	fx: number,
	fy: number,
	fz: number,
	speed: number,
	random: number
): number {
	const n = programs[program + P_VERTICES]!, m = programs[program + P_CONSTRAINTS]!;
	const mobility = program + P_HEADER + n * 14, pins = mobility + n, constraints = pins + n;
	const previous = positions + n * 3;
	const damping = programs[program + P_DAMPING]!, windPeriod = programs[program + P_WIND_PERIOD]!;
	const gravityMobility = programs[program + P_GRAVITY_MOBILITY]!, gravityScale = programs[program + P_GRAVITY]!;
	const windMobility = programs[program + P_WIND_MOBILITY]!;
	// A77530 clamps positive motion to .2..1 before scaling by 900.
	const wind = (speed > 0 ? Math.max( .2, Math.min( 1, speed ) ) * 900 : speed) + 100;
	for ( let i = 0; i < n; i++ ) {
		if ( programs[pins + i] === 1 ) continue;
		const weight = programs[mobility + i]!;
		random = (Math.imul( random, CRT_RAND_MULTIPLIER ) + CRT_RAND_INCREMENT) >>> 0;
		const gust = ((random >>> 16) & CRT_RAND_MAX) % CLOTH_RANDOM_SPAN % windPeriod === 0;
		const gravityY = Math.fround( (gravityMobility * weight + 1) * gravityScale * -5 );
		const windWeight = Math.fround( windMobility * weight + 1 );
		for ( let axis = 0; axis < 3; axis++ ) {
			const at = i * 3 + axis;
			const gravity = axis === 1 ? gravityY : 0;
			const force = axis === 0 ? fx : axis === 1 ? fy : fz;
			const push = gust ?
				Math.fround( Math.fround( force * wind ) * windWeight ) :
				0;
			const acceleration = Math.fround( Math.fround( gravity + push ) * CLOTH_FORCE_STEP );
			const current = state[positions + at]!;
			const velocity = Math.fround( Math.fround( current - state[previous + at]! ) * damping );
			state[previous + at] = current;
			state[positions + at] = current + Math.fround( velocity + acceleration );
		}
	}
	for ( let pass = 0; pass < CLOTH_CONSTRAINT_PASSES; pass++ ) {
		let settled = true;
		for ( let edge = 0; edge < m; edge++ ) {
			const c = constraints + edge * 3, a = programs[c]!, b = programs[c + 1]!;
			const at = positions + a * 3, bt = positions + b * 3;
			const dx = Math.fround( state[bt]! - state[at]! );
			const dy = Math.fround( state[bt + 1]! - state[at + 1]! );
			const dz = Math.fround( state[bt + 2]! - state[at + 2]! );
			const length = Math.fround( Math.sqrt( Math.fround( dx * dx + dy * dy + dz * dz ) ) );
			const extension = Math.fround( length - programs[c + 2]! );
			// A779D3..A779E6 corrects extension only; compressed edges stay free.
			if ( extension < CLOTH_EXTENSION_TOLERANCE ) continue;
			settled = false;
			const sum = Math.fround( programs[mobility + a]! + programs[mobility + b]! );
			const wa = Math.fround( programs[mobility + a]! / sum ), wb = Math.fround( programs[mobility + b]! / sum );
			const cx = Math.fround( Math.fround( dx / length ) * extension );
			state[at]! += Math.fround( cx * wa );
			state[bt]! -= Math.fround( cx * wb );
			const cy = Math.fround( Math.fround( dy / length ) * extension );
			state[at + 1]! += Math.fround( cy * wa );
			state[bt + 1]! -= Math.fround( cy * wb );
			const cz = Math.fround( Math.fround( dz / length ) * extension );
			state[at + 2]! += Math.fround( cz * wa );
			state[bt + 2]! -= Math.fround( cz * wb );
		}
		if ( settled ) break;
	}
	return random;
}

/*
================
advanceClothWearer

One wearer's frame (cloth-vertices.ts update): skin, advance, pack. Reads
the record's inputs and current half; writes the other half, anchors,
vertices, N_RANDOM, N_ELAPSED and N_SETTLED. world picks the world's cloth
tables (the world* cloth tables) over the characters'.
================
*/
export function advanceClothWearer( views: FrameKernelViews, world: boolean, slot: number ) {
	const records = world ? views.worldClothRecords : views.clothRecords;
	const programs = world ? views.worldClothPrograms : views.clothPrograms;
	const state = world ? views.worldClothState : views.clothState;
	const output = world ? views.worldClothVertices : views.clothVertices;
	const w = slot * CLOTH_RECORD, program = records[w + W_PROGRAM]!, base = records[w + W_STATE]!;
	const n = programs[program + P_VERTICES]!, skinned = programs[program + P_SKINNED] === 1;
	const rest = program + P_HEADER, normals = rest + n * 3, joints = normals + n * 3, weights = joints + n * 4;
	const pins = weights + n * 5;
	const current = records[w + W_CURRENT]!;
	const from = clothStateHalf( base, n, current ), positions = clothStateHalf( base, n, 1 - current );
	const anchors = base + n * 12, vertices = records[w + W_VERTICES]!, palette = clothStatePalette( base, n );
	const seconds = records[w + W_SECONDS]!, enabled = records[w + W_ENABLED] === 1;
	const updated = records[w + W_LAST_SET] === 1;
	// Unskinned meshes have immutable model-space anchors. Option changes
	// still reset the simulation below, using those original anchors.
	for ( let i = 0; (skinned || !updated) && i < n; i++ ) {
		// Once initialized, free vertices belong to the simulation. Their
		// skeleton anchors and normals are unused until animation is disabled.
		if ( enabled && updated && programs[pins + i] === 0 ) continue;
		const at = i * 3;
		const x = programs[rest + at]!, y = programs[rest + at + 1]!, z = programs[rest + at + 2]!;
		const nx = programs[normals + at]!, ny = programs[normals + at + 1]!, nz = programs[normals + at + 2]!;
		let px = x, py = y, pz = z, normalX = nx, normalY = ny, normalZ = nz;
		if ( skinned ) {
			px =
				py =
				pz =
				normalX =
				normalY =
				normalZ =
					0;
			for ( let joint = 0; joint < 4; joint++ ) {
				const weight = programs[weights + i * 4 + joint]!;
				if ( !weight ) continue;
				const bone = palette + programs[joints + i * 4 + joint]! * CLOTH_JOINT_FLOATS;
				let ax = state[bone + 12]!, ay = state[bone + 13]!, az = state[bone + 14]!;
				let bx = 0, by = 0, bz = 0;
				// Each axis retains its original double-precision accumulation
				// order. Share the influence lookup, not intermediate rounding.
				ax += state[bone]! * x;
				ay += state[bone + 1]! * x;
				az += state[bone + 2]! * x;
				bx += state[bone]! * nx;
				by += state[bone + 1]! * nx;
				bz += state[bone + 2]! * nx;
				ax += state[bone + 4]! * y;
				ay += state[bone + 5]! * y;
				az += state[bone + 6]! * y;
				bx += state[bone + 4]! * ny;
				by += state[bone + 5]! * ny;
				bz += state[bone + 6]! * ny;
				ax += state[bone + 8]! * z;
				ay += state[bone + 9]! * z;
				az += state[bone + 10]! * z;
				bx += state[bone + 8]! * nz;
				by += state[bone + 9]! * nz;
				bz += state[bone + 10]! * nz;
				px += ax * weight;
				py += ay * weight;
				pz += az * weight;
				normalX += bx * weight;
				normalY += by * weight;
				normalZ += bz * weight;
			}
		}
		state[anchors + at] = px;
		state[anchors + at + 1] = py;
		state[anchors + at + 2] = pz;
		if ( !enabled || programs[pins + i] !== 0 || !updated ) {
			const vertex = vertices + i * CLOTH_VERTEX_FLOATS;
			output[vertex + 3] = normalX;
			output[vertex + 4] = normalY;
			output[vertex + 5] = normalZ;
		}
	}
	// cloth.ts advance, on the other half.
	const deltaMs = updated ? Math.trunc( seconds * 1000 ) - Math.trunc( records[w + W_LAST_SECONDS]! * 1000 ) : 0;
	let elapsed = records[w + W_ELAPSED]!, random = records[w + W_RANDOM]!;
	if ( records[w + W_INITIALIZED] !== 1 || !enabled ) {
		for ( let i = 0; i < n * 3; i++ ) {
			state[positions + i] = state[anchors + i]!;
			state[positions + n * 3 + i] = state[anchors + i]!;
		}
		elapsed = 0;
	} else {
		for ( let i = 0; i < n * 6; i++ ) state[positions + i] = state[from + i]!;
	}
	for ( let i = 0; i < n; i++ ) {
		if ( programs[pins + i] === 0 ) continue;
		const at = i * 3;
		state[positions + at] = state[anchors + at]!;
		state[positions + at + 1] = state[anchors + at + 1]!;
		state[positions + at + 2] = state[anchors + at + 2]!;
	}
	let stepped = false;
	if ( enabled ) {
		const authored = programs[program + P_FORCE_SET] === 1;
		const fx = authored ? programs[program + P_FORCE]! : records[w + W_DIRECTION]!;
		const fy = authored ? programs[program + P_FORCE + 1]! : records[w + W_DIRECTION + 1]!;
		const fz = authored ? programs[program + P_FORCE + 2]! : records[w + W_DIRECTION + 2]!;
		elapsed = Math.min( CLOTH_MAX_ACCUMULATOR_MS, elapsed + Math.max( 0, deltaMs ) );
		while ( elapsed >= CLOTH_STEP_MS ) {
			random = stepCloth( programs, program, state, positions, fx, fy, fz, records[w + W_SPEED]!, random );
			elapsed -= CLOTH_STEP_MS;
			stepped = true;
		}
	}
	// cloth.ts due: a step that moved a pin off its anchor (or left NaN
	// there, which Object.is cannot prove equal) is undone by the next advance.
	let settled = 1;
	for ( let i = 0; stepped && settled && i < n; i++ ) {
		if ( programs[pins + i] === 0 ) continue;
		for ( let axis = 0; axis < 3; axis++ ) {
			const position = state[positions + i * 3 + axis]!;
			if ( !Object.is( position, state[anchors + i * 3 + axis] ) || Number.isNaN( position ) ) settled = 0;
		}
	}
	for ( let i = 0; i < n; i++ ) {
		const vertex = vertices + i * CLOTH_VERTEX_FLOATS, at = positions + i * 3;
		output[vertex] = state[at]!;
		output[vertex + 1] = state[at + 1]!;
		output[vertex + 2] = state[at + 2]!;
	}
	records[w + N_RANDOM] = random;
	records[w + N_ELAPSED] = elapsed;
	records[w + N_SETTLED] = settled;
}
