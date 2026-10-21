/*
===========================================================================

pose-presentation.ts - the rendered pose of every character, camera included

The simulation worker owns logical poses; this module owns what is drawn.

A character whose samples carry the simulation time they were taken at (the
local player, and every entity walking a path) is drawn on the frame clock:
the pose is extrapolated along the velocity of its last two samples to the
frame's own time, never past the end of the leg. Busy frames that deliver
samples late or in bursts therefore no longer slow a walk down and then
fast-forward it. Characters without sample times bridge the observed
delivery interval between samples instead.

The worker's admitted leg duration supplies horizontal velocity until the
second sample arrives. Coalescing a click and its receipt must not invent a
stationary frame while waiting to rediscover velocity from two positions.

Small jumps between consecutive models of a sampled character (a server
correction when a cast or pickup stops the player, a leg turn, a monster's
halt) become a bounded critically damped correction, so the
body and the camera glide instead of snapping. This smoothing is
presentation only and a deliberate deviation from the original client,
which snaps; logical poses stay authoritative.

The rules themselves are the pose kernel (foundation/kernels/pose-kernel.ts),
which works on one actor's flat record so a frame worker can run it. This
module owns the records, one per character (player, monster, NPC or pet),
and the walk arena their certified chains live in: it writes each call's
input into the character's record, runs the kernel on a copy and hands the
drawn pose back as an object.

===========================================================================
*/
import type { Pose } from "@/engine/contracts/gameplay";
import type { SampleInput } from "@/engine/contracts/pose-presentation";
export type { SampleInput } from "@/engine/contracts/pose-presentation";
import { POSE_SCRATCH, presentPose } from "@/engine/foundation/kernels/pose-kernel";
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
	MISSING_REVISION,
	MOVING_FALSE,
	MOVING_MISSING,
	MOVING_TRUE,
	O_POSE,
	POSE_RECORD,
	POSE_WORDS,
	REASON_INPUT,
	REASON_OTHER,
	REASON_RECEIPT,
	T_CARRIED,
	T_DISPLAYED,
	T_EXISTS,
	T_MOVING,
	T_WALK,
	U_EXISTS,
	U_MOVING
} from "@/engine/foundation/kernels/pose-record";

// Records held before the table first grows; it doubles as needed.
const INITIAL_SLOTS = 256;
// Arena doubles before it first grows; compaction keeps it at least twice
// the live chains.
const INITIAL_ARENA = 65536;
const NO_CHAIN = -1;

/*
================
writePose
================
*/
function writePose( table: Float64Array, at: number, pose: Pose ) {
	table[at] = pose.regionId;
	table[at + 1] = pose.x;
	table[at + 2] = pose.y;
	table[at + 3] = pose.z;
	table[at + 4] = pose.angle;
}

/*
================
writeOptionalPose

A pose the input may leave undefined: its flag, and its fields when set.
================
*/
function writeOptionalPose( table: Float64Array, flag: number, at: number, pose: Pose | undefined ) {
	table[flag] = pose ? 1 : 0;
	if ( pose ) writePose( table, at, pose );
}

/*
================
writePath
================
*/
function writePath( table: Float64Array, flag: number, at: number, path: { from: Pose; to: Pose; } | undefined ) {
	table[flag] = path ? 1 : 0;
	if ( !path ) return;
	writePose( table, at, path.from );
	writePose( table, at + POSE_WORDS, path.to );
}

/*
================
reasonCode
================
*/
function reasonCode( reason: string | undefined ): number {
	return reason === "input" ? REASON_INPUT : reason === "receipt" ? REASON_RECEIPT : REASON_OTHER;
}

/*
================
createPosePresentation

The worker journal is backpressured and can deliver several fixed steps in
one batch. Never extrapolate beyond admitted navigation; the camera shares
this sample.
================
*/
export function createPosePresentation() {
	let table = new Float64Array( INITIAL_SLOTS * POSE_RECORD );
	let arena = new Float64Array( INITIAL_ARENA ), arenaUsed = 0;
	const scratch = new Float64Array( POSE_SCRATCH );
	const slots = new Map<number, number>(), freeSlots: number[] = [];
	let slotCount = 0;
	// Per slot: the chain object last written as input, and its arena offset.
	const inputChains: (readonly Pose[] | undefined)[] = [], inputChainAt: number[] = [];
	// Leg ends are compared by identity (a new object is a new leg end).
	const identities = new WeakMap<object, number>();
	let nextIdentity = 1;
	let inputs: ReadonlyMap<number, SampleInput> = new Map();
	// Frame-clock milliseconds of simulation time zero (ClockSample.originMs).
	let originMs: number | null = null;

	/*
	================
	identityOf
	================
	*/
	function identityOf( value: object ): number {
		let identity = identities.get( value );
		if ( identity === undefined ) {
			identity = nextIdentity++;
			identities.set( value, identity );
		}
		return identity;
	}

	/*
	================
	slotOf

	The character's record, made empty on first use.
	================
	*/
	function slotOf( gid: number ): number {
		let slot = slots.get( gid );
		if ( slot !== undefined ) return slot;
		slot = freeSlots.pop() ?? slotCount++;
		if ( (slot + 1) * POSE_RECORD > table.length ) {
			const grown = new Float64Array( table.length * 2 );
			grown.set( table );
			table = grown;
		}
		const base = slot * POSE_RECORD;
		table.fill( 0, base, base + POSE_RECORD );
		table[base + T_WALK] = NO_CHAIN;
		table[base + I_WALK] = NO_CHAIN;
		inputChains[slot] = undefined;
		inputChainAt[slot] = NO_CHAIN;
		slots.set( gid, slot );
		return slot;
	}

	/*
	================
	releaseSlot
	================
	*/
	function releaseSlot( gid: number, slot: number ) {
		slots.delete( gid );
		inputChains[slot] = undefined;
		freeSlots.push( slot );
	}

	/*
	================
	compactArena

	Make room for words more: keep only the chains a record or a slot's last
	input still names, in a new arena at least twice their size.
	================
	*/
	function compactArena( words: number ) {
		const moved = new Map<number, number>();
		let live = 0;
		const roots: number[] = [];
		for ( const slot of slots.values() ) {
			const base = slot * POSE_RECORD;
			if ( table[base + T_WALK]! >= 0 ) roots.push( table[base + T_WALK]! );
			if ( inputChains[slot] ) roots.push( inputChainAt[slot]! );
		}
		for ( const at of roots ) {
			if ( moved.has( at ) ) continue;
			moved.set( at, -1 );
			live += 1 + arena[at]! * POSE_WORDS;
		}
		let capacity = INITIAL_ARENA;
		while ( capacity < 2 * (live + words) ) capacity *= 2;
		const next = new Float64Array( capacity );
		let used = 0;
		for ( const at of moved.keys() ) {
			const length = 1 + arena[at]! * POSE_WORDS;
			next.set( arena.subarray( at, at + length ), used );
			moved.set( at, used );
			used += length;
		}
		for ( const slot of slots.values() ) {
			const base = slot * POSE_RECORD;
			if ( table[base + T_WALK]! >= 0 ) table[base + T_WALK] = moved.get( table[base + T_WALK]! )!;
			if ( inputChains[slot] ) inputChainAt[slot] = moved.get( inputChainAt[slot]! )!;
		}
		arena = next;
		arenaUsed = used;
	}

	/*
	================
	chainAt

	The arena offset of the slot's input chain, written once per chain
	object: published chains are immutable (walking-history.ts).
	================
	*/
	function chainAt( slot: number, chain: readonly Pose[] | undefined ): number {
		if ( !chain ) return NO_CHAIN;
		if ( inputChains[slot] === chain ) return inputChainAt[slot]!;
		const words = 1 + chain.length * POSE_WORDS;
		if ( arenaUsed + words > arena.length ) compactArena( words );
		const at = arenaUsed;
		arena[at] = chain.length;
		for ( let i = 0; i < chain.length; i++ ) writePose( arena, at + 1 + i * POSE_WORDS, chain[i]! );
		arenaUsed += words;
		inputChains[slot] = chain;
		inputChainAt[slot] = at;
		return at;
	}

	/*
	================
	writeInput

	This call's sample input into the record, every field the kernel reads.
	================
	*/
	function writeInput( slot: number, input: SampleInput | undefined ) {
		const base = slot * POSE_RECORD;
		table[base + I_SET] = input ? 1 : 0;
		if ( !input ) return;
		const transition = input.transition;
		table[base + I_AT_MS] = input.atMs;
		table[base + I_REVISION] = input.revision ?? MISSING_REVISION;
		table[base + I_MOVING] = input.moving === true ?
			MOVING_TRUE :
			input.moving === false ?
			MOVING_FALSE :
			MOVING_MISSING;
		writeOptionalPose( table, base + I_FROM_SET, base + I_FROM, input.from );
		writeOptionalPose( table, base + I_TO_SET, base + I_TO, input.to );
		table[base + I_TO_ID] = input.to ? identityOf( input.to ) : 0;
		table[base + I_DURATION_SET] = input.durationMs === undefined ? 0 : 1;
		table[base + I_DURATION] = input.durationMs ?? 0;
		table[base + I_STARTED_SET] = input.startedAtMs === undefined ? 0 : 1;
		table[base + I_STARTED] = input.startedAtMs ?? 0;
		table[base + I_DISPLACEMENT] = input.displacement ? 1 : 0;
		table[base + I_OWN_LEG] = input.ownLeg === true ? 1 : 0;
		// Resolved before the arena may move the table's chains.
		const chain = chainAt( slot, input.displacement ? undefined : input.walkingPath ?? transition?.walkingPath );
		table[base + I_WALK] = chain;
		table[base + I_TRANSITION_SET] = transition ? 1 : 0;
		table[base + I_LOGICAL_ZERO] = transition?.logicalDistance === 0 ? 1 : 0;
		table[base + I_RELOCATION] = transition?.relocation ?? 0;
		table[base + I_REASON] = reasonCode( transition?.reason );
		table[base + I_INELIGIBLE] = transition?.eligible === false ? 1 : 0;
		table[base + I_PATH_ELIGIBLE] = transition?.pathEligible === true ? 1 : 0;
		writePath( table, base + I_CORRIDOR_SET, base + I_CORRIDOR, transition?.corridor );
		writePath( table, base + I_PREVIOUS_PATH_SET, base + I_PREVIOUS_PATH, transition?.previousPath );
		table[base + I_TURN_SET] = transition?.turn ? 1 : 0;
		if ( transition?.turn ) {
			writePath( table, base + I_TURN_SET, base + I_TURN, transition.turn.incoming );
			writePath( table, base + I_TURN_SET, base + I_TURN + 2 * POSE_WORDS, transition.turn.outgoing );
		}
	}

	/*
	================
	present

	Run the kernel for one character on a copy of its record.
	================
	*/
	function present( gid: number, target: Pose, now: number, settledTranslation: boolean ): Pose {
		const slot = slotOf( gid );
		writeInput( slot, inputs.get( gid ) );
		const base = slot * POSE_RECORD;
		writePose( table, base + C_TARGET, target );
		table[base + C_NOW] = now;
		table[base + C_SETTLED] = settledTranslation ? 1 : 0;
		table[base + C_ORIGIN_SET] = originMs === null ? 0 : 1;
		table[base + C_ORIGIN_MS] = originMs ?? 0;
		for ( let i = 0; i < POSE_RECORD; i++ ) scratch[i] = table[base + i]!;
		presentPose( scratch, arena );
		for ( let i = 0; i < POSE_RECORD; i++ ) table[base + i] = scratch[i]!;
		return {
			regionId: scratch[O_POSE]!,
			x: scratch[O_POSE + 1]!,
			y: scratch[O_POSE + 2]!,
			z: scratch[O_POSE + 3]!,
			angle: scratch[O_POSE + 4]!
		};
	}

	return {
		/*
		================
		origin
		================
		*/
		origin( ms: number ) {
			originMs = ms;
		},
		/*
		================
		samples

		This frame's timed samples by character. A character missing from the
		map is drawn by delivery interpolation and its sampled track retires.
		================
		*/
		samples( next: ReadonlyMap<number, SampleInput> ) {
			inputs = next;
			for ( const [gid, slot] of slots ) if ( !next.has( gid ) ) table[slot * POSE_RECORD + T_EXISTS] = 0;
		},
		/*
		================
		pose
		================
		*/
		pose( gid: number, target: Pose, now: number, settledTranslation = false ): Pose {
			return present( gid, target, now, settledTranslation );
		},
		/*
		================
		carry

		Hand a drawn pose back to the sampled track: its owner showed this pose
		instead of the presented one (actor-motion's WAIT hold). The track then
		recovers from it at walking speed rather than jumping to the model.
		================
		*/
		carry( gid: number, displayed: Pose ) {
			const slot = slots.get( gid );
			if ( slot === undefined || table[slot * POSE_RECORD + T_EXISTS] !== 1 ) return;
			writePose( table, slot * POSE_RECORD + T_DISPLAYED, displayed );
			table[slot * POSE_RECORD + T_CARRIED] = 1;
		},
		/*
		================
		moving

		A decaying correction is a glide, not a walk: a sampled character's
		animation follows its logical movement flag.
		================
		*/
		moving( gid: number ) {
			const slot = slots.get( gid );
			if ( slot === undefined ) return false;
			const base = slot * POSE_RECORD;
			if ( table[base + T_EXISTS] === 1 ) return table[base + T_MOVING] === 1;
			return table[base + U_EXISTS] === 1 && table[base + U_MOVING] === 1;
		},
		/*
		================
		retain
		================
		*/
		retain( gids: ReadonlySet<number> ) {
			for ( const [gid, slot] of slots ) if ( !gids.has( gid ) ) releaseSlot( gid, slot );
		},
		/*
		================
		reset
		================
		*/
		reset() {
			for ( const [gid, slot] of slots ) releaseSlot( gid, slot );
			inputs = new Map();
		}
	};
}
