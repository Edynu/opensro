/*
===========================================================================

shared-frame.ts - the two counters a thread and its worker take turns on

The character worker and its host (docs/CLIENT_WORKERS_PLAN.md 5.11)
exchange frames through shared blocks, ordered by two counters in one
shared Int32Array: the host writes a frame into its blocks, then stores the
frame's number in FRAME and notifies; the worker reads it, answers into
its own blocks, then stores the same number in OUTPUT. Each side writes
its blocks only while the other is not reading them, so neither locks.

===========================================================================
*/

// The frame the host posted last.
export const FRAME = 0;
// The frame the worker answered last.
export const OUTPUT = 1;
export const FRAME_WORDS = 2;

// The character worker's renderer commands, as their first word in the
// outbox (contracts/character-worker.ts CharacterWorkerOutput).
export const COMMAND_ACTORS = 0;
export const COMMAND_ASSEMBLY = 1;
export const COMMAND_DEFINED_ASSEMBLY = 2;
export const COMMAND_LOAD = 3;
export const COMMAND_RETAIN = 4;
export const COMMAND_FOOTPRINTS = 5;

/*
================
createFrameControl
================
*/
export function createFrameControl(): SharedArrayBuffer {
	return new SharedArrayBuffer( FRAME_WORDS * Int32Array.BYTES_PER_ELEMENT );
}

/*
================
postFrame

The host's turn ends: frame is written.
================
*/
export function postFrame( control: Int32Array, frame: number ) {
	Atomics.store( control, FRAME, frame );
	Atomics.notify( control, FRAME );
}

/*
================
answered

Whether the worker has answered frame.
================
*/
export function answered( control: Int32Array, frame: number ): boolean {
	return Atomics.load( control, OUTPUT ) === frame;
}

/*
================
postOutput

The worker's turn ends: frame is answered.
================
*/
export function postOutput( control: Int32Array, frame: number ) {
	Atomics.store( control, OUTPUT, frame );
}

/*
================
nextFrame

The worker's wait for a frame after seen, without blocking its message
loop (Atomics.waitAsync), so loads and world batches still arrive.
================
*/
export async function nextFrame( control: Int32Array, seen: number ): Promise<number> {
	for ( ;; ) {
		const frame = Atomics.load( control, FRAME );
		if ( frame !== seen ) return frame;
		const wait = Atomics.waitAsync( control, FRAME, seen );
		if ( wait.async ) await wait.value;
	}
}
