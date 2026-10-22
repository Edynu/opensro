/*
===========================================================================

frame-workers.ts - the main thread's frame workers and their shared control

Owns the frame workers, the control block's memory and each phase's fork
and join (foundation/workers/frame-jobs.ts). The main thread opens a phase,
claims chunks beside the workers, then waits for the last one. How many
workers start follows the Experimental "Worker threads" setting and the
machine (frameWorkerCount). Without cross-origin isolation there is no
shared memory: no worker starts, and every phase runs here on the same
code path.

A worker that misses a join's deadline retires them all: they stop, this
thread finishes the phase, and every later phase runs here. The frame never
loses a chunk and the session does not end for it.

The kernels' output tables are fixed-size and replaced, not grown
(frame-kernels.ts OUTPUT_TABLES). Before each phase opens, a table
replaced since the last is posted to every worker and the control
block's table count bumped (frame-jobs.ts replaceFrameTables): a worker
claims nothing until it holds the new tables, and the join runs what it
would have.

Port-only, not native: the original client runs its frame on one thread.
The setting is read when the runtime starts, so a change applies after a
reload.

===========================================================================
*/
import type { FrameWorkerStart, FrameWorkerStatistics, FrameWorkerTables } from "@/engine/contracts/frame-workers";
import { storedExperimentalOptions } from "@/engine/foundation/ui/experimental-options";
import {
	createFrameKernelMemory,
	OUTPUT_TABLES,
	plainBuffer,
	type FrameKernelMemory,
	type KernelTable
} from "@/engine/foundation/kernels/frame-kernels";
import {
	FRAME_CONTROL_WORDS,
	type FrameJobRunner,
	finishFramePhase,
	framePhaseComplete,
	framePhaseFailed,
	frameWorkerCount,
	nextFrameGeneration,
	publishFramePhase,
	readyFrameWorkers,
	replaceFrameTables,
	serveFramePhase,
	stopFrameJobs
} from "@/engine/foundation/workers/frame-jobs";

// A join that waits longer than this retires the workers: one has stalled
// or died, and every later phase runs on this thread.
const JOIN_TIMEOUT_MS = 250;
// Spins between clock reads while waiting at a join.
const JOIN_CLOCK_SPINS = 1024;

/*
================
sharedBuffer

The kernel tables' allocator while frame workers run: growable shared
memory every worker's views follow, or, for an output table the GPU reads
straight from, fixed-size shared memory (writeBuffer refuses a growable
buffer).
================
*/
function sharedBuffer( bytes: number, maxBytes: number, fixed = false ): ArrayBufferLike {
	return fixed ? new SharedArrayBuffer( bytes ) : new SharedArrayBuffer( bytes, { maxByteLength: maxBytes } );
}

/*
================
createFrameWorkers
================
*/
export function createFrameWorkers() {
	let setting: import("@/engine/foundation/workers/frame-jobs").FrameWorkerSetting = "off";
	try {
		setting = storedExperimentalOptions( globalThis.localStorage ).options.frameWorkers;
	} catch {}
	const isolated = globalThis.crossOriginIsolated === true;
	// Kernel tables grow in place between phases (frame-kernels.ts); a page
	// whose shared memory cannot grow keeps its frame on this thread.
	const growable = isolated && typeof SharedArrayBuffer.prototype.grow === "function";
	const started = growable ? frameWorkerCount( globalThis.navigator?.hardwareConcurrency ?? 1, setting ) : 0;
	const bytes = FRAME_CONTROL_WORDS * Int32Array.BYTES_PER_ELEMENT;
	const memory = started > 0 ? new SharedArrayBuffer( bytes ) : new ArrayBuffer( bytes );
	const control = new Int32Array( memory );
	const kernels: FrameKernelMemory = createFrameKernelMemory(
		started > 0 ? sharedBuffer : plainBuffer
	);
	const workers: Worker[] = [];
	// The output tables the workers hold, as last posted.
	const posted = new Map<KernelTable, ArrayBufferLike>( OUTPUT_TABLES.map( table => [ table, kernels[table] ] ) );
	let generation = 0, phases = 0, joinWaitMs = 0, retired: string | null = null;
	// The generation of the phase started and not yet finished; 0 when none.
	let open = 0;
	// The control block's table count (frame-jobs.ts replaceFrameTables).
	let frameTables = 0;
	for ( let index = 0; index < started; index++ ) {
		const worker = new Worker( new URL( "./worker/entry.ts", import.meta.url ), {
			type: "module",
			name: `sro-frame-${index}`
		} );
		worker.postMessage(
			{ kind: "start", control: memory as SharedArrayBuffer, kernels } satisfies FrameWorkerStart
		);
		workers.push( worker );
	}
	/*
	================
	retire
	================
	*/
	function retire( reason: string ) {
		stopFrameJobs( control );
		for ( const worker of workers ) worker.terminate();
		workers.length = 0;
		retired ??= reason;
	}
	/*
	================
	postTables

	The output tables replaced since the workers last got them, posted
	before the phase that may write them opens.
	================
	*/
	function postTables() {
		let replaced: Partial<FrameKernelMemory> | null = null;
		for ( const table of OUTPUT_TABLES ) {
			if ( posted.get( table ) === kernels[table] ) continue;
			posted.set( table, kernels[table] );
			(replaced ??= {})[table] = kernels[table];
		}
		if ( !replaced || !workers.length ) return;
		// Posted first: a worker that sees the count waits for its message.
		const tables = frameTables + 1;
		for ( const worker of workers ) {
			worker.postMessage( { kind: "tables", tables, buffers: replaced } satisfies FrameWorkerTables );
		}
		frameTables = replaceFrameTables( control );
	}
	/*
	================
	fork

	Open a phase of kernel over chunks: the workers start claiming at once.
	================
	*/
	function fork( kernel: number, chunks: number ) {
		if ( open ) throw Error( "A frame phase is already open" );
		postTables();
		generation = nextFrameGeneration( generation );
		phases++;
		publishFramePhase( control, generation, kernel, chunks );
		open = generation;
	}
	/*
	================
	join

	Run the open phase's unclaimed chunks here, then wait for the last one.
	local must be the kernel the workers run (frame-kernels dispatch).
	Throws when a chunk threw, as the single-threaded frame would have.
	================
	*/
	function join( local: FrameJobRunner ) {
		if ( !open ) throw Error( "No frame phase is open" );
		const phase = open;
		open = 0;
		let failure: unknown = undefined;
		const runLocal: FrameJobRunner = ( k, chunk ) => {
			try {
				local( k, chunk );
			} catch ( error ) {
				failure ??= error;
				throw error;
			}
		};
		serveFramePhase( control, runLocal );
		if ( !framePhaseComplete( control, phase ) ) {
			const waitStarted = performance.now();
			for ( let spins = 1; !framePhaseComplete( control, phase ); spins++ ) {
				if ( spins % JOIN_CLOCK_SPINS === 0 && performance.now() - waitStarted > JOIN_TIMEOUT_MS ) {
					retire( "A frame worker missed its join deadline" );
					finishFramePhase( control, phase, runLocal );
					break;
				}
			}
			joinWaitMs += performance.now() - waitStarted;
		}
		if ( framePhaseFailed( control, phase ) ) {
			throw failure ?? Error( "A frame worker chunk failed" );
		}
	}
	return {
		/*
		================
		enabled

		The player turned Worker threads on: work whose result is not the
		original's bit for bit (cloth's own random streams) runs on the frame
		workers then, or inline without them.
		================
		*/
		enabled: setting !== "off",
		/*
		================
		run

		One phase: kernel over chunks, on the workers and this thread. Returns
		once every chunk has run.
		================
		*/
		run( kernel: number, chunks: number, local: FrameJobRunner ) {
			fork( kernel, chunks );
			join( local );
		},
		fork,
		join,
		/*
		================
		memory

		The kernel tables every frame thread shares; growable in place.
		================
		*/
		memory(): FrameKernelMemory {
			return kernels;
		},
		/*
		================
		stats
		================
		*/
		stats(): FrameWorkerStatistics {
			// Terminated workers never count themselves out.
			const ready = workers.length ? readyFrameWorkers( control ) : 0;
			return { isolated, started, ready, phases, joinWaitMs, retired };
		},
		/*
		================
		dispose
		================
		*/
		dispose() {
			retire( "Disposed" );
		}
	};
}

/*
================
FrameWorkers
================
*/
export type FrameWorkers = ReturnType<typeof createFrameWorkers>;
