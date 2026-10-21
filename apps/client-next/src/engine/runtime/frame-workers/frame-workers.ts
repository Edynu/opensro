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

Port-only, not native: the original client runs its frame on one thread.
The setting is read when the runtime starts, so a change applies after a
reload.

===========================================================================
*/
import type { FrameWorkerStart, FrameWorkerStatistics } from "@/engine/contracts/frame-workers";
import { storedExperimentalOptions } from "@/engine/foundation/ui/experimental-options";
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
createFrameWorkers
================
*/
export function createFrameWorkers() {
	let setting: import("@/engine/foundation/workers/frame-jobs").FrameWorkerSetting = "off";
	try {
		setting = storedExperimentalOptions( globalThis.localStorage ).options.frameWorkers;
	} catch {}
	const isolated = globalThis.crossOriginIsolated === true;
	const started = isolated ? frameWorkerCount( globalThis.navigator?.hardwareConcurrency ?? 1, setting ) : 0;
	const bytes = FRAME_CONTROL_WORDS * Int32Array.BYTES_PER_ELEMENT;
	const memory = started > 0 ? new SharedArrayBuffer( bytes ) : new ArrayBuffer( bytes );
	const control = new Int32Array( memory );
	const workers: Worker[] = [];
	let generation = 0, phases = 0, joinWaitMs = 0, retired: string | null = null;
	for ( let index = 0; index < started; index++ ) {
		const worker = new Worker( new URL( "./worker/entry.ts", import.meta.url ), {
			type: "module",
			name: `sro-frame-${index}`
		} );
		worker.postMessage( { control: memory as SharedArrayBuffer } satisfies FrameWorkerStart );
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
	return {
		/*
		================
		run

		One phase: kernel over chunks, on the workers and this thread. Returns
		once every chunk has run. local runs a chunk here and must be the same
		kernel the workers run (frame-kernels dispatch). Throws when a chunk
		threw, as the single-threaded frame would have.
		================
		*/
		run( kernel: number, chunks: number, local: FrameJobRunner ) {
			let failure: unknown = undefined;
			const runLocal: FrameJobRunner = ( k, chunk ) => {
				try {
					local( k, chunk );
				} catch ( error ) {
					failure ??= error;
					throw error;
				}
			};
			generation = nextFrameGeneration( generation );
			phases++;
			publishFramePhase( control, generation, kernel, chunks );
			serveFramePhase( control, runLocal );
			if ( !framePhaseComplete( control, generation ) ) {
				const waitStarted = performance.now();
				for ( let spins = 1; !framePhaseComplete( control, generation ); spins++ ) {
					if ( spins % JOIN_CLOCK_SPINS === 0 && performance.now() - waitStarted > JOIN_TIMEOUT_MS ) {
						retire( "A frame worker missed its join deadline" );
						finishFramePhase( control, generation, runLocal );
						break;
					}
				}
				joinWaitMs += performance.now() - waitStarted;
			}
			if ( framePhaseFailed( control, generation ) ) {
				throw failure ?? Error( "A frame worker chunk failed" );
			}
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
