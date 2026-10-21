/*
===========================================================================

pose-kernel.ts - one actor's drawn pose, on flat memory

The movement presentation of pose-presentation.ts, ported onto one actor's
record (pose-record.ts) so any thread can run it: every player, monster,
NPC and pet's drawn pose from its untimed or sampled track, this call's
sample input, its logical pose and the frame time. The thread copies the
record into its own scratch, runs presentPose there with the walk arena
(walking-chain.ts), and copies the record back.

Every expression keeps the object code's operation order and every branch
its conditions. The few comparisons the object code made by identity (an
input's leg end against the track's, a model that was the latest sample
itself, a track replaced in this call) are flags and ids here.
pose-presentation-flat-walk.test.mjs drives this kernel and a frozen copy
of the object code (tests/fixtures/pose-presentation-before-flat-walk.ts)
with the same inputs and requires every drawn pose bit for bit.
Allocation-free: registers follow the record copy in the scratch.

===========================================================================
*/
import { SIMULATION_STEP_MS } from "@/engine/contracts/simulation";
import { hypot2, hypot3 } from "@/engine/foundation/math/hypot";
import { sameCoordinateSpace } from "@/engine/foundation/world/world-space";
import {
	copyPose,
	discontinuity,
	displace,
	interpolate,
	onCorridor,
	poseDistance,
	setVector,
	turn,
	vectorLength,
	worldVector
} from "./flat-pose";
import {
	CHAIN_TOLERANCE,
	LOCATED_DISTANCE,
	LOCATED_EDGE,
	LOCATED_ERROR,
	LOCATED_FRACTION,
	chainEdgeSpan,
	chainPoint,
	chainPoints,
	locateOnChain,
	nearestOnChain,
	offsetX,
	offsetZ,
	spendOnChain
} from "./walking-chain";
import {
	C_NOW,
	C_ORIGIN_MS,
	C_ORIGIN_SET,
	C_SETTLED,
	C_TARGET,
	I_AT_MS,
	I_CORRIDOR,
	I_CORRIDOR_SET,
	I_DISPLACEMENT,
	I_DURATION,
	I_DURATION_SET,
	I_FROM,
	I_FROM_SET,
	I_INELIGIBLE,
	I_LOGICAL_ZERO,
	I_MOVING,
	I_OWN_LEG,
	I_PATH_ELIGIBLE,
	I_PREVIOUS_PATH,
	I_PREVIOUS_PATH_SET,
	I_REASON,
	I_RELOCATION,
	I_REVISION,
	I_SET,
	I_STARTED,
	I_STARTED_SET,
	I_TO,
	I_TO_ID,
	I_TO_SET,
	I_TRANSITION_SET,
	I_TURN,
	I_TURN_SET,
	I_WALK,
	MOVING_TRUE,
	O_POSE,
	PATH_WORDS,
	POSE_WORDS,
	REASON_INPUT,
	REASON_RECEIPT,
	SAMPLE_AT,
	SAMPLE_REVISION,
	SAMPLE_WORKER_AT_MS,
	T_ANGLE,
	T_CARRIED,
	T_CLOCK_OFFSET,
	T_DISPLACEMENT_AT,
	T_DISPLACEMENT_SET,
	T_DISPLAYED,
	T_DURATION,
	T_DURATION_SET,
	T_EXISTS,
	T_LAST,
	T_LATEST,
	T_MOVING,
	T_OFFSET,
	T_OWN_LEG,
	T_PATH_COUNT,
	T_PATH_VELOCITY,
	T_PATHS,
	T_PREVIOUS,
	T_PREVIOUS_SET,
	T_RECOVERY_SPEED,
	T_RELOCATION,
	T_TO,
	T_TO_ID,
	T_TO_SET,
	T_VELOCITY,
	T_VELOCITY_SET,
	T_WALK,
	U_ANGLE,
	U_AT,
	U_DISPLAYED,
	U_DISPLAYED_SET,
	U_DURATION,
	U_EXISTS,
	U_FROM,
	U_LAST,
	U_MOVING,
	U_SETTLED,
	U_SETTLED_SET,
	U_TARGET
} from "./pose-record";

const MAX_SAMPLE_GAP_SECONDS = 0.25;
const MAX_EXTRAPOLATION_SECONDS = 0.1;
const CORRECTION_FREQUENCY = 30;
const MAX_RECOVERY_STEP_SECONDS = 0.033;
const MAX_CORRECTION_DISTANCE = 96;
// Recovery paths kept after a call; a call pushes at most two more first,
// within pose-record.ts MAX_HELD_PATHS.
const MAX_RECOVERY_PATHS = 4;
const MAX_WALK_RECOVERY_SPEED_FACTOR = 1.5;
// A stale publication more than this behind the frame clock is re-anchored.
const LATE_SAMPLE_SECONDS = 0.095;
const REANCHOR_LEAD_SECONDS = 0.016;
// A settled untimed track is reused for this long without new input.
const SETTLED_REUSE_SECONDS = 0.25;
const MAX_UNTIMED_DURATION_SECONDS = 0.1;
const UNTIMED_DURATION_DECAY = 0.75;
const MOVING_EPSILON = 1e-5;
const HEADING_WORDS = 65536;

// Scratch registers after the record copy: poses (R_), vectors (V_) and
// located chain points (L_: edge, fraction, distance, error).
const R_CARRIED = 228;
const R_BEFORE = 233;
const R_ANCHOR = 238;
const R_BEFORE_SWITCH = 243;
const R_MODEL = 248;
const R_DRAWN = 253;
const R_WALKED = 258;
const R_LINEAR = 263;
const R_SAMPLED = 268;
const R_TEMP = 273;
const R_TEMP2 = 278;
const R_UNTIMED = 283;
const V_JUMP = 288;
const V_CLOCK = 291;
const V_SPAN = 294;
const V_POINT = 297;
const V_DELTA = 300;
const V_OFFSET = 303;
const L_START = 306;
const L_END = 310;
const L_MODEL = 314;
// Doubles in one thread's scratch: a record copy and the registers.
export const POSE_SCRATCH = 318;

// ============================================================================
//
// Untimed tracks
//
// ============================================================================

/*
================
untimedPosition

position( row, now ) into out.
================
*/
function untimedPosition( s: Float64Array, out: number, now: number ) {
	interpolate( s, out, U_FROM, U_TARGET, Math.max( 0, Math.min( 1, (now - s[U_AT]!) / s[U_DURATION]! ) ) );
}

/*
================
untimedPose

pose() for a character drawn by delivery interval; its sampled track
retires.
================
*/
function untimedPose( s: Float64Array ) {
	const now = s[C_NOW]!, settled = s[C_SETTLED] === 1, tick = SIMULATION_STEP_MS / 1000;
	s[T_EXISTS] = 0;
	let exists = s[U_EXISTS] === 1;
	// Death navigation is already settled by the world owner. Do not spend an
	// additional delivery interpolation interval sliding a falling corpse.
	if ( settled && exists ) {
		copyPose( s, U_FROM, C_TARGET );
		copyPose( s, U_TARGET, C_TARGET );
		s[U_AT] = now - tick;
		s[U_DURATION] = tick;
		s[U_SETTLED_SET] = 0;
	}
	// Settled world transforms have no remaining interpolation or body turn.
	if (
		exists && s[U_SETTLED_SET] === 1 && now >= s[U_LAST]! && now - s[U_LAST]! <= SETTLED_REUSE_SECONDS &&
		s[U_TARGET] === s[C_TARGET] && s[U_TARGET + 1] === s[C_TARGET + 1] && s[U_TARGET + 2] === s[C_TARGET + 2] &&
		s[U_TARGET + 3] === s[C_TARGET + 3] && s[U_TARGET + 4] === s[C_TARGET + 4]
	) {
		s[U_LAST] = now;
		copyPose( s, O_POSE, U_SETTLED );
		return;
	}
	if ( exists ) s[U_SETTLED_SET] = 0;
	if ( !exists || now < s[U_LAST]! || discontinuity( s, U_TARGET, C_TARGET ) ) {
		copyPose( s, U_FROM, C_TARGET );
		copyPose( s, U_TARGET, C_TARGET );
		s[U_AT] = now;
		s[U_DURATION] = tick;
		s[U_LAST] = now;
		s[U_ANGLE] = s[C_TARGET + 4]!;
		s[U_MOVING] = 0;
		s[U_SETTLED_SET] = 0;
		s[U_DISPLAYED_SET] = 0;
		s[U_EXISTS] = 1;
		exists = true;
	} else {
		if ( now - s[U_LAST]! > MAX_SAMPLE_GAP_SECONDS && s[U_DISPLAYED_SET] === 1 && !settled ) {
			copyPose( s, U_FROM, U_DISPLAYED );
			s[U_AT] = now;
		}
		s[U_ANGLE] = turn( s[U_ANGLE]!, s[C_TARGET + 4]!, now - s[U_LAST]! );
		s[U_LAST] = now;
		if (
			s[U_TARGET] !== s[C_TARGET] || s[U_TARGET + 1] !== s[C_TARGET + 1] || s[U_TARGET + 2] !== s[C_TARGET + 2] ||
			s[U_TARGET + 3] !== s[C_TARGET + 3] || s[U_TARGET + 4] !== s[C_TARGET + 4]
		) {
			untimedPosition( s, R_UNTIMED, now );
			const interval = now - s[U_AT]!;
			s[U_DURATION] = interval > SETTLED_REUSE_SECONDS ?
				tick :
				Math.min(
					MAX_UNTIMED_DURATION_SECONDS,
					Math.max( tick, interval, s[U_DURATION]! * UNTIMED_DURATION_DECAY )
				);
			copyPose( s, U_FROM, R_UNTIMED );
			copyPose( s, U_TARGET, C_TARGET );
			s[U_AT] = now;
		}
	}
	untimedPosition( s, R_UNTIMED, now );
	s[U_MOVING] = poseDistance( s, R_UNTIMED, U_TARGET ) > MOVING_EPSILON ? 1 : 0;
	// Pose carries a native heading word. Keep sub-word precision internally,
	// but do not pass fractional words to the model's strict angle decoder.
	s[R_UNTIMED + 4] = Math.round( s[U_ANGLE]! ) % HEADING_WORDS;
	copyPose( s, O_POSE, R_UNTIMED );
	copyPose( s, U_DISPLAYED, R_UNTIMED );
	s[U_DISPLAYED_SET] = 1;
	if ( now - s[U_AT]! >= s[U_DURATION]! && s[U_ANGLE] === s[C_TARGET + 4] ) {
		copyPose( s, U_SETTLED, R_UNTIMED );
		s[U_SETTLED_SET] = 1;
	}
}

// ============================================================================
//
// Sampled tracks
//
// ============================================================================

/*
================
recover

Exact critically damped integration. Project velocity into the remaining
correction so a new opposite receipt cannot send the body past either end.
================
*/
function recover( s: Float64Array, seconds: number ) {
	const dt = Math.min( MAX_RECOVERY_STEP_SECONDS, seconds );
	const decay = Math.exp( -CORRECTION_FREQUENCY * dt );
	for ( let axis = 0; axis < 3; axis++ ) {
		const x = s[T_OFFSET + axis]!;
		const v = x === 0 ?
			0 :
			Math.sign( x ) *
			Math.max( -CORRECTION_FREQUENCY * Math.abs( x ), Math.min( 0, Math.sign( x ) * s[T_VELOCITY + axis]! ) );
		const c = v + CORRECTION_FREQUENCY * x;
		s[T_OFFSET + axis] = (x + c * dt) * decay;
		s[T_VELOCITY + axis] = (v - CORRECTION_FREQUENCY * c * dt) * decay;
	}
	if ( vectorLength( s, T_OFFSET ) < CHAIN_TOLERANCE ) clearCorrection( s );
}

/*
================
clearCorrection
================
*/
function clearCorrection( s: Float64Array ) {
	setVector( s, T_OFFSET, 0, 0, 0 );
	setVector( s, T_VELOCITY, 0, 0, 0 );
}

/*
================
walksLeg

Whether the track walks the local mover's own admitted ground leg: one
with its end and its velocity, not a skill displacement (which keeps its
own clock). A peer's leg is the server's, which a stop or a knockback can
cut, so a peer keeps the bounded extrapolation.
================
*/
function walksLeg( s: Float64Array ): boolean {
	return s[T_OWN_LEG] === 1 && s[T_TO_SET] === 1 && s[T_VELOCITY_SET] === 1 && s[T_DISPLACEMENT_SET] === 0;
}

/*
================
linearModel

sampledLinearModel into out. True when the object code returned the
latest sample's pose itself.
================
*/
function linearModel( s: Float64Array, out: number, now: number, confirmedAt: number ): boolean {
	const latestAt = s[T_LATEST + SAMPLE_AT]!, previous = s[T_PREVIOUS_SET] === 1;
	const legged = walksLeg( s );
	const maximumAhead = legged ? Infinity : MAX_EXTRAPOLATION_SECONDS + Math.max( 0, confirmedAt - latestAt );
	copyPose( s, out, T_LATEST );
	if ( s[T_MOVING] !== MOVING_TRUE ) return true;
	// Two samples further apart than MAX_SAMPLE_GAP_SECONDS define no
	// velocity; the admitted leg still does.
	const sampledGap = previous ? latestAt - s[T_PREVIOUS + SAMPLE_AT]! : 0;
	if (
		s[T_VELOCITY_SET] === 1 &&
		(!previous || legged && (sampledGap <= 0 || sampledGap > MAX_SAMPLE_GAP_SECONDS))
	) {
		const vx = s[T_PATH_VELOCITY]!, vz = s[T_PATH_VELOCITY + 1]!, speed = hypot2( vx, vz );
		if ( !speed ) return true;
		let ahead = Math.min( maximumAhead, Math.max( 0, now - latestAt ) );
		if ( s[T_TO_SET] === 1 ) {
			if ( !worldVector( s, V_POINT, T_TO, T_LATEST ) || s[V_POINT]! * vx + s[V_POINT + 2]! * vz <= 0 ) {
				return true;
			}
			ahead = Math.min( ahead, hypot2( s[V_POINT]!, s[V_POINT + 2]! ) / speed );
		}
		// Only sampled ground heights define a vertical tangent. A distant
		// leg endpoint cannot predict the terrain between its two ends.
		return ahead ? !displace( s, out, T_LATEST, vx * ahead, 0, vz * ahead ) : true;
	}
	if ( !previous ) return true;
	const gap = latestAt - s[T_PREVIOUS + SAMPLE_AT]!;
	if ( gap <= 0 || gap > MAX_SAMPLE_GAP_SECONDS ) return true;
	if ( !worldVector( s, V_SPAN, T_LATEST, T_PREVIOUS ) ) return true;
	const sx = s[V_SPAN]!, sy = s[V_SPAN + 1]!, sz = s[V_SPAN + 2]!;
	const stepped = hypot2( sx, sz );
	if ( stepped === 0 ) return true;
	let ahead = Math.min( maximumAhead, Math.max( 0, now - latestAt ) ) / gap;
	if ( s[T_TO_SET] === 1 ) {
		if ( !worldVector( s, V_POINT, T_TO, T_LATEST ) || s[V_POINT]! * sx + s[V_POINT + 2]! * sz <= 0 ) return true;
		ahead = Math.min( ahead, hypot2( s[V_POINT]!, s[V_POINT + 2]! ) / stepped );
	}
	if ( ahead === 0 ) return true;
	// A spread copy: never the latest pose itself, whatever displace returns.
	displace( s, out, T_LATEST, sx * ahead, sy * ahead, sz * ahead );
	return false;
}

/*
================
sampledModel

The pose at frame time now, into out: the latest sample, advanced along
the velocity of the last two samples. Walking is piecewise linear at
constant speed, so within a leg this is exact; the leg end bounds it.
================
*/
function sampledModel( s: Float64Array, arena: Float64Array, out: number, now: number, confirmedAt: number ) {
	const latest = linearModel( s, R_LINEAR, now, confirmedAt ), chain = s[T_WALK]!;
	if ( chain < 0 || latest ) {
		copyPose( s, out, R_LINEAR );
		return;
	}
	// A candidate off the certified chain (one that ran past its end) takes
	// the chain's nearest point, never the stale sample: falling back to the
	// latest sample drew a step back in X, Z and height.
	if ( locateOnChain( s, R_LINEAR, arena, chain, L_MODEL ) ) {
		chainPoint( s, out, arena, chain, s[L_MODEL + LOCATED_EDGE]!, s[L_MODEL + LOCATED_FRACTION]! );
	} else if ( !nearestOnChain( s, out, R_LINEAR, arena, chain ) ) copyPose( s, out, T_LATEST );
}

/*
================
assignPathVelocity

row.pathVelocity = pathVelocity( input ). A coalesced click and receipt
may be the first published sample of a walk; its admitted leg already
defines horizontal velocity. Infinite duration is the native zero-speed
hold, so its velocity is zero.
================
*/
function assignPathVelocity( s: Float64Array ) {
	s[T_VELOCITY_SET] = 0;
	if ( s[I_FROM_SET] === 0 || s[I_TO_SET] === 0 || !(s[I_DURATION_SET] === 1 && s[I_DURATION]! > 0) ) return;
	if ( !worldVector( s, V_SPAN, I_TO, I_FROM ) ) return;
	s[T_PATH_VELOCITY] = s[V_SPAN]! * 1000 / s[I_DURATION]!;
	s[T_PATH_VELOCITY + 1] = s[V_SPAN + 2]! * 1000 / s[I_DURATION]!;
	s[T_VELOCITY_SET] = 1;
}

/*
================
displacementAnchor

Into out; false when the input has no fixed skill clock. The clock
survives coalesced worker publications. Only the XZ result enters the
timing correction; sampled terrain still owns height.
================
*/
function displacementAnchor( s: Float64Array, out: number, atMs: number ): boolean {
	if (
		s[I_DISPLACEMENT] === 0 || s[I_FROM_SET] === 0 || s[I_TO_SET] === 0 ||
		!(s[I_STARTED_SET] === 1 && Number.isFinite( s[I_STARTED] )) ||
		!(s[I_DURATION_SET] === 1 && s[I_DURATION]! > 0) || !Number.isFinite( s[I_DURATION] )
	) return false;
	const phase = Math.max( 0, Math.min( 1, (atMs - s[I_STARTED]!) / s[I_DURATION]! ) );
	interpolate( s, out, I_FROM, I_TO, phase );
	return true;
}

/*
================
recoverTurn

Spend correction travel along the two admitted legs of a turn, into out;
false when the corridors do not hold the bodies.
================
*/
function recoverTurn( s: Float64Array, out: number, before: number, model: number, candidate: number ): boolean {
	const incomingFrom = I_TURN, incomingTo = I_TURN + POSE_WORDS;
	const outgoingFrom = I_TURN + 2 * POSE_WORDS, outgoingTo = I_TURN + 3 * POSE_WORDS;
	if ( !onCorridor( s, model, outgoingFrom, outgoingTo, true ) ) return false;
	if ( !worldVector( s, V_DELTA, candidate, before ) ) return false;
	const distance = vectorLength( s, V_DELTA );
	if ( onCorridor( s, before, outgoingFrom, outgoingTo, true ) ) {
		if ( !worldVector( s, V_POINT, model, before ) ) return false;
		const length = vectorLength( s, V_POINT );
		if ( length ) interpolate( s, out, before, model, Math.min( 1, distance / length ) );
		else copyPose( s, out, model );
		return true;
	}
	if ( !onCorridor( s, before, incomingFrom, incomingTo, true ) ) return false;
	const corner = outgoingFrom;
	if ( !worldVector( s, V_POINT, corner, before ) || !worldVector( s, V_SPAN, model, corner ) ) return false;
	const toCorner = vectorLength( s, V_POINT ), toModel = vectorLength( s, V_SPAN );
	if ( distance < toCorner ) interpolate( s, out, before, corner, distance / toCorner );
	else if ( !toModel ) copyPose( s, out, model );
	else interpolate( s, out, corner, model, Math.min( 1, (distance - toCorner) / toModel ) );
	return true;
}

/*
================
recoverWalking

Spend damped recovery along the input's certified sample chain, into out;
false when either end is off the chain.
================
*/
function recoverWalking(
	s: Float64Array,
	arena: Float64Array,
	chain: number,
	out: number,
	budget: number
): boolean {
	const before = T_DISPLAYED, model = R_MODEL, candidate = R_DRAWN;
	const start = locateOnChain( s, before, arena, chain, L_START ),
		end = locateOnChain( s, model, arena, chain, L_END );
	if (
		!start || !end || s[L_START + LOCATED_ERROR]! > CHAIN_TOLERANCE ||
		s[L_END + LOCATED_ERROR]! > CHAIN_TOLERANCE
	) return false;
	if ( !worldVector( s, V_DELTA, candidate, before ) ) return false;
	const remaining = s[L_END + LOCATED_DISTANCE]! - s[L_START + LOCATED_DISTANCE]!;
	const direction = Math.sign( remaining ), count = chainPoints( arena, chain );
	let travel = Math.min( Math.abs( remaining ), vectorLength( s, V_DELTA ) );
	let distance = s[L_START + LOCATED_DISTANCE]!, fraction = s[L_START + LOCATED_FRACTION]!;
	if ( travel === 0 ) {
		copyPose( s, out, before );
		return true;
	}
	for ( let edge = s[L_START + LOCATED_EDGE]!; edge > 0 && edge < count && travel > 0; edge += direction ) {
		chainEdgeSpan( s, V_SPAN, arena, chain, edge );
		const length = vectorLength( s, V_SPAN ), planar = hypot2( s[V_SPAN]!, s[V_SPAN + 2]! );
		const available = length * (direction > 0 ? 1 - fraction : fraction);
		const step = Math.min( available, travel, planar ? budget * length / planar : Infinity );
		distance += direction * step;
		travel -= step;
		if ( length ) budget = Math.max( 0, budget - step * planar / length );
		if ( step < available ) break;
		fraction = direction > 0 ? 0 : 1;
	}
	spendOnChain( s, out, arena, chain, distance );
	return true;
}

/*
================
pushPath

row.paths.push( { from, to } ): the pose pair at s[path ...].
================
*/
function pushPath( s: Float64Array, path: number ) {
	const at = T_PATHS + s[T_PATH_COUNT]! * PATH_WORDS;
	for ( let i = 0; i < PATH_WORDS; i++ ) s[at + i] = s[path + i]!;
	s[T_PATH_COUNT] = s[T_PATH_COUNT]! + 1;
}

/*
================
keepLastPaths

row.paths.splice( 0, length - keep ).
================
*/
function keepLastPaths( s: Float64Array, keep: number ) {
	const count = s[T_PATH_COUNT]!, drop = count - keep;
	for ( let i = 0; i < keep * PATH_WORDS; i++ ) s[T_PATHS + i] = s[T_PATHS + drop * PATH_WORDS + i]!;
	s[T_PATH_COUNT] = keep;
}

/*
================
writeLatest

row.latest = { pose: { ...target }, at, workerAtMs: input.atMs, revision }.
================
*/
function writeLatest( s: Float64Array, at: number ) {
	copyPose( s, T_LATEST, C_TARGET );
	s[T_LATEST + SAMPLE_AT] = at;
	s[T_LATEST + SAMPLE_WORKER_AT_MS] = s[I_AT_MS]!;
	s[T_LATEST + SAMPLE_REVISION] = s[I_REVISION]!;
}

/*
================
assignInputLeg

The track's leg fields from the input: its end (and that end's identity),
duration, skill clock, velocity and own-leg flag.
================
*/
function assignInputLeg( s: Float64Array ) {
	s[T_TO_SET] = s[I_TO_SET]!;
	copyPose( s, T_TO, I_TO );
	s[T_TO_ID] = s[I_TO_ID]!;
	s[T_DURATION_SET] = s[I_DURATION_SET]!;
	s[T_DURATION] = s[I_DURATION]!;
	s[T_DISPLACEMENT_SET] = s[I_DISPLACEMENT] === 1 && s[I_STARTED_SET] === 1 ? 1 : 0;
	s[T_DISPLACEMENT_AT] = s[I_STARTED]!;
	assignPathVelocity( s );
	s[T_OWN_LEG] = s[I_OWN_LEG]!;
}

/*
================
replaceTrack

A new sampled track at the target (the object code's fresh row).
================
*/
function replaceTrack( s: Float64Array, at: number, clockOffset: number, relocation: number, now: number ) {
	s[T_PATH_COUNT] = 0;
	s[T_WALK] = s[I_WALK]!;
	writeLatest( s, at );
	s[T_PREVIOUS_SET] = 0;
	s[T_CARRIED] = 0;
	s[T_CLOCK_OFFSET] = clockOffset;
	s[T_MOVING] = s[I_MOVING]!;
	assignInputLeg( s );
	setVector( s, T_OFFSET, 0, 0, 0 );
	setVector( s, T_VELOCITY, 0, 0, 0 );
	copyPose( s, T_DISPLAYED, C_TARGET );
	s[T_RELOCATION] = relocation;
	s[T_LAST] = now;
	s[T_ANGLE] = s[C_TARGET + 4]!;
	s[T_RECOVERY_SPEED] = s[I_DISPLACEMENT] === 0 && s[T_VELOCITY_SET] === 1 ?
		hypot2( s[T_PATH_VELOCITY]!, s[T_PATH_VELOCITY + 1]! ) :
		0;
	s[T_EXISTS] = 1;
}

/*
================
optionalDiffers

Two optional numbers differ as undefined !== undefined does not and a
number !== undefined does.
================
*/
function optionalDiffers( aSet: number, a: number, bSet: number, b: number ): boolean {
	return aSet !== bSet || aSet === 1 && a !== b;
}

/*
================
sampledPose

pose() for a character drawn on the frame clock from its timed samples.
================
*/
function sampledPose( s: Float64Array, arena: Float64Array ) {
	const now = s[C_NOW]!, originMs = s[C_ORIGIN_MS]!, chain = s[I_WALK]!, walking = chain >= 0;
	// moving is the input's three-state flag (pose-record.ts I_MOVING); walking it is 1.
	const moving = s[I_MOVING]!, movingNow = moving === MOVING_TRUE;
	const displacement = s[I_DISPLACEMENT] === 1, transition = s[I_TRANSITION_SET] === 1;
	const ineligible = s[I_INELIGIBLE] === 1, relocation = s[I_RELOCATION]!;
	const corridor = transition && s[I_CORRIDOR_SET] === 1;
	const corridorFrom = I_CORRIDOR, corridorTo = I_CORRIDOR + POSE_WORDS;
	const rawAt = (originMs + s[I_AT_MS]!) / 1000;
	const hadRow = s[T_EXISTS] === 1, untimed = !hadRow && s[U_EXISTS] === 1;
	const revisionChanged = hadRow && s[I_REVISION] !== s[T_LATEST + SAMPLE_REVISION];
	const stalled = hadRow && now - s[T_LAST]! > MAX_SAMPLE_GAP_SECONDS;
	// previousFrameAt: the frame this track last drew, while it has one.
	const previousFrameAt = s[T_LAST]!;
	const freshWorkerSample = !hadRow || s[I_AT_MS] !== s[T_LATEST + SAMPLE_WORKER_AT_MS] ||
		s[I_REVISION] !== s[T_LATEST + SAMPLE_REVISION];
	let clockOffset = !hadRow || stalled || revisionChanged && ineligible ? 0 : s[T_CLOCK_OFFSET]!;
	if ( freshWorkerSample && movingNow && !stalled ) {
		let nextOffset = clockOffset, adjust = false;
		if ( now - (rawAt + clockOffset) > LATE_SAMPLE_SECONDS ) {
			nextOffset = Math.max( 0, now - rawAt - REANCHOR_LEAD_SECONDS );
			adjust = true;
		} else if ( clockOffset > 0 && rawAt + clockOffset > now ) {
			nextOffset = Math.max( 0, now - rawAt );
			adjust = true;
		}
		if ( adjust ) {
			const deltaOffset = nextOffset - clockOffset;
			clockOffset = nextOffset;
			if ( hadRow && deltaOffset ) {
				s[T_LATEST + SAMPLE_AT] = s[T_LATEST + SAMPLE_AT]! + deltaOffset;
				if ( s[T_PREVIOUS_SET] === 1 ) s[T_PREVIOUS + SAMPLE_AT] = s[T_PREVIOUS + SAMPLE_AT]! + deltaOffset;
			}
		}
	} else if ( !movingNow ) {
		clockOffset = 0;
	}
	const at = rawAt + clockOffset;
	let carried = false, fresh = false;
	if (
		!hadRow || now < s[T_LAST]! || s[T_RELOCATION] !== relocation || (revisionChanged && ineligible) ||
		(transition || walking ?
			!sameCoordinateSpace( s[T_LATEST]!, s[C_TARGET]! ) :
			discontinuity( s, T_LATEST, C_TARGET ))
	) {
		replaceTrack( s, at, clockOffset, relocation, now );
		fresh = true;
		if ( untimed && movingNow && !ineligible && !discontinuity( s, U_TARGET, C_TARGET ) ) {
			// An actor can be idle without a simulation timestamp. Its first
			// dash must still respect the last frame already shown, rather
			// than spending unseen worker time as an instantaneous step.
			const switchAt = Math.max(
				s[U_LAST]!,
				Math.min( now, (originMs + (s[I_STARTED_SET] === 1 ? s[I_STARTED]! : s[I_AT_MS]!)) / 1000 )
			);
			if ( displacementAnchor( s, R_ANCHOR, switchAt * 1000 - originMs ) ) {
				untimedPosition( s, R_TEMP, switchAt );
				if (
					worldVector( s, V_OFFSET, R_TEMP, R_ANCHOR ) &&
					vectorLength( s, V_OFFSET ) <= MAX_CORRECTION_DISTANCE
				) {
					setVector( s, T_OFFSET, s[V_OFFSET]!, s[R_TEMP + 2]! - s[C_TARGET + 2]!, s[V_OFFSET + 2]! );
				}
			}
		}
		s[U_EXISTS] = 0;
	} else if ( now !== s[T_LAST] ) {
		if ( !revisionChanged ) recover( s, now - s[T_LAST]! );
		else if ( !stalled ) {
			// Elapsed display time belongs to the old correction. Advancing
			// after retargeting would apply the new receipt's force before
			// it arrived, especially after a small correction and a long lag.
			const x = s[T_OFFSET]!, y = s[T_OFFSET + 1]!, z = s[T_OFFSET + 2]!;
			recover( s, now - s[T_LAST]! );
			if ( s[T_MOVING] === MOVING_TRUE ) {
				displace( s, R_CARRIED, T_DISPLAYED, s[T_OFFSET]! - x, s[T_OFFSET + 1]! - y, s[T_OFFSET + 2]! - z );
			} else {
				sampledModel( s, arena, R_SAMPLED, now, s[T_LATEST + SAMPLE_AT]! );
				displace( s, R_CARRIED, R_SAMPLED, s[T_OFFSET]!, s[T_OFFSET + 1]!, s[T_OFFSET + 2]! );
			}
			carried = true;
			// A new corridor can exclude the old trajectory. Keep its valid
			// displayed origin rather than turn rejected carry into a snap.
			if (
				!displacement && !walking && corridor &&
				onCorridor( s, T_DISPLAYED, corridorFrom, corridorTo, false ) &&
				!onCorridor( s, R_CARRIED, corridorFrom, corridorTo, false )
			) {
				copyPose( s, R_CARRIED, T_DISPLAYED );
			}
		}
		if ( stalled ) s[T_PREVIOUS_SET] = 0;
		s[T_ANGLE] = turn( s[T_ANGLE]!, s[C_TARGET + 4]!, now - s[T_LAST]! );
		s[T_LAST] = now;
	}
	const latestAt = s[T_LATEST + SAMPLE_AT]!;
	const changed = at !== latestAt || s[I_REVISION] !== s[T_LATEST + SAMPLE_REVISION] ||
		s[T_LATEST] !== s[C_TARGET] || s[T_LATEST + 1] !== s[C_TARGET + 1] ||
		s[T_LATEST + 2] !== s[C_TARGET + 2] || s[T_LATEST + 3] !== s[C_TARGET + 3];
	const timingChanged = optionalDiffers( s[T_DURATION_SET]!, s[T_DURATION]!, s[I_DURATION_SET]!, s[I_DURATION]! );
	const displacementSet = displacement && s[I_STARTED_SET] === 1 ? 1 : 0;
	const displacementChanged = optionalDiffers(
		s[T_DISPLACEMENT_SET]!,
		s[T_DISPLACEMENT_AT]!,
		displacementSet,
		s[I_STARTED]!
	);
	// row.to !== input.to: the same input object, or both undefined.
	const legEndChanged = s[T_TO_SET] !== s[I_TO_SET] || s[T_TO_SET] === 1 && s[T_TO_ID] !== s[I_TO_ID];
	if ( changed || stalled || timingChanged || displacementChanged || s[T_MOVING] !== moving || legEndChanged ) {
		// A receipt which kept the logical walk did not move its anchor.
		// Advance the old model to this frame before replacing it; parking at
		// the preceding display creates a correction that never happened.
		const retainedWalk = s[T_MOVING] === MOVING_TRUE && movingNow && s[I_REASON] === REASON_RECEIPT &&
			s[I_LOGICAL_ZERO] === 1 && s[I_PATH_ELIGIBLE] === 1;
		// A stalled frame of a walk on its admitted leg draws where the leg
		// puts it now, as native dead reckoning does after a hitch; holding
		// the frozen display made it sprint to catch up afterwards.
		const preserveDisplay = stalled && !walksLeg( s ) ||
			revisionChanged && s[I_REASON] !== REASON_INPUT && !retainedWalk;
		// A fresh publication after a main-frame gap confirms the intervening
		// leg. Do not manufacture a parked interval inside that unseen gap.
		const continuing = !stalled && !revisionChanged && at > latestAt && hadRow &&
			previousFrameAt - latestAt <= MAX_EXTRAPOLATION_SECONDS;
		if ( preserveDisplay ) copyPose( s, R_BEFORE, carried ? R_CARRIED : T_DISPLAYED );
		else {
			sampledModel( s, arena, R_SAMPLED, now, continuing ? at : latestAt );
			displace( s, R_BEFORE, R_SAMPLED, s[T_OFFSET]!, s[T_OFFSET + 1]!, s[T_OFFSET + 2]! );
		}
		// Native 8DD550 advances at skill speed from the skill's own start.
		// Reconcile at the actual switch, bounded by the last frame already
		// shown: late publications cannot retroactively redraw that frame.
		let anchor = false, beforeSwitch = false;
		if ( displacementChanged && !stalled && movingNow ) {
			const switchAt = Math.max(
				hadRow ? previousFrameAt : now,
				Math.min( now, (originMs + (displacementSet === 1 ? s[I_STARTED]! : s[I_AT_MS]!)) / 1000 )
			);
			anchor = displacementAnchor( s, R_ANCHOR, switchAt * 1000 - originMs );
			if ( anchor ) {
				sampledModel( s, arena, R_SAMPLED, switchAt, continuing ? at : latestAt );
				displace( s, R_BEFORE_SWITCH, R_SAMPLED, s[T_OFFSET]!, s[T_OFFSET + 1]!, s[T_OFFSET + 2]! );
				beforeSwitch = true;
			}
		}
		if ( changed ) {
			// Keep the previous sample only when this one is strictly newer
			// and on the same walk; any re-anchor replaces the model outright
			// and its jump becomes the decaying offset below.
			if ( !stalled && at > latestAt && s[I_REVISION] === s[T_LATEST + SAMPLE_REVISION] ) {
				for ( let i = 0; i < 8; i++ ) s[T_PREVIOUS + i] = s[T_LATEST + i]!;
				s[T_PREVIOUS_SET] = 1;
			} else s[T_PREVIOUS_SET] = 0;
			writeLatest( s, at );
		}
		s[T_CLOCK_OFFSET] = clockOffset;
		s[T_MOVING] = moving;
		s[T_WALK] = chain;
		// Samples from distinct skill legs cannot define one velocity.
		if ( timingChanged || displacementChanged ) s[T_PREVIOUS_SET] = 0;
		assignInputLeg( s );
		// A stop may omit its leg, but outstanding display recovery still
		// belongs to the speed of the admitted walk that reached it.
		const walkSpeed = !displacement && s[T_VELOCITY_SET] === 1 ?
			hypot2( s[T_PATH_VELOCITY]!, s[T_PATH_VELOCITY + 1]! ) :
			0;
		if ( displacement ) s[T_RECOVERY_SPEED] = 0;
		else if ( walkSpeed > 0 ) s[T_RECOVERY_SPEED] = walkSpeed;
		sampledModel( s, arena, R_SAMPLED, now, s[T_LATEST + SAMPLE_AT]! );
		const jump = worldVector( s, V_JUMP, R_BEFORE, R_SAMPLED );
		if ( jump && beforeSwitch && anchor && worldVector( s, V_CLOCK, R_BEFORE_SWITCH, R_ANCHOR ) ) {
			s[V_JUMP] = s[V_CLOCK]!;
			s[V_JUMP + 2] = s[V_CLOCK + 2]!;
		}
		if ( jump ) setVector( s, T_OFFSET, s[V_JUMP]!, s[V_JUMP + 1]!, s[V_JUMP + 2]! );
		if ( !jump || !transition && !walking && vectorLength( s, T_OFFSET ) > MAX_CORRECTION_DISTANCE ) {
			clearCorrection( s );
		}
	}
	sampledModel( s, arena, R_MODEL, now, s[T_LATEST + SAMPLE_AT]! );
	if ( revisionChanged && transition && s[I_PREVIOUS_PATH_SET] === 1 ) pushPath( s, I_PREVIOUS_PATH );
	if ( s[I_FROM_SET] === 1 && s[I_TO_SET] === 1 ) {
		const count = s[T_PATH_COUNT]!, last = T_PATHS + (count - 1) * PATH_WORDS;
		if (
			!count || poseDistance( s, last, I_FROM ) > CHAIN_TOLERANCE ||
			poseDistance( s, last + POSE_WORDS, I_TO ) > CHAIN_TOLERANCE
		) {
			// I_FROM and I_TO sit apart in the record: push them as a pair.
			const at2 = T_PATHS + count * PATH_WORDS;
			copyPose( s, at2, I_FROM );
			copyPose( s, at2 + POSE_WORDS, I_TO );
			s[T_PATH_COUNT] = count + 1;
		}
	}
	if ( s[T_PATH_COUNT]! > MAX_RECOVERY_PATHS ) keepLastPaths( s, MAX_RECOVERY_PATHS );
	displace( s, R_DRAWN, R_MODEL, s[T_OFFSET]!, s[T_OFFSET + 1]!, s[T_OFFSET + 2]! );
	const recoveryBudget = hadRow && !fresh && !displacement && walking && s[T_RECOVERY_SPEED]! > 0 ?
		MAX_WALK_RECOVERY_SPEED_FACTOR * s[T_RECOVERY_SPEED]! * Math.max( 0, now - previousFrameAt ) :
		Infinity;
	// Receipt adoption also happens twice at one display timestamp. The
	// old velocity must fit the new corridor even when no carry was spent.
	if (
		revisionChanged && !displacement && !walking && corridor &&
		onCorridor( s, T_DISPLAYED, corridorFrom, corridorTo, false ) &&
		onCorridor( s, R_MODEL, corridorFrom, corridorTo, false )
	) {
		worldVector( s, V_SPAN, corridorTo, corridorFrom );
		const sx = s[V_SPAN]!, sy = s[V_SPAN + 1]!, sz = s[V_SPAN + 2]!;
		const length2 = sx ** 2 + sy ** 2 + sz ** 2;
		const along = length2 ?
			(s[T_VELOCITY]! * sx + s[T_VELOCITY + 1]! * sy + s[T_VELOCITY + 2]! * sz) / length2 :
			0;
		setVector( s, T_VELOCITY, sx * along, sy * along, sz * along );
	}
	const walked = walking && vectorLength( s, T_OFFSET ) > 0 &&
		recoverWalking( s, arena, chain, R_WALKED, recoveryBudget );
	if ( walked ) {
		copyPose( s, R_DRAWN, R_WALKED );
		offsetToModel( s );
	}
	if (
		(transition || walking) && !walked && vectorLength( s, T_OFFSET ) > 0 &&
		!(corridor && onCorridor( s, R_DRAWN, corridorFrom, corridorTo, false ) &&
			onCorridor( s, R_MODEL, corridorFrom, corridorTo, false )) &&
		!(!walking && heldPathHolds( s ))
	) {
		const recovered = !walking && transition && s[I_TURN_SET] === 1 &&
			recoverTurn( s, R_TEMP2, T_DISPLAYED, R_MODEL, R_DRAWN );
		if ( recovered ) {
			copyPose( s, R_DRAWN, R_TEMP2 );
			offsetToModel( s );
		} else {
			clearCorrection( s );
			copyPose( s, R_DRAWN, R_MODEL );
		}
	}
	if (
		displacement && hadRow && !fresh && !displacementChanged && !revisionChanged && !stalled &&
		now > previousFrameAt && s[T_VELOCITY_SET] === 1 && s[I_FROM_SET] === 1 && s[I_TO_SET] === 1 &&
		onCorridor( s, T_DISPLAYED, I_FROM, I_TO, true ) && onCorridor( s, R_MODEL, I_FROM, I_TO, true )
	) {
		// 8DD550 spends skill speed times frame delta. A late first sample
		// cannot repay its phase lag on top of that speed. Carry the lag
		// along this admitted leg, then finish at the same speed at arrival.
		worldVector( s, V_DELTA, R_MODEL, T_DISPLAYED );
		const distance = hypot2( s[V_DELTA]!, s[V_DELTA + 2]! );
		if ( distance <= MAX_CORRECTION_DISTANCE ) {
			const budget = hypot2( s[T_PATH_VELOCITY]!, s[T_PATH_VELOCITY + 1]! ) * (now - previousFrameAt);
			const fraction = distance ? Math.min( 1, budget / distance ) : 0;
			displace( s, R_TEMP, T_DISPLAYED, s[V_DELTA]! * fraction, 0, s[V_DELTA + 2]! * fraction );
			s[R_DRAWN] = s[R_TEMP]!;
			s[R_DRAWN + 1] = s[R_TEMP + 1]!;
			s[R_DRAWN + 3] = s[R_TEMP + 3]!;
			offsetToModel( s );
		}
	}
	if ( s[T_CARRIED] === 1 ) {
		// A carried pose (a released WAIT hold, carry) walks to the model at
		// MAX_WALK_RECOVERY_SPEED_FACTOR times the walk's speed, height
		// included. Released while standing, it decays at
		// CORRECTION_FREQUENCY as any correction does. A teleport-sized gap
		// is not recovered.
		const delta = worldVector( s, V_DELTA, R_MODEL, T_DISPLAYED );
		const distance = delta ? vectorLength( s, V_DELTA ) : 0;
		// Only a walk paces it: a standing track keeps its last walk's
		// recovery speed, which would glide a stop at walking pace.
		const speed = s[T_MOVING] === MOVING_TRUE ?
			s[T_RECOVERY_SPEED]! ||
			(s[T_VELOCITY_SET] === 1 ? hypot2( s[T_PATH_VELOCITY]!, s[T_PATH_VELOCITY + 1]! ) : 0) :
			0;
		if ( !delta || distance > MAX_CORRECTION_DISTANCE ) {
			s[T_CARRIED] = 0;
		} else {
			const elapsed = !hadRow ? 0 : Math.max( 0, now - previousFrameAt );
			const fraction = distance <= CHAIN_TOLERANCE ?
				1 :
				speed ?
				Math.min( 1, MAX_WALK_RECOVERY_SPEED_FACTOR * speed * elapsed / distance ) :
				1 - Math.exp( -CORRECTION_FREQUENCY * Math.min( MAX_RECOVERY_STEP_SECONDS, elapsed ) );
			const angle = s[R_DRAWN + 4]!;
			displace(
				s,
				R_DRAWN,
				T_DISPLAYED,
				s[V_DELTA]! * fraction,
				s[V_DELTA + 1]! * fraction,
				s[V_DELTA + 2]! * fraction
			);
			s[R_DRAWN + 4] = angle;
			if ( worldVector( s, V_OFFSET, R_DRAWN, R_MODEL ) ) {
				setVector( s, T_OFFSET, s[V_OFFSET]!, s[V_OFFSET + 1]!, s[V_OFFSET + 2]! );
			} else setVector( s, T_OFFSET, 0, 0, 0 );
			if ( fraction >= 1 ) {
				s[T_CARRIED] = 0;
				setVector( s, T_OFFSET, 0, 0, 0 );
			}
		}
	}
	// Retain the path behind a rebased receipt only while it still carries
	// visible recovery. This cannot grow with a long session or cut a turn.
	if ( vectorLength( s, T_OFFSET ) === 0 && s[T_PATH_COUNT]! > 1 ) keepLastPaths( s, 1 );
	// Pose carries a native heading word. Keep sub-word precision internally,
	// but do not pass fractional words to the model's strict angle decoder.
	s[R_DRAWN + 4] = Math.round( s[T_ANGLE]! ) % HEADING_WORDS;
	copyPose( s, T_DISPLAYED, R_DRAWN );
	copyPose( s, O_POSE, R_DRAWN );
}

/*
================
offsetToModel

row.offset = worldVector( drawn, model ). Drawn was recovered on the
model's chain, corridor or turn, so both share a coordinate space; the
object code's spread of a null offset would throw on the next length.
================
*/
function offsetToModel( s: Float64Array ) {
	if ( !worldVector( s, V_OFFSET, R_DRAWN, R_MODEL ) ) throw new TypeError( "Recovered pose left its model's space" );
	setVector( s, T_OFFSET, s[V_OFFSET]!, s[V_OFFSET + 1]!, s[V_OFFSET + 2]! );
}

/*
================
heldPathHolds

row.paths.some( path => both drawn and model lie on its walk ).
================
*/
function heldPathHolds( s: Float64Array ): boolean {
	for ( let i = 0; i < s[T_PATH_COUNT]!; i++ ) {
		const from = T_PATHS + i * PATH_WORDS, to = from + POSE_WORDS;
		if ( onCorridor( s, R_DRAWN, from, to, true ) && onCorridor( s, R_MODEL, from, to, true ) ) return true;
	}
	return false;
}

/*
================
presentPose

pose( gid, target, now, settledTranslation ) for the record copied into s:
its drawn pose into O_POSE, its tracks updated in place. A timed sample
draws on the frame clock once the clock origin is known; anything else,
or a settled translation, draws by delivery interval.
================
*/
export function presentPose( s: Float64Array, arena: Float64Array ): void {
	if ( s[I_SET] === 1 && s[C_ORIGIN_SET] === 1 && s[C_SETTLED] === 0 ) sampledPose( s, arena );
	else untimedPose( s );
}
