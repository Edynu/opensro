/*
===========================================================================

frame-kernels.ts - the frame kernels a frame phase can run, and their memory

Every thread that runs frame chunks (the main thread inline, each frame
worker) keeps its own fixed-length views over the same kernel memory
(frameKernelViews) and runs chunks through runFrameKernel, which first
remakes any view whose table grew. With frame workers the tables are
growable shared buffers that grow in place, so a worker never needs a new
message when a table grows between phases.

KERNEL_POSE: each requested character's next two pose() calls (the
movement presentation, pose-kernel.ts), speculatively: the record before
them and after the first are kept as snapshots, so the record's owner
(pose-presentation.ts) can hand out a call whose arguments match and roll
back to the right state when one does not.

===========================================================================
*/
import { POSE_SCRATCH, presentPose } from "./pose-kernel";
import { O_POSE, POSE_RECORD } from "./pose-record";

// Kernel ids, as published in a phase.
export const KERNEL_POSE = 1;
// Characters per KERNEL_POSE chunk.
export const POSE_CHUNK = 8;
// Snapshots per character record: before the first call, after it.
export const POSE_SNAPSHOTS = 2;
// Request list: its length, then one slot per requested character.
export const REQUEST_COUNT = 0;
export const REQUEST_SLOTS = 1;
// Characters the pose records hold before growing, and at most. A town
// of 200 players with their pets and the monsters around stays far below.
export const INITIAL_POSE_SLOTS = 256;
export const MAX_POSE_SLOTS = 8192;
// Walk arena doubles before growing, and at most: a chain is at most 256
// points (walking-history.ts), and the arena holds a character's input and
// track chains.
export const INITIAL_ARENA_WORDS = 65536;
export const MAX_ARENA_WORDS = 16777216;

/*
================
FrameKernelMemory

The tables every frame kernel thread shares: poseRecords holds
POSE_RECORD doubles a character, poseSnapshots POSE_SNAPSHOTS records a
character, walkArena the certified chains and poseRequests the characters
of the open pose phase. With frame workers they are growable shared
buffers that grow in place; on one thread they are ordinary buffers that
growTable replaces with larger copies.
================
*/
export interface FrameKernelMemory {
	poseRecords: ArrayBufferLike;
	poseSnapshots: ArrayBufferLike;
	walkArena: ArrayBufferLike;
	poseRequests: ArrayBufferLike;
}

/*
================
KernelTable
================
*/
export type KernelTable = keyof FrameKernelMemory;

/*
================
KernelBufferAllocator

Makes one table's buffer: initial bytes, and the most it may grow to.
================
*/
export type KernelBufferAllocator = ( bytes: number, maxBytes: number ) => ArrayBufferLike;

/*
================
createFrameKernelMemory
================
*/
export function createFrameKernelMemory( allocate: KernelBufferAllocator ): FrameKernelMemory {
	const record = POSE_RECORD * Float64Array.BYTES_PER_ELEMENT;
	return {
		poseRecords: allocate( INITIAL_POSE_SLOTS * record, MAX_POSE_SLOTS * record ),
		poseSnapshots: allocate(
			INITIAL_POSE_SLOTS * POSE_SNAPSHOTS * record,
			MAX_POSE_SLOTS * POSE_SNAPSHOTS * record
		),
		walkArena: allocate(
			INITIAL_ARENA_WORDS * Float64Array.BYTES_PER_ELEMENT,
			MAX_ARENA_WORDS * Float64Array.BYTES_PER_ELEMENT
		),
		poseRequests: allocate(
			(REQUEST_SLOTS + MAX_POSE_SLOTS) * Int32Array.BYTES_PER_ELEMENT,
			(REQUEST_SLOTS + MAX_POSE_SLOTS) * Int32Array.BYTES_PER_ELEMENT
		)
	};
}

/*
================
plainBuffer

A KernelBufferAllocator for one thread: an ordinary buffer, replaced by a
larger copy when its table grows.
================
*/
export function plainBuffer( bytes: number ): ArrayBufferLike {
	return new ArrayBuffer( bytes );
}

/*
================
growTable

Grow one kernel table to at least bytes. A growable shared buffer grows in
place, and every thread's views take the new length at their next
refreshViews; an ordinary buffer, used by one thread only, is replaced by
a larger copy. Throws past a shared buffer's maximum.
================
*/
export function growTable( memory: FrameKernelMemory, table: KernelTable, bytes: number ) {
	const buffer = memory[table];
	if ( buffer.byteLength >= bytes ) return;
	const shared = buffer as unknown as { readonly growable?: boolean; grow?( bytes: number ): void; };
	if ( shared.growable && shared.grow ) {
		shared.grow( bytes );
		return;
	}
	const larger = new ArrayBuffer( bytes );
	new Uint8Array( larger ).set( new Uint8Array( buffer ) );
	memory[table] = larger;
}

/*
================
FrameKernelViews

One thread's views over the kernel tables, and its own scratch.
================
*/
export interface FrameKernelViews {
	readonly memory: FrameKernelMemory;
	poseRecords: Float64Array;
	poseSnapshots: Float64Array;
	walkArena: Float64Array;
	poseRequests: Int32Array;
	readonly scratch: Float64Array;
}

/*
================
frameKernelViews

One thread's views, made once and refreshed as the tables grow.
================
*/
export function frameKernelViews( memory: FrameKernelMemory ): FrameKernelViews {
	const views: FrameKernelViews = {
		memory,
		poseRecords: new Float64Array( 0 ),
		poseSnapshots: new Float64Array( 0 ),
		walkArena: new Float64Array( 0 ),
		poseRequests: new Int32Array( 0 ),
		scratch: new Float64Array( POSE_SCRATCH )
	};
	refreshViews( views );
	return views;
}

/*
================
refreshViews

Fixed-length views over each table's current buffer and length, remade
only for a table that grew or was replaced. V8 runs a loop through a
fixed-length view of a growable shared buffer as fast as through a plain
one, and through a view that tracks its buffer's length about 33 times
slower (2026-10-22, Node 24): views never track.
================
*/
export function refreshViews( views: FrameKernelViews ) {
	const memory = views.memory;
	if (
		views.poseRecords.buffer !== memory.poseRecords ||
		views.poseRecords.byteLength !== memory.poseRecords.byteLength
	) {
		views.poseRecords = new Float64Array(
			memory.poseRecords,
			0,
			memory.poseRecords.byteLength / Float64Array.BYTES_PER_ELEMENT
		);
	}
	if (
		views.poseSnapshots.buffer !== memory.poseSnapshots ||
		views.poseSnapshots.byteLength !== memory.poseSnapshots.byteLength
	) {
		views.poseSnapshots = new Float64Array(
			memory.poseSnapshots,
			0,
			memory.poseSnapshots.byteLength / Float64Array.BYTES_PER_ELEMENT
		);
	}
	if ( views.walkArena.buffer !== memory.walkArena || views.walkArena.byteLength !== memory.walkArena.byteLength ) {
		views.walkArena = new Float64Array(
			memory.walkArena,
			0,
			memory.walkArena.byteLength / Float64Array.BYTES_PER_ELEMENT
		);
	}
	if (
		views.poseRequests.buffer !== memory.poseRequests ||
		views.poseRequests.byteLength !== memory.poseRequests.byteLength
	) {
		views.poseRequests = new Int32Array(
			memory.poseRequests,
			0,
			memory.poseRequests.byteLength / Int32Array.BYTES_PER_ELEMENT
		);
	}
}

/*
================
copyRecord
================
*/
function copyRecord( to: Float64Array, toAt: number, from: Float64Array, fromAt: number ) {
	for ( let i = 0; i < POSE_RECORD; i++ ) to[toAt + i] = from[fromAt + i]!;
}

/*
================
snapshotRecord

Owner only, before the phase opens: the character's record as snapshot 0,
the state its predicted calls start from.
================
*/
export function snapshotRecord( views: FrameKernelViews, slot: number ) {
	copyRecord( views.poseSnapshots, slot * POSE_SNAPSHOTS * POSE_RECORD, views.poseRecords, slot * POSE_RECORD );
}

/*
================
restoreRecord

Owner only: the character's record back to a snapshot.
================
*/
export function restoreRecord( views: FrameKernelViews, slot: number, snapshot: number ) {
	copyRecord(
		views.poseRecords,
		slot * POSE_RECORD,
		views.poseSnapshots,
		(slot * POSE_SNAPSHOTS + snapshot) * POSE_RECORD
	);
}

/*
================
presentPredicted

One character's two predicted calls from snapshot 0: the first call's
record (its drawn pose in O_POSE) becomes snapshot 1, the second call's is
written to the table. Restartable: it reads only snapshot 0, so a chunk a
failed worker left half done computes the same when run again.
================
*/
export function presentPredicted( views: FrameKernelViews, slot: number ) {
	const record = slot * POSE_RECORD, snapshots = slot * POSE_SNAPSHOTS * POSE_RECORD;
	const { poseRecords, poseSnapshots, walkArena, scratch } = views;
	copyRecord( scratch, 0, poseSnapshots, snapshots );
	presentPose( scratch, walkArena );
	copyRecord( poseSnapshots, snapshots + POSE_RECORD, scratch, 0 );
	presentPose( scratch, walkArena );
	copyRecord( poseRecords, record, scratch, 0 );
}

/*
================
predictedPoseAt

Where a snapshot's drawn pose sits, for its owner: snapshot 1 holds the
first predicted call's.
================
*/
export function predictedPoseAt( slot: number, snapshot: number ): number {
	return (slot * POSE_SNAPSHOTS + snapshot) * POSE_RECORD + O_POSE;
}

/*
================
runFrameKernel

One chunk of one kernel, on any thread.
================
*/
export function runFrameKernel( views: FrameKernelViews, kernel: number, chunk: number ) {
	if ( kernel !== KERNEL_POSE ) throw Error( `Unknown frame kernel ${kernel}` );
	refreshViews( views );
	const requests = views.poseRequests, count = requests[REQUEST_COUNT]!;
	const end = Math.min( count, (chunk + 1) * POSE_CHUNK );
	for ( let i = chunk * POSE_CHUNK; i < end; i++ ) presentPredicted( views, requests[REQUEST_SLOTS + i]! );
}
