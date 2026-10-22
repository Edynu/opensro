/*
===========================================================================

entry.ts - a frame worker: serve frame phases over shared memory

Started by frame-workers.ts with one message carrying the control block
and the kernel tables (frame-kernels.ts), then never messaged again: it blocks between phases on the control block
(frame-jobs.ts serveFrameJobs) until stopped and terminated. It allocates
nothing per phase, so its garbage collector has nothing to do.

===========================================================================
*/
import type { FrameWorkerStart } from "@/engine/contracts/frame-workers";
import { serveFrameJobs } from "@/engine/foundation/workers/frame-jobs";
import { frameKernelViews, runFrameKernel } from "@/engine/foundation/kernels/frame-kernels";

const port = globalThis as unknown as {
	onmessage: (( event: MessageEvent<FrameWorkerStart> ) => void) | null;
};

port.onmessage = event => {
	port.onmessage = null;
	// This thread's views over the kernel tables, made once: they follow the
	// tables as the owner grows them.
	const views = frameKernelViews( event.data.kernels );
	// Returns only when stopped; the owner terminates the worker then.
	serveFrameJobs( new Int32Array( event.data.control ), ( kernel, chunk ) => runFrameKernel( views, kernel, chunk ) );
};
