/*
===========================================================================

frame-kernel-worker.mjs - a Node worker thread running the shipping frame kernels

The test-side twin of runtime/frame-workers/worker/entry.ts: one start
(the control block and the kernel tables, as workerData), views made once,
then the shipping serveFrameJobs and runFrameKernel until stopped.

===========================================================================
*/
import "./native-source-loader.mjs";
import { workerData } from "node:worker_threads";

const { serveFrameJobs } = await import( "../../src/engine/foundation/workers/frame-jobs.ts" );
const { frameKernelViews, runFrameKernel } = await import( "../../src/engine/foundation/kernels/frame-kernels.ts" );
const views = frameKernelViews( workerData.kernels );
serveFrameJobs( new Int32Array( workerData.control ), ( kernel, chunk ) => runFrameKernel( views, kernel, chunk ) );
