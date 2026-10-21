/*
===========================================================================

frame-job-worker.mjs - a Node worker thread serving frame jobs in tests

Runs the shipping serveFrameJobs (foundation/workers/frame-jobs.ts) over the
control block the test shares, with a runner that records each chunk it
runs: runs[chunk] counts the runs, kernels[chunk] keeps the kernel seen.
With stallChunk set, the runner records that chunk's kernel and never
returns from it, as a stuck or dead worker would not.

===========================================================================
*/
import "./native-source-loader.mjs";
import { workerData } from "node:worker_threads";

const { serveFrameJobs } = await import( "../../src/engine/foundation/workers/frame-jobs.ts" );
const control = new Int32Array( workerData.control ),
	runs = new Int32Array( workerData.runs ),
	kernels = new Int32Array( workerData.kernels ),
	stall = new Int32Array( new SharedArrayBuffer( Int32Array.BYTES_PER_ELEMENT ) );
serveFrameJobs( control, ( kernel, chunk ) => {
	Atomics.store( kernels, chunk, kernel );
	if ( chunk === workerData.stallChunk ) Atomics.wait( stall, 0, 0 );
	Atomics.add( runs, chunk, 1 );
} );
