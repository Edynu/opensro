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

At the start of the characters step, prepare() computes the next two
calls of every character the step will pose in one phase, forked on the
frame workers when the page has them (frame-kernels.ts KERNEL_POSE), while
the step goes on; the first call that needs a record joins the phase. A
later call takes its precomputed result only when its arguments are the
predicted ones; any other call, a carry or a new frame first rolls the
record back to the state after the last result handed out. The drawn
poses are therefore the ones the calls in order would have drawn on one
thread.

===========================================================================
*/
import type { Pose } from "@/engine/contracts/gameplay";
import type { SampleInput } from "@/engine/contracts/pose-presentation";
export type { SampleInput } from "@/engine/contracts/pose-presentation";
import type { FrameJobRunner } from "@/engine/foundation/workers/frame-jobs";
import { presentPose } from "@/engine/foundation/kernels/pose-kernel";
import {
	INITIAL_POSE_SLOTS,
	KERNEL_POSE,
	MAX_ARENA_WORDS,
	MAX_POSE_SLOTS,
	POSE_CHUNK,
	POSE_SNAPSHOTS,
	REQUEST_COUNT,
	REQUEST_SLOTS,
	createFrameKernelMemory,
	frameKernelViews,
	growTable,
	predictedPoseAt,
	plainBuffer,
	refreshViews,
	restoreRecord,
	runFrameKernel,
	snapshotRecord
} from "@/engine/foundation/kernels/frame-kernels";
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

const NO_CHAIN = -1;
// Past this frame gap the interval was never drawn (a hidden or frozen
// tab, not a visible hitch): snap to the authoritative pose on return
// instead of gliding the unseen travel. Visible stalls stay below it and
// keep the tested recovery above.
const MAX_UNSEEN_GAP_SECONDS = 2;

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
PoseFrameWorkers

What the pose presentation needs from the frame workers.
================
*/
export type PoseFrameWorkers = import("@/engine/contracts/frame-workers").FrameKernelPhases;

/*
================
PoseRequest

A character whose pose() the frame is about to ask for, with the target it
will pass (presentation-events.ts, before effects anchor to the drawn pose).
================
*/
export interface PoseRequest {
	readonly gid: number;
	readonly target: Pose;
}

/*
================
createPosePresentation

The worker journal is backpressured and can deliver several fixed steps in
one batch. Never extrapolate beyond admitted navigation; the camera shares
this sample.

With frame workers, prepare() runs the requested characters' next two
pose() calls on them; without, on this thread through the same kernel.
================
*/
export function createPosePresentation( workers?: PoseFrameWorkers ) {
	const memory = workers?.memory() ?? createFrameKernelMemory( plainBuffer );
	const views = frameKernelViews( memory );
	const slots = new Map<number, number>(), freeSlots: number[] = [];
	let slotCount = 0, arenaUsed = 0;
	// Per slot: the chain last written as input, and its arena offset.
	const inputChains: (Float64Array | undefined)[] = [], inputChainAt: number[] = [];
	// Per slot: predicted calls not yet handed out (2, 1 or 0), and the target
	// they were computed for; the frame time is the prepare's.
	const pending: number[] = [], pendingSlots: number[] = [];
	let predictedTargets = new Float64Array( INITIAL_POSE_SLOTS * POSE_WORDS ), predictedNow = 0;
	// Leg ends are compared by identity (a new object is a new leg end).
	const identities = new WeakMap<object, number>();
	let nextIdentity = 1;
	let inputs: ReadonlyMap<number, SampleInput> = new Map();
	// Frame-clock milliseconds of simulation time zero (ClockSample.originMs).
	let originMs: number | null = null;
	/*
	================
	runLocal
	================
	*/
	const runLocal: FrameJobRunner = ( kernel, chunk ) => runFrameKernel( views, kernel, chunk );
	// A KERNEL_POSE phase prepare forked and nothing has joined yet.
	let forked = false;
	// Frame-clock seconds of the last pose served; the return frame after a
	// long unseen gap snaps instead of recovering (MAX_UNSEEN_GAP_SECONDS).
	let lastPoseAt: number | undefined;

	/*
	================
	joinPhase

	Wait for the phase prepare forked, running what the workers have not
	claimed: before anything reads, writes or rolls back a record.
	================
	*/
	function joinPhase() {
		if ( !forked ) return;
		forked = false;
		workers!.join( runLocal );
	}

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

	The character's record, made empty on first use. The tables grow in
	place, so no record or snapshot moves.
	================
	*/
	function slotOf( gid: number ): number {
		let slot = slots.get( gid );
		if ( slot !== undefined ) return slot;
		slot = freeSlots.pop() ?? slotCount++;
		if ( slot >= MAX_POSE_SLOTS ) throw Error( "Pose presentation character capacity exceeded" );
		const bytes = (slot + 1) * POSE_RECORD * Float64Array.BYTES_PER_ELEMENT;
		if ( bytes > memory.poseRecords.byteLength ) {
			const grown = Math.min( MAX_POSE_SLOTS * POSE_RECORD * Float64Array.BYTES_PER_ELEMENT, bytes * 2 );
			growTable( memory, "poseRecords", grown );
			growTable( memory, "poseSnapshots", grown * POSE_SNAPSHOTS );
			refreshViews( views );
		}
		if ( (slot + 1) * POSE_WORDS > predictedTargets.length ) {
			const grown = new Float64Array( predictedTargets.length * 2 );
			grown.set( predictedTargets );
			predictedTargets = grown;
		}
		const base = slot * POSE_RECORD, table = views.poseRecords;
		table.fill( 0, base, base + POSE_RECORD );
		table[base + T_WALK] = NO_CHAIN;
		table[base + I_WALK] = NO_CHAIN;
		inputChains[slot] = undefined;
		inputChainAt[slot] = NO_CHAIN;
		pending[slot] = 0;
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
	rollback

	The character's record back to the state after the last predicted call
	handed out: before both (snapshot 0) or after the first (snapshot 1).
	================
	*/
	function rollback( slot: number ) {
		if ( !pending[slot] ) return;
		restoreRecord( views, slot, pending[slot] === 2 ? 0 : 1 );
		pending[slot] = 0;
	}

	/*
	================
	settle

	Roll back every prediction not handed out: before the samples, origin or
	population they assumed change.
	================
	*/
	function settle() {
		for ( const slot of pendingSlots ) rollback( slot );
		pendingSlots.length = 0;
	}

	/*
	================
	compactArena

	In place: keep only the chains a record or a slot's last input still
	names, slid down in offset order. Only while no prediction is pending,
	whose snapshots would still name the old offsets. A record's input chain
	is its slot's last input chain or stale (rewritten before any kernel
	reads it), so it is remapped or cleared: prepare writes every input
	before the kernels run, and a later input's compaction must not leave
	an earlier one naming a moved chain.
	================
	*/
	function compactArena() {
		const arena = views.walkArena, table = views.poseRecords;
		const roots = new Set<number>();
		for ( const slot of slots.values() ) {
			const walk = table[slot * POSE_RECORD + T_WALK]!;
			if ( walk >= 0 ) roots.add( walk );
			if ( inputChains[slot] ) roots.add( inputChainAt[slot]! );
		}
		const moved = new Map<number, number>();
		let used = 0;
		for ( const at of [ ...roots ].sort( ( a, b ) => a - b ) ) {
			const length = 1 + arena[at]! * POSE_WORDS;
			arena.copyWithin( used, at, at + length );
			moved.set( at, used );
			used += length;
		}
		for ( const slot of slots.values() ) {
			const base = slot * POSE_RECORD;
			if ( table[base + T_WALK]! >= 0 ) table[base + T_WALK] = moved.get( table[base + T_WALK]! )!;
			if ( table[base + I_WALK]! >= 0 ) table[base + I_WALK] = moved.get( table[base + I_WALK]! ) ?? NO_CHAIN;
			if ( inputChains[slot] ) inputChainAt[slot] = moved.get( inputChainAt[slot]! )!;
		}
		arenaUsed = used;
	}

	/*
	================
	reserveArena

	Room for words more: compacted when nothing pending names the arena,
	then grown in place as needed.
	================
	*/
	function reserveArena( words: number ) {
		if ( arenaUsed + words <= views.walkArena.length ) return;
		if ( !pendingSlots.length ) compactArena();
		let length = views.walkArena.length;
		while ( arenaUsed + words > length ) length *= 2;
		if ( length > MAX_ARENA_WORDS ) throw Error( "Walk arena capacity exceeded" );
		growTable( memory, "walkArena", length * Float64Array.BYTES_PER_ELEMENT );
		refreshViews( views );
	}

	/*
	================
	chainAt

	The arena offset of the slot's input chain, copied in once per published
	chain: chains are immutable and already in the arena's entry layout
	(walking-history.ts flattenWalkingPath).
	================
	*/
	function chainAt( slot: number, chain: Float64Array | undefined ): number {
		if ( !chain ) return NO_CHAIN;
		if ( inputChains[slot] === chain ) return inputChainAt[slot]!;
		const words = chain.length;
		reserveArena( words );
		const at = arenaUsed;
		views.walkArena.set( chain, at );
		arenaUsed += words;
		inputChains[slot] = chain;
		inputChainAt[slot] = at;
		return at;
	}

	/*
	================
	writeInput

	This frame's sample input into the record, every field the kernel reads.
	================
	*/
	function writeInput( slot: number, input: SampleInput | undefined ) {
		// The chain first: reserving arena room can compact it, which remaps
		// this record's chain offsets too.
		const chain = input ?
			chainAt( slot, input.displacement ? undefined : input.walkingChain ?? input.transition?.walkingChain ) :
			NO_CHAIN;
		const base = slot * POSE_RECORD, table = views.poseRecords;
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
	writeCall

	This call's target, frame time, settled flag and clock origin.
	================
	*/
	function writeCall( slot: number, target: Pose, now: number, settledTranslation: boolean ) {
		const base = slot * POSE_RECORD, table = views.poseRecords;
		writePose( table, base + C_TARGET, target );
		table[base + C_NOW] = now;
		table[base + C_SETTLED] = settledTranslation ? 1 : 0;
		table[base + C_ORIGIN_SET] = originMs === null ? 0 : 1;
		table[base + C_ORIGIN_MS] = originMs ?? 0;
	}

	/*
	================
	readPose
	================
	*/
	function readPose( table: Float64Array, at: number ): Pose {
		return { regionId: table[at]!, x: table[at + 1]!, y: table[at + 2]!, z: table[at + 3]!, angle: table[at + 4]! };
	}

	/*
	================
	present

	Run the kernel for one character on this thread, on a copy of its
	record. A throw leaves the record as it was.
	================
	*/
	function present( gid: number, target: Pose, now: number, settledTranslation: boolean ): Pose {
		const slot = slotOf( gid );
		writeInput( slot, inputs.get( gid ) );
		writeCall( slot, target, now, settledTranslation );
		const base = slot * POSE_RECORD, table = views.poseRecords, scratch = views.scratch;
		for ( let i = 0; i < POSE_RECORD; i++ ) scratch[i] = table[base + i]!;
		presentPose( scratch, views.walkArena );
		for ( let i = 0; i < POSE_RECORD; i++ ) table[base + i] = scratch[i]!;
		return readPose( scratch, O_POSE );
	}

	/*
	================
	predicted

	Whether a call matches the predicted one: an unsettled call at the
	prepare's frame time with the same target, bit for bit.
	================
	*/
	function predicted( slot: number, target: Pose, now: number, settledTranslation: boolean ): boolean {
		const at = slot * POSE_WORDS;
		return !settledTranslation && Object.is( now, predictedNow ) &&
			Object.is( target.regionId, predictedTargets[at] ) && Object.is( target.x, predictedTargets[at + 1] ) &&
			Object.is( target.y, predictedTargets[at + 2] ) && Object.is( target.z, predictedTargets[at + 3] ) &&
			Object.is( target.angle, predictedTargets[at + 4] );
	}

	return {
		/*
		================
		origin
		================
		*/
		origin( ms: number ) {
			joinPhase();
			if ( ms !== originMs ) settle();
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
			joinPhase();
			settle();
			inputs = next;
			for ( const [gid, slot] of slots ) {
				if ( !next.has( gid ) ) views.poseRecords[slot * POSE_RECORD + T_EXISTS] = 0;
			}
		},
		/*
		================
		prepare

		Compute the requested characters' next two pose() calls at once, forked
		on the frame workers when there are any: each as an unsettled call with
		its target at time now, the second repeating the first's arguments.
		pose() hands them out while its arguments match and falls back to
		this thread from the state after the last one handed out when they do
		not, so every drawn pose is the one the calls in order would draw.
		================
		*/
		prepare( requests: readonly PoseRequest[], now: number ) {
			joinPhase();
			settle();
			const count = Math.min( requests.length, MAX_POSE_SLOTS );
			if ( !count ) return;
			// Inputs first: reserving their chains may compact the arena, which
			// must not happen once a snapshot names it.
			for ( let i = 0; i < count; i++ ) {
				const request = requests[i]!;
				writeInput( slotOf( request.gid ), inputs.get( request.gid ) );
			}
			const list = views.poseRequests;
			for ( let i = 0; i < count; i++ ) {
				const request = requests[i]!, slot = slots.get( request.gid )!;
				writeCall( slot, request.target, now, false );
				writePose( predictedTargets, slot * POSE_WORDS, request.target );
				snapshotRecord( views, slot );
				list[REQUEST_SLOTS + i] = slot;
				pending[slot] = 2;
				pendingSlots.push( slot );
			}
			list[REQUEST_COUNT] = count;
			predictedNow = now;
			const chunks = Math.ceil( count / POSE_CHUNK );
			if ( workers ) {
				workers.fork( KERNEL_POSE, chunks );
				forked = true;
			} else for ( let chunk = 0; chunk < chunks; chunk++ ) runLocal( KERNEL_POSE, chunk );
		},
		/*
		================
		pose
		================
		*/
		pose( gid: number, target: Pose, now: number, settledTranslation = false ): Pose {
			joinPhase();
			// Past MAX_UNSEEN_GAP_SECONDS the interval was never drawn (a hidden
			// tab): every character starts again from its authoritative pose, as
			// a fresh record does, rather than gliding the travel no one saw.
			if ( lastPoseAt !== undefined && now - lastPoseAt > MAX_UNSEEN_GAP_SECONDS ) {
				settle();
				for ( const [held, slot] of slots ) releaseSlot( held, slot );
			}
			if ( lastPoseAt === undefined || now > lastPoseAt ) lastPoseAt = now;
			const slot = slots.get( gid );
			if ( slot !== undefined && pending[slot] ) {
				if ( predicted( slot, target, now, settledTranslation ) ) {
					if ( pending[slot] === 2 ) {
						pending[slot] = 1;
						return readPose( views.poseSnapshots, predictedPoseAt( slot, 1 ) );
					}
					pending[slot] = 0;
					return readPose( views.poseRecords, slot * POSE_RECORD + O_POSE );
				}
				rollback( slot );
			}
			return present( gid, target, now, settledTranslation );
		},
		/*
		================
		join

		The forked phase over, if one is open: before another frame phase.
		================
		*/
		join: joinPhase,
		/*
		================
		carry

		Hand a drawn pose back to the sampled track: its owner showed this pose
		instead of the presented one (actor-motion's WAIT hold). The track then
		recovers from it at walking speed rather than jumping to the model.
		================
		*/
		carry( gid: number, displayed: Pose ) {
			joinPhase();
			const slot = slots.get( gid );
			if ( slot === undefined ) return;
			rollback( slot );
			const base = slot * POSE_RECORD, table = views.poseRecords;
			if ( table[base + T_EXISTS] !== 1 ) return;
			writePose( table, base + T_DISPLAYED, displayed );
			table[base + T_CARRIED] = 1;
		},
		/*
		================
		moving

		A decaying correction is a glide, not a walk: a sampled character's
		animation follows its logical movement flag. Reads the state after the
		last call handed out, without settling the rest.
		================
		*/
		moving( gid: number ) {
			joinPhase();
			const slot = slots.get( gid );
			if ( slot === undefined ) return false;
			const table = pending[slot] ? views.poseSnapshots : views.poseRecords;
			const base = pending[slot] ?
				(slot * POSE_SNAPSHOTS + (pending[slot] === 2 ? 0 : 1)) * POSE_RECORD :
				slot * POSE_RECORD;
			if ( table[base + T_EXISTS] === 1 ) return table[base + T_MOVING] === MOVING_TRUE;
			return table[base + U_EXISTS] === 1 && table[base + U_MOVING] === 1;
		},
		/*
		================
		retain
		================
		*/
		retain( gids: ReadonlySet<number> ) {
			joinPhase();
			settle();
			for ( const [gid, slot] of slots ) if ( !gids.has( gid ) ) releaseSlot( gid, slot );
		},
		/*
		================
		reset
		================
		*/
		reset() {
			joinPhase();
			settle();
			for ( const [gid, slot] of slots ) releaseSlot( gid, slot );
			inputs = new Map();
			lastPoseAt = undefined;
		}
	};
}
