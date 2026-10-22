/*
===========================================================================

frame-kernel-threads.mjs - frame workers for tests: real threads, or inline

createThreadedWorkers runs the shipping frame-jobs loop and kernel dispatch
on Node worker threads over growable shared kernel tables and fixed-size
output tables (frame-kernel-worker.mjs), and runs a phase as the browser's
frame-workers.ts does: post the output tables replaced since the last
phase, publish, serve beside the threads, join.
createInlineWorkers runs every chunk on this thread over ordinary buffers
(growable shared ones when shared), each chunk `repeat` times, as a chunk
a stalled worker left is run again.

===========================================================================
*/
import "./native-source-loader.mjs";
import { Worker } from "node:worker_threads";

const { createFrameKernelMemory, plainBuffer } = await import(
	"../../src/engine/foundation/kernels/frame-kernels.ts"
);
const { OUTPUT_TABLES } = await import( "../../src/engine/foundation/kernels/frame-kernels.ts" );
const {
	FRAME_CONTROL_WORDS,
	framePhaseComplete,
	framePhaseFailed,
	nextFrameGeneration,
	publishFramePhase,
	readyFrameWorkers,
	replaceFrameTables,
	serveFramePhase,
	stopFrameJobs
} = await import( "../../src/engine/foundation/workers/frame-jobs.ts" );

const WORKER = new URL( "./frame-kernel-worker.mjs", import.meta.url );
const JOIN_LIMIT_MS = 10000;

/*
================
createThreadedWorkers
================
*/
export async function createThreadedWorkers( count ) {
	const control = new Int32Array( new SharedArrayBuffer( FRAME_CONTROL_WORDS * Int32Array.BYTES_PER_ELEMENT ) );
	const kernels = createFrameKernelMemory( ( bytes, maxBytes, fixed ) =>
		fixed ? new SharedArrayBuffer( bytes ) : new SharedArrayBuffer( bytes, { maxByteLength: maxBytes } )
	);
	const posted = new Map( OUTPUT_TABLES.map( table => [ table, kernels[table] ] ) );
	const threads = Array.from(
		{ length: count },
		() => new Worker( WORKER, { workerData: { control: control.buffer, kernels } } )
	);
	const started = Date.now();
	while ( readyFrameWorkers( control ) < count ) {
		if ( Date.now() - started > JOIN_LIMIT_MS ) throw Error( "kernel threads did not start" );
		await new Promise( resolve => setTimeout( resolve, 5 ) );
	}
	let generation = 0, phases = 0, open = 0, tables = 0;
	const workers = {
		memory: () => kernels,
		run( kernel, chunks, local ) {
			workers.fork( kernel, chunks );
			workers.join( local );
		},
		fork( kernel, chunks ) {
			if ( open ) throw Error( "a frame phase is already open" );
			const buffers = {};
			for ( const table of OUTPUT_TABLES ) {
				if ( posted.get( table ) === kernels[table] ) continue;
				posted.set( table, kernels[table] );
				buffers[table] = kernels[table];
			}
			if ( Object.keys( buffers ).length ) {
				for ( const thread of threads ) thread.postMessage( { kind: "tables", tables: tables + 1, buffers } );
				tables = replaceFrameTables( control );
			}
			generation = nextFrameGeneration( generation );
			phases++;
			publishFramePhase( control, generation, kernel, chunks );
			open = generation;
		},
		join( local ) {
			if ( !open ) throw Error( "no frame phase is open" );
			const phase = open;
			open = 0;
			serveFramePhase( control, local );
			const joining = Date.now();
			while ( !framePhaseComplete( control, phase ) ) {
				if ( Date.now() - joining > JOIN_LIMIT_MS ) throw Error( "frame phase did not complete" );
			}
			if ( framePhaseFailed( control, phase ) ) throw Error( "a frame chunk failed" );
		},
		phases: () => phases,
		// Output table replacements the threads were sent.
		replacements: () => tables,
		async close() {
			stopFrameJobs( control );
			await Promise.all( threads.map( thread => thread.terminate() ) );
		}
	};
	return workers;
}

/*
================
createInlineWorkers
================
*/
export function createInlineWorkers( repeat = 1, shared = false ) {
	const kernels = createFrameKernelMemory(
		shared ? ( bytes, maxBytes ) => new SharedArrayBuffer( bytes, { maxByteLength: maxBytes } ) : plainBuffer
	);
	let phases = 0, open = null;
	const workers = {
		memory: () => kernels,
		run( kernel, chunks, local ) {
			workers.fork( kernel, chunks );
			workers.join( local );
		},
		fork( kernel, chunks ) {
			if ( open ) throw Error( "a frame phase is already open" );
			phases++;
			open = { kernel, chunks };
		},
		join( local ) {
			if ( !open ) throw Error( "no frame phase is open" );
			const { kernel, chunks } = open;
			open = null;
			for ( let chunk = 0; chunk < chunks; chunk++ ) {
				for ( let time = 0; time < repeat; time++ ) local( kernel, chunk );
			}
		},
		phases: () => phases
	};
	return workers;
}
