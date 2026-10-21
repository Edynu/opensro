/*
===========================================================================

pose-record.ts - one actor's movement presentation as flat numbers

The record pose-kernel.ts reads and writes for each actor (player,
monster, NPC, pet): its untimed track, its sampled track, this call's
sample input, logical pose and frame time, and the drawn pose. Records sit
at POSE_RECORD doubles each in their owner's table (pose-presentation.ts);
a thread copies one into its scratch, runs the kernel there and copies it
back. Walking chains live in a separate arena, one entry per published
chain: its point count, then POSE_WORDS doubles a point.

A pose is POSE_WORDS doubles: region, x, y, z, heading. Fields the object
code left undefined have a *_SET flag beside them; flags are 0 or 1. Two
inputs keep how undefined compared instead: a missing revision is
MISSING_REVISION, equal to itself and to no revision, and moving is
MOVING_TRUE, MOVING_FALSE or MOVING_MISSING, so row.moving !== input.moving
holds as on the objects.

===========================================================================
*/

// One pose: region, x, y, z, heading word.
export const POSE_WORDS = 5;
// I_MOVING and T_MOVING.
export const MOVING_FALSE = 0;
export const MOVING_TRUE = 1;
export const MOVING_MISSING = -1;
// A revision the input left undefined (only ever compared): -Number.MAX_VALUE,
// equal to itself and to no revision.
export const MISSING_REVISION = -1.7976931348623157e308;
// One sample within a record: pose, then these.
export const SAMPLE_AT = 5;
export const SAMPLE_WORKER_AT_MS = 6;
export const SAMPLE_REVISION = 7;
// One path (a recovery path, corridor or turn leg): from pose, to pose.
export const PATH_WORDS = 10;
// Recovery paths a sampled track holds: MAX_RECOVERY_PATHS, plus the two
// one call may push before trimming back.
export const MAX_HELD_PATHS = 6;
// The transition reasons the kernel distinguishes (MovementTransition
// reason); every other reason, and no transition, is REASON_OTHER.
export const REASON_OTHER = 0;
export const REASON_INPUT = 1;
export const REASON_RECEIPT = 2;

// Untimed track (pose-presentation Track): delivery-interval interpolation.
export const U_EXISTS = 0; // 1 while the actor has an untimed track
export const U_TARGET = 1; // pose
export const U_FROM = 6; // pose
export const U_AT = 11;
export const U_DURATION = 12;
export const U_LAST = 13;
export const U_ANGLE = 14;
export const U_MOVING = 15;
export const U_SETTLED_SET = 16;
export const U_SETTLED = 17; // pose
export const U_DISPLAYED_SET = 22;
export const U_DISPLAYED = 23; // pose
// Sampled track (pose-presentation SampleTrack): drawn on the frame clock.
export const T_EXISTS = 28; // 1 while the actor has a sampled track
export const T_OWN_LEG = 29;
export const T_CARRIED = 30;
export const T_PATH_COUNT = 31; // recovery paths held
export const T_PATHS = 32; // MAX_HELD_PATHS x (from pose, to pose)
export const T_WALK = 92; // arena offset of the row's certified chain, or -1
export const T_PREVIOUS_SET = 93;
export const T_PREVIOUS = 94; // sample: pose, at, workerAtMs, revision
export const T_LATEST = 102; // sample
export const T_CLOCK_OFFSET = 110;
export const T_MOVING = 111;
export const T_TO_SET = 112;
export const T_TO = 113; // pose
export const T_TO_ID = 118; // identity of the input object it came from
export const T_VELOCITY_SET = 119; // pathVelocity present
export const T_PATH_VELOCITY = 120; // vx, vz
export const T_RECOVERY_SPEED = 122;
export const T_DURATION_SET = 123;
export const T_DURATION = 124;
export const T_DISPLACEMENT_SET = 125;
export const T_DISPLACEMENT_AT = 126;
export const T_OFFSET = 127;
export const T_VELOCITY = 130;
export const T_DISPLAYED = 133; // pose
export const T_RELOCATION = 138;
export const T_LAST = 139;
export const T_ANGLE = 140;
// This call's sample input (contracts/pose-presentation SampleInput).
export const I_SET = 141; // 1 when the actor has a timed sample this frame
export const I_AT_MS = 142;
export const I_REVISION = 143;
export const I_MOVING = 144;
export const I_FROM_SET = 145;
export const I_FROM = 146; // pose
export const I_TO_SET = 151;
export const I_TO = 152; // pose
export const I_TO_ID = 157;
export const I_DURATION_SET = 158;
export const I_DURATION = 159;
export const I_STARTED_SET = 160;
export const I_STARTED = 161;
export const I_DISPLACEMENT = 162; // input.displacement is truthy
export const I_OWN_LEG = 163; // input.ownLeg === true
export const I_WALK = 164; // arena offset of the effective chain, or -1
export const I_TRANSITION_SET = 165;
export const I_LOGICAL_ZERO = 166; // transition.logicalDistance === 0
export const I_RELOCATION = 167; // transition?.relocation ?? 0
export const I_REASON = 168; // REASON_* code
export const I_INELIGIBLE = 169; // transition?.eligible === false
export const I_PATH_ELIGIBLE = 170; // transition.pathEligible === true
export const I_CORRIDOR_SET = 171;
export const I_CORRIDOR = 172; // from pose, to pose
export const I_PREVIOUS_PATH_SET = 182;
export const I_PREVIOUS_PATH = 183; // from pose, to pose
export const I_TURN_SET = 193;
export const I_TURN = 194; // incoming from, to; outgoing from, to
// This call: the logical pose, the frame time, the clock origin, and the drawn pose.
export const C_TARGET = 214; // pose
export const C_NOW = 219; // seconds
export const C_SETTLED = 220; // settledTranslation
export const C_ORIGIN_SET = 221;
export const C_ORIGIN_MS = 222;
export const O_POSE = 223; // the drawn pose
// Doubles in one record.
export const POSE_RECORD = 228;
