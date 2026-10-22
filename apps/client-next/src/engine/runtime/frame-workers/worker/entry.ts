/*
===========================================================================

entry.ts - a frame worker: serve frame phases over shared memory

Started by frame-workers.ts with one message carrying the control block
and the kernel tables (frame-kernels.ts). It blocks between phases on the
control block (frame-jobs.ts serveFrameJobs) until stopped and
terminated, and allocates nothing per phase, so its garbage collector has
nothing to do. When the owner replaces an output table it posts the new
one and bumps the control block's table count: serveFrameJobs returns,
the worker takes the tables from its messages, then serves again.

===========================================================================
*/
import type { FrameWorkerStart, FrameWorkerTables } from "@/engine/contracts/frame-workers";
import { frameTables, serveFrameJobs } from "@/engine/foundation/workers/frame-jobs";
import { frameKernelViews, runFrameKernel } from "@/engine/foundation/kernels/frame-kernels";

const port = globalThis as unknown as {
	onmessage: (( event: MessageEvent<FrameWorkerStart | FrameWorkerTables> ) => void) | null;
};

/*
================
serve

Phases until stopped; between table replacements, the replaced tables
from their messages (runFrameKernel remakes a view whose table changed).
================
*/
async function serve( start: FrameWorkerStart ) {
	const control = new Int32Array( start.control );
	// This thread's views over the kernel tables, made once: they follow the
	// tables as the owner grows or replaces them.
	const views = frameKernelViews( start.kernels );
	const run = ( kernel: number, chunk: number ) => runFrameKernel( views, kernel, chunk );
	// The table count whose tables this worker holds, and its wait for newer.
	let held = 0, waiting: (() => void) | null = null;
	port.onmessage = event => {
		const message = event.data as FrameWorkerTables;
		Object.assign( start.kernels, message.buffers );
		held = message.tables;
		waiting?.();
	};
	while ( serveFrameJobs( control, run, held ) === "tables" ) {
		while ( held !== frameTables( control ) ) await new Promise<void>( resolve => waiting = resolve );
		waiting = null;
	}
}

port.onmessage = event => {
	port.onmessage = null;
	void serve( event.data as FrameWorkerStart );
};
