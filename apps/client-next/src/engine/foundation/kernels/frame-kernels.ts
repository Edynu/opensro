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

KERNEL_CLOTH: each requested cloth wearer's frame (cloth-kernel.ts) into
its packed vertices, for its owner (renderer/characters/cloth-wearers.ts)
to upload.

KERNEL_SKELETON: each requested character pose's matrices
(skeleton-kernel.ts), for its owner (renderer/characters/skeletons.ts).

===========================================================================
*/
import { advanceClothWearer } from "./cloth-kernel";
import { CLOTH_RECORD } from "./cloth-record";
import { materializeSkeleton } from "./skeleton-kernel";
import { SKELETON_RECORD } from "./skeleton-record";
import { POSE_SCRATCH, presentPose } from "./pose-kernel";
import { O_POSE, POSE_RECORD } from "./pose-record";

// Kernel ids, as published in a phase.
export const KERNEL_POSE = 1;
export const KERNEL_CLOTH = 2;
export const KERNEL_SKELETON = 3;
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
// Cloth wearers per KERNEL_CLOTH chunk, and the wearers the records hold
// before growing and at most (one phase: MAX_FRAME_CHUNKS chunks of two).
// 214 players wore 120 cloth primitives.
export const CLOTH_CHUNK = 2;
export const INITIAL_CLOTH_WEARERS = 128;
export const MAX_CLOTH_WEARERS = 2048;
// Cloth programs (doubles) and wearer state (floats) before growing, and at
// most: a program takes about 16 doubles a vertex, a wearer 29 floats.
export const INITIAL_CLOTH_PROGRAM_WORDS = 262144;
export const MAX_CLOTH_PROGRAM_WORDS = 8388608;
export const INITIAL_CLOTH_STATE_FLOATS = 1048576;
export const MAX_CLOTH_STATE_FLOATS = 33554432;
// Poses per KERNEL_SKELETON chunk; poses the records hold before growing
// and at most, and per phase (MAX_FRAME_CHUNKS chunks of two). The world
// draws at most 512 actors (character-budget.ts CHARACTER_ACTORS).
export const SKELETON_CHUNK = 2;
export const INITIAL_SKELETONS = 256;
export const MAX_SKELETONS = 8192;
export const MAX_SKELETON_REQUESTS = 2048;
// Skeleton tables before growing, and at most (skeleton-record.ts).
export const INITIAL_SKELETON_MODEL_WORDS = 65536;
export const MAX_SKELETON_MODEL_WORDS = 4194304;
export const INITIAL_SKELETON_CLIP_WORDS = 65536;
export const MAX_SKELETON_CLIP_WORDS = 2097152;
export const INITIAL_SKELETON_KEY_FLOATS = 1048576;
export const MAX_SKELETON_KEY_FLOATS = 33554432;
export const INITIAL_SKELETON_SCRATCH_WORDS = 131072;
export const MAX_SKELETON_SCRATCH_WORDS = 4194304;
export const INITIAL_SKELETON_STATE_FLOATS = 2097152;
export const MAX_SKELETON_STATE_FLOATS = 33554432;

/*
================
FrameKernelMemory

The tables every frame kernel thread shares: poseRecords holds
POSE_RECORD doubles a character, poseSnapshots POSE_SNAPSHOTS records a
character, walkArena the certified chains and poseRequests the characters
of the open pose phase; clothRecords, clothPrograms and clothState the
cloth wearers (cloth-record.ts) and clothRequests the wearers of the open
cloth phase; the skeleton* tables the character poses (skeleton-record.ts)
and skeletonRequests the poses of the open skeleton phase. With frame workers they are growable shared buffers that
grow in place; on one thread they are ordinary buffers that growTable
replaces with larger copies.
================
*/
export interface FrameKernelMemory {
	poseRecords: ArrayBufferLike;
	poseSnapshots: ArrayBufferLike;
	walkArena: ArrayBufferLike;
	poseRequests: ArrayBufferLike;
	clothRecords: ArrayBufferLike;
	clothPrograms: ArrayBufferLike;
	clothState: ArrayBufferLike;
	clothRequests: ArrayBufferLike;
	skeletonModels: ArrayBufferLike;
	skeletonClips: ArrayBufferLike;
	skeletonKeys: ArrayBufferLike;
	skeletonRecords: ArrayBufferLike;
	skeletonScratch: ArrayBufferLike;
	skeletonState: ArrayBufferLike;
	skeletonRequests: ArrayBufferLike;
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
		),
		clothRecords: allocate(
			INITIAL_CLOTH_WEARERS * CLOTH_RECORD * Float64Array.BYTES_PER_ELEMENT,
			MAX_CLOTH_WEARERS * CLOTH_RECORD * Float64Array.BYTES_PER_ELEMENT
		),
		clothPrograms: allocate(
			INITIAL_CLOTH_PROGRAM_WORDS * Float64Array.BYTES_PER_ELEMENT,
			MAX_CLOTH_PROGRAM_WORDS * Float64Array.BYTES_PER_ELEMENT
		),
		clothState: allocate(
			INITIAL_CLOTH_STATE_FLOATS * Float32Array.BYTES_PER_ELEMENT,
			MAX_CLOTH_STATE_FLOATS * Float32Array.BYTES_PER_ELEMENT
		),
		clothRequests: allocate(
			(REQUEST_SLOTS + MAX_CLOTH_WEARERS) * Int32Array.BYTES_PER_ELEMENT,
			(REQUEST_SLOTS + MAX_CLOTH_WEARERS) * Int32Array.BYTES_PER_ELEMENT
		),
		skeletonModels: allocate( INITIAL_SKELETON_MODEL_WORDS * 8, MAX_SKELETON_MODEL_WORDS * 8 ),
		skeletonClips: allocate( INITIAL_SKELETON_CLIP_WORDS * 8, MAX_SKELETON_CLIP_WORDS * 8 ),
		skeletonKeys: allocate( INITIAL_SKELETON_KEY_FLOATS * 4, MAX_SKELETON_KEY_FLOATS * 4 ),
		skeletonRecords: allocate( INITIAL_SKELETONS * SKELETON_RECORD * 8, MAX_SKELETONS * SKELETON_RECORD * 8 ),
		skeletonScratch: allocate( INITIAL_SKELETON_SCRATCH_WORDS * 8, MAX_SKELETON_SCRATCH_WORDS * 8 ),
		skeletonState: allocate( INITIAL_SKELETON_STATE_FLOATS * 4, MAX_SKELETON_STATE_FLOATS * 4 ),
		skeletonRequests: allocate(
			(REQUEST_SLOTS + MAX_SKELETON_REQUESTS) * Int32Array.BYTES_PER_ELEMENT,
			(REQUEST_SLOTS + MAX_SKELETON_REQUESTS) * Int32Array.BYTES_PER_ELEMENT
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
growsInPlace

Whether a table grows in place (a growable shared buffer): a fixed view
made over it now then stays valid however the table grows.
================
*/
export function growsInPlace( memory: FrameKernelMemory, table: KernelTable ): boolean {
	return (memory[table] as unknown as { readonly growable?: boolean; }).growable === true;
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
	clothRecords: Float64Array;
	clothPrograms: Float64Array;
	clothState: Float32Array;
	clothRequests: Int32Array;
	skeletonModels: Float64Array;
	skeletonClips: Float64Array;
	skeletonKeys: Float32Array;
	skeletonRecords: Float64Array;
	skeletonScratch: Float64Array;
	skeletonState: Float32Array;
	skeletonRequests: Int32Array;
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
		clothRecords: new Float64Array( 0 ),
		clothPrograms: new Float64Array( 0 ),
		clothState: new Float32Array( 0 ),
		clothRequests: new Int32Array( 0 ),
		skeletonModels: new Float64Array( 0 ),
		skeletonClips: new Float64Array( 0 ),
		skeletonKeys: new Float32Array( 0 ),
		skeletonRecords: new Float64Array( 0 ),
		skeletonScratch: new Float64Array( 0 ),
		skeletonState: new Float32Array( 0 ),
		skeletonRequests: new Int32Array( 0 ),
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
	views.poseRecords = float64View( views.poseRecords, memory.poseRecords );
	views.poseSnapshots = float64View( views.poseSnapshots, memory.poseSnapshots );
	views.walkArena = float64View( views.walkArena, memory.walkArena );
	views.poseRequests = int32View( views.poseRequests, memory.poseRequests );
	views.clothRecords = float64View( views.clothRecords, memory.clothRecords );
	views.clothPrograms = float64View( views.clothPrograms, memory.clothPrograms );
	views.clothState = float32View( views.clothState, memory.clothState );
	views.clothRequests = int32View( views.clothRequests, memory.clothRequests );
	views.skeletonModels = float64View( views.skeletonModels, memory.skeletonModels );
	views.skeletonClips = float64View( views.skeletonClips, memory.skeletonClips );
	views.skeletonKeys = float32View( views.skeletonKeys, memory.skeletonKeys );
	views.skeletonRecords = float64View( views.skeletonRecords, memory.skeletonRecords );
	views.skeletonScratch = float64View( views.skeletonScratch, memory.skeletonScratch );
	views.skeletonState = float32View( views.skeletonState, memory.skeletonState );
	views.skeletonRequests = int32View( views.skeletonRequests, memory.skeletonRequests );
}

/*
================
float64View

The view itself while it still spans its table's buffer, else a new
fixed-length one over the buffer's current length. float32View and
int32View likewise.
================
*/
function float64View( view: Float64Array, buffer: ArrayBufferLike ): Float64Array {
	return view.buffer === buffer && view.byteLength === buffer.byteLength ?
		view :
		new Float64Array( buffer, 0, buffer.byteLength / Float64Array.BYTES_PER_ELEMENT );
}

/*
================
float32View
================
*/
function float32View( view: Float32Array, buffer: ArrayBufferLike ): Float32Array {
	return view.buffer === buffer && view.byteLength === buffer.byteLength ?
		view :
		new Float32Array( buffer, 0, buffer.byteLength / Float32Array.BYTES_PER_ELEMENT );
}

/*
================
int32View
================
*/
function int32View( view: Int32Array, buffer: ArrayBufferLike ): Int32Array {
	return view.buffer === buffer && view.byteLength === buffer.byteLength ?
		view :
		new Int32Array( buffer, 0, buffer.byteLength / Int32Array.BYTES_PER_ELEMENT );
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
	refreshViews( views );
	if ( kernel === KERNEL_POSE ) {
		const requests = views.poseRequests, count = requests[REQUEST_COUNT]!;
		const end = Math.min( count, (chunk + 1) * POSE_CHUNK );
		for ( let i = chunk * POSE_CHUNK; i < end; i++ ) presentPredicted( views, requests[REQUEST_SLOTS + i]! );
		return;
	}
	if ( kernel === KERNEL_CLOTH ) {
		const requests = views.clothRequests, count = requests[REQUEST_COUNT]!;
		const end = Math.min( count, (chunk + 1) * CLOTH_CHUNK );
		for ( let i = chunk * CLOTH_CHUNK; i < end; i++ ) {
			advanceClothWearer(
				views.clothRecords,
				views.clothPrograms,
				views.clothState,
				requests[REQUEST_SLOTS + i]!
			);
		}
		return;
	}
	if ( kernel === KERNEL_SKELETON ) {
		const requests = views.skeletonRequests, count = requests[REQUEST_COUNT]!;
		const end = Math.min( count, (chunk + 1) * SKELETON_CHUNK );
		for ( let i = chunk * SKELETON_CHUNK; i < end; i++ ) materializeSkeleton( views, requests[REQUEST_SLOTS + i]! );
		return;
	}
	throw Error( `Unknown frame kernel ${kernel}` );
}
