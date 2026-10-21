/*
===========================================================================

frame-jobs.ts - one frame phase shared by the main thread and frame workers

A phase is a kernel and a number of chunks. The main thread publishes it in
a shared control block, wakes the frame workers and claims chunks itself
beside them: whoever is free takes the next chunk, so uneven work balances
itself and a slow core simply takes fewer. With no workers the main thread
claims every chunk, so the inline path is the same code.

A claim is one compare-and-swap on a word holding the phase's generation
and its next chunk, so a worker that wakes late can never take a chunk of
a phase it has not read. Phase descriptors and completion counts alternate
between two slots, so the next phase never overwrites the one a straggler
is still reading. Stateless: the control block belongs to its owner
(runtime/frame-workers/frame-workers.ts).

===========================================================================
*/

/*
================
FrameJobRunner

Runs one chunk of one kernel. It must be restartable within its phase: a
chunk a failed worker left unfinished is run again by the main thread.
================
*/
export type FrameJobRunner = ( kernel: number, chunk: number ) => void;

/*
================
FrameWorkerSetting

Port-only, not native: the Experimental "Worker threads" choice.
================
*/
export type FrameWorkerSetting = "off" | "auto" | 1 | 2 | 4 | 8;

// The control block, in 32-bit words. Counters sit one 64-byte cache line
// (LINE words) apart so threads do not contend for a line:
//   0    WAKE    bumped once per phase; idle workers wait on it
//   16   STOP    nonzero: workers return from serveFrameJobs
//   32   READY   workers that have started serving
//   48   NEXT    (generation << GENERATION_SHIFT) | next unclaimed chunk
//   64   SLOTS   two phase slots, one line each: kernel, chunks, done, failed
//   96   CHUNK_STATES  one state per chunk of the open phase, for recovery
const LINE = 16;
const WAKE = 0;
const STOP = 16;
const READY = 32;
const NEXT = 48;
const SLOTS = 64;
const SLOT_KERNEL = 0;
const SLOT_CHUNKS = 1;
const SLOT_DONE = 2;
const SLOT_FAILED = 3;
const CHUNK_STATES = 96;
const CHUNK_FREE = 0;
const CHUNK_CLAIMED = 1;
const CHUNK_DONE = 2;
const GENERATION_SHIFT = 16;
// Generations run 1 .. GENERATION_LIMIT and wrap to 1. The limit is even so
// consecutive generations always alternate slots, wrap included.
const GENERATION_LIMIT = 0x7ffe;
const CHUNK_MASK = 0xffff;

// The largest phase, in chunks.
export const MAX_FRAME_CHUNKS = 1024;
// The control block's length in 32-bit words: CHUNK_STATES + MAX_FRAME_CHUNKS.
export const FRAME_CONTROL_WORDS = 1120;
// The most frame workers a page starts.
export const MAX_FRAME_WORKERS = 8;
// Threads the page needs besides its frame workers: the main thread, the
// browser's GPU process, and the simulation and asset workers together.
export const RESERVED_THREADS = 3;

/*
================
frameWorkerCount

How many frame workers to start for a machine with threads logical
processors (navigator.hardwareConcurrency) and the player's setting. Auto
leaves RESERVED_THREADS free; an explicit count is the player's choice.
================
*/
export function frameWorkerCount( threads: number, setting: FrameWorkerSetting ): number {
	if ( setting === "off" ) return 0;
	if ( setting !== "auto" ) return Math.min( MAX_FRAME_WORKERS, setting );
	const available = Number.isInteger( threads ) && threads > 0 ? threads : 1;
	return Math.min( MAX_FRAME_WORKERS, Math.max( 0, available - RESERVED_THREADS ) );
}

/*
================
nextFrameGeneration

The generation after one, wrapping inside the claim word; never zero, the
control block's initial, empty phase.
================
*/
export function nextFrameGeneration( generation: number ): number {
	return generation >= GENERATION_LIMIT || generation < 1 ? 1 : generation + 1;
}

/*
================
publishFramePhase

Owner only. Describe the phase in its slot, reset its chunks, then open it
with one store and wake the workers. Plain and atomic writes before the
opening store are visible to any thread that reads the opened word.
================
*/
export function publishFramePhase( control: Int32Array, generation: number, kernel: number, chunks: number ): void {
	if ( !Number.isInteger( chunks ) || chunks < 0 || chunks > MAX_FRAME_CHUNKS ) {
		throw Error( "Invalid frame phase size" );
	}
	const slot = SLOTS + (generation & 1) * LINE;
	control[slot + SLOT_KERNEL] = kernel;
	control[slot + SLOT_CHUNKS] = chunks;
	control[slot + SLOT_DONE] = 0;
	control[slot + SLOT_FAILED] = 0;
	control.fill( CHUNK_FREE, CHUNK_STATES, CHUNK_STATES + chunks );
	Atomics.store( control, NEXT, generation << GENERATION_SHIFT );
	Atomics.add( control, WAKE, 1 );
	Atomics.notify( control, WAKE );
}

/*
================
serveFramePhase

Claim and run chunks of the open phase until none is left. Main thread and
workers alike. A chunk that throws marks its phase failed and still counts
as done, so the owner's join ends and the owner decides what follows.
================
*/
export function serveFramePhase( control: Int32Array, run: FrameJobRunner ): void {
	for ( ;; ) {
		const word = Atomics.load( control, NEXT );
		const slot = SLOTS + ((word >>> GENERATION_SHIFT) & 1) * LINE, chunk = word & CHUNK_MASK;
		const chunks = Atomics.load( control, slot + SLOT_CHUNKS ),
			kernel = Atomics.load( control, slot + SLOT_KERNEL );
		if ( chunk >= chunks ) return;
		// A changed word means another claim or a newer phase: read again.
		if ( Atomics.compareExchange( control, NEXT, word, word + 1 ) !== word ) continue;
		Atomics.store( control, CHUNK_STATES + chunk, CHUNK_CLAIMED );
		try {
			run( kernel, chunk );
		} catch {
			Atomics.store( control, slot + SLOT_FAILED, 1 );
		}
		Atomics.store( control, CHUNK_STATES + chunk, CHUNK_DONE );
		Atomics.add( control, slot + SLOT_DONE, 1 );
	}
}

/*
================
framePhaseComplete
================
*/
export function framePhaseComplete( control: Int32Array, generation: number ): boolean {
	const slot = SLOTS + (generation & 1) * LINE;
	return Atomics.load( control, slot + SLOT_DONE ) >= Atomics.load( control, slot + SLOT_CHUNKS );
}

/*
================
framePhaseFailed
================
*/
export function framePhaseFailed( control: Int32Array, generation: number ): boolean {
	return Atomics.load( control, SLOTS + (generation & 1) * LINE + SLOT_FAILED ) !== 0;
}

/*
================
finishFramePhase

Owner only, after its workers were stopped: run every chunk of the phase
that no thread finished, on this thread. Chunks are restartable, so one a
worker died inside runs again from its inputs.
================
*/
export function finishFramePhase( control: Int32Array, generation: number, run: FrameJobRunner ): void {
	const slot = SLOTS + (generation & 1) * LINE, kernel = control[slot + SLOT_KERNEL]!;
	for ( let chunk = 0; chunk < control[slot + SLOT_CHUNKS]!; chunk++ ) {
		if ( control[CHUNK_STATES + chunk] === CHUNK_DONE ) continue;
		run( kernel, chunk );
		control[CHUNK_STATES + chunk] = CHUNK_DONE;
	}
	control[slot + SLOT_DONE] = control[slot + SLOT_CHUNKS]!;
	// Workers are stopped; nothing claims the closed phase again.
	control[NEXT] = (generation << GENERATION_SHIFT) | CHUNK_MASK;
}

/*
================
readyFrameWorkers
================
*/
export function readyFrameWorkers( control: Int32Array ): number {
	return Atomics.load( control, READY );
}

/*
================
stopFrameJobs

Owner only: every worker returns from serveFrameJobs once it next wakes.
================
*/
export function stopFrameJobs( control: Int32Array ): void {
	Atomics.store( control, STOP, 1 );
	Atomics.add( control, WAKE, 1 );
	Atomics.notify( control, WAKE );
}

/*
================
serveFrameJobs

A frame worker's whole life: serve each phase as it opens, sleep between
them, return when stopped. Blocks; workers only.
================
*/
export function serveFrameJobs( control: Int32Array, run: FrameJobRunner ): void {
	Atomics.add( control, READY, 1 );
	let seen = Atomics.load( control, WAKE );
	// A phase may already be open when the worker starts: join it.
	serveFramePhase( control, run );
	while ( Atomics.load( control, STOP ) === 0 ) {
		Atomics.wait( control, WAKE, seen );
		seen = Atomics.load( control, WAKE );
		if ( Atomics.load( control, STOP ) !== 0 ) break;
		serveFramePhase( control, run );
	}
	Atomics.sub( control, READY, 1 );
}
