/*
===========================================================================

entry.ts - a frame worker: serve frame phases over shared memory

Started by frame-workers.ts with one message carrying the control block,
then never messaged again: it blocks between phases on the control block
(frame-jobs.ts serveFrameJobs) until stopped and terminated. It allocates
nothing per phase, so its garbage collector has nothing to do.

===========================================================================
*/
import type { FrameWorkerStart } from "@/engine/contracts/frame-workers";
import { serveFrameJobs, type FrameJobRunner } from "@/engine/foundation/workers/frame-jobs";

const port = globalThis as unknown as {
	onmessage: (( event: MessageEvent<FrameWorkerStart> ) => void) | null;
};

/*
================
runFrameKernel

No frame kernel is registered yet; the owner opens no phase until one is.
================
*/
const runFrameKernel: FrameJobRunner = kernel => {
	throw Error( `Unknown frame kernel ${kernel}` );
};

port.onmessage = event => {
	port.onmessage = null;
	// Returns only when stopped; the owner terminates the worker then.
	serveFrameJobs( new Int32Array( event.data.control ), runFrameKernel );
};
