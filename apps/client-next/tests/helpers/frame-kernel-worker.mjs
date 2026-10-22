/*
===========================================================================

frame-kernel-worker.mjs - a Node worker thread running the shipping frame kernels

The test-side twin of runtime/frame-workers/worker/entry.ts: one start
(the control block and the kernel tables, as workerData), views made once,
then the shipping serveFrameJobs and runFrameKernel until stopped; when
the owner replaces output tables, they are taken from the messages before
serving again.

===========================================================================
*/
import "./native-source-loader.mjs";
import { parentPort, workerData } from "node:worker_threads";

const { frameTables, serveFrameJobs } = await import( "../../src/engine/foundation/workers/frame-jobs.ts" );
const { frameKernelViews, runFrameKernel } = await import( "../../src/engine/foundation/kernels/frame-kernels.ts" );
const control = new Int32Array( workerData.control ), views = frameKernelViews( workerData.kernels );
const port = /** @type {import("node:worker_threads").MessagePort} */ (parentPort);
let held = 0, waiting = null;
port.on( "message", message => {
	Object.assign( workerData.kernels, message.buffers );
	held = message.tables;
	waiting?.();
} );
while ( serveFrameJobs( control, ( kernel, chunk ) => runFrameKernel( views, kernel, chunk ), held ) === "tables" ) {
	while ( held !== frameTables( control ) ) await new Promise( resolve => waiting = resolve );
	waiting = null;
}
port.removeAllListeners( "message" );
