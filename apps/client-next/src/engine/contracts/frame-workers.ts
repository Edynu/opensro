/*
===========================================================================

frame-workers.ts - what a frame worker is given, and what its owner reports

The main thread starts each frame worker with one message and never sends
another: everything after it is shared memory, the control block
(frame-jobs.ts) and the kernels' growable tables (frame-kernels.ts).

===========================================================================
*/

/*
================
FrameWorkerStart
================
*/
export interface FrameWorkerStart {
	readonly control: SharedArrayBuffer;
	readonly kernels: import("@/engine/foundation/kernels/frame-kernels").FrameKernelMemory;
}

/*
================
FrameKernelPhases

What a frame kernel's owner (pose-presentation.ts, cloth-wearers.ts)
needs from the frame workers: their kernel memory, and phases over it
(runtime/frame-workers/frame-workers.ts). run is fork then join. fork
opens a phase the workers begin at once; join runs what they have not
claimed on the calling thread and returns when every chunk has run, so
the caller can do other work between the two. One phase is open at a
time. local runs one chunk on the calling thread and must be the kernel
the workers run.
================
*/
export interface FrameKernelPhases {
	memory(): import("@/engine/foundation/kernels/frame-kernels").FrameKernelMemory;
	run( kernel: number, chunks: number, local: import("@/engine/foundation/workers/frame-jobs").FrameJobRunner ): void;
	fork( kernel: number, chunks: number ): void;
	join( local: import("@/engine/foundation/workers/frame-jobs").FrameJobRunner ): void;
}

/*
================
FrameWorkerStatistics

The frame workers' state for diagnostics: how many were started and are
serving, whether the page is cross-origin isolated (no shared memory, so no
workers, without it), the phases run and the time the main thread waited
for workers at their joins, and why the workers were retired, if they were.
================
*/
export interface FrameWorkerStatistics {
	readonly isolated: boolean;
	readonly started: number;
	readonly ready: number;
	readonly phases: number;
	readonly joinWaitMs: number;
	readonly retired: string | null;
}
