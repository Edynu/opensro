/*
===========================================================================

frame-jobs.test.mjs - one frame phase on the main thread and worker threads

Drives foundation/workers/frame-jobs.ts as the frame workers' owner does:
inline with no workers, then with real worker threads sharing the control
block (tests/helpers/frame-job-worker.mjs runs the shipping serveFrameJobs).
Every chunk of every phase must run exactly once, with its phase's kernel,
however the threads race; a failed chunk must not hang the join; a stalled
worker's chunk must be finishable by the owner; a worker whose tables the
owner replaced must claim nothing until it holds the new ones.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";

const {
	FRAME_CONTROL_WORDS,
	MAX_FRAME_CHUNKS,
	finishFramePhase,
	framePhaseComplete,
	framePhaseFailed,
	frameTables,
	frameWorkerCount,
	frameWorkerLimit,
	nextFrameGeneration,
	publishFramePhase,
	readyFrameWorkers,
	replaceFrameTables,
	serveFramePhase,
	serveFrameJobs,
	stopFrameJobs
} = await import( "../../src/engine/foundation/workers/frame-jobs.ts" );

const WORKER = new URL( "../helpers/frame-job-worker.mjs", import.meta.url );
const PHASES = 400;
const JOIN_LIMIT_MS = 5000;

/*
================
sharedInts
================
*/
function sharedInts( length ) {
	return new Int32Array( new SharedArrayBuffer( length * Int32Array.BYTES_PER_ELEMENT ) );
}

/*
================
startWorkers

Worker threads serving one control block; resolves once all are serving.
================
*/
async function startWorkers( count, control, runs, kernels, stallChunk = -1 ) {
	const workers = Array.from( { length: count }, () =>
		new Worker( WORKER, {
			workerData: { control: control.buffer, runs: runs.buffer, kernels: kernels.buffer, stallChunk }
		} ) );
	const started = Date.now();
	while ( readyFrameWorkers( control ) < count ) {
		if ( Date.now() - started > JOIN_LIMIT_MS ) throw Error( "frame workers did not start" );
		await new Promise( resolve => setTimeout( resolve, 5 ) );
	}
	return workers;
}

/*
================
join

The owner's join: serve beside the workers, then wait for the last chunk.
================
*/
function join( control, generation, run ) {
	serveFramePhase( control, run );
	const started = Date.now();
	while ( !framePhaseComplete( control, generation ) ) {
		if ( Date.now() - started > JOIN_LIMIT_MS ) throw Error( "frame phase did not complete" );
	}
}

test("auto leaves three threads to the page and a picked count is the player's, up to the machine", () => {
	assert.equal( frameWorkerCount( 24, "off" ), 0 );
	assert.deepEqual( [ 1, 2, 4, 6, 8, 12, 16, 24 ].map( threads => frameWorkerCount( threads, "auto" ) ), [
		0,
		0,
		1,
		3,
		5,
		8,
		8,
		8
	] );
	assert.equal( frameWorkerCount( Number.NaN, "auto" ), 0 );
	assert.deepEqual( [ 1, 2, 4, 24, 66, Number.NaN ].map( frameWorkerLimit ), [ 1, 1, 3, 23, 64, 1 ] );
	assert.equal( frameWorkerCount( 24, 16 ), 16, "past Auto's eight" );
	assert.equal( frameWorkerCount( 24, 23 ), 23 );
	assert.equal( frameWorkerCount( 4, 8 ), 3, "a count saved on a larger machine starts what this one allows" );
	assert.equal( frameWorkerCount( 64, 2 ), 2 );
});

test("consecutive generations alternate slots, across the wrap too", () => {
	let generation = 0;
	for ( let i = 0; i < 70000; i++ ) {
		const next = nextFrameGeneration( generation );
		assert.ok( next >= 1 && next < 0x8000, `generation ${next}` );
		if ( generation ) assert.notEqual( next & 1, generation & 1, `after ${generation}` );
		generation = next;
	}
});

test("with no workers the owner runs every chunk once, in order", () => {
	const control = new Int32Array( FRAME_CONTROL_WORDS ), seen = [];
	let generation = 0;
	for ( const chunks of [ 0, 1, 7, MAX_FRAME_CHUNKS ] ) {
		generation = nextFrameGeneration( generation );
		seen.length = 0;
		publishFramePhase( control, generation, 5, chunks );
		serveFramePhase( control, ( kernel, chunk ) => seen.push( [ kernel, chunk ] ) );
		assert.ok( framePhaseComplete( control, generation ) );
		assert.deepEqual( seen, Array.from( { length: chunks }, ( _, chunk ) => [ 5, chunk ] ) );
	}
	assert.throws( () => publishFramePhase( control, nextFrameGeneration( generation ), 5, MAX_FRAME_CHUNKS + 1 ) );
});

test("workers and the owner run every chunk of every phase exactly once", async () => {
	const control = sharedInts( FRAME_CONTROL_WORDS ),
		runs = sharedInts( MAX_FRAME_CHUNKS ),
		kernels = sharedInts( MAX_FRAME_CHUNKS );
	const workers = await startWorkers( 4, control, runs, kernels );
	try {
		let generation = 0;
		for ( let phase = 0; phase < PHASES; phase++ ) {
			const chunks = 1 + (phase * 37) % 96, kernel = phase % 3;
			runs.fill( 0 );
			kernels.fill( -1 );
			generation = nextFrameGeneration( generation );
			publishFramePhase( control, generation, kernel, chunks );
			join( control, generation, ( k, chunk ) => {
				Atomics.store( kernels, chunk, k );
				Atomics.add( runs, chunk, 1 );
			} );
			assert.ok( !framePhaseFailed( control, generation ) );
			for ( let chunk = 0; chunk < chunks; chunk++ ) {
				assert.equal( Atomics.load( runs, chunk ), 1, `phase ${phase} chunk ${chunk}` );
				assert.equal( Atomics.load( kernels, chunk ), kernel, `phase ${phase} chunk ${chunk}` );
			}
			assert.equal( Atomics.load( runs, chunks ), 0, `phase ${phase} ran past its chunks` );
		}
		stopFrameJobs( control );
		const started = Date.now();
		while ( readyFrameWorkers( control ) > 0 ) {
			if ( Date.now() - started > JOIN_LIMIT_MS ) throw Error( "stopped workers did not return" );
			await new Promise( resolve => setTimeout( resolve, 5 ) );
		}
	} finally {
		await Promise.all( workers.map( worker => worker.terminate() ) );
	}
});

test("a chunk that throws fails its phase without hanging the join", () => {
	const control = new Int32Array( FRAME_CONTROL_WORDS );
	const generation = nextFrameGeneration( 0 ), ran = [];
	publishFramePhase( control, generation, 1, 4 );
	serveFramePhase( control, ( _, chunk ) => {
		ran.push( chunk );
		if ( chunk === 1 ) throw Error( "kernel failure" );
	} );
	assert.deepEqual( ran, [ 0, 1, 2, 3 ] );
	assert.ok( framePhaseComplete( control, generation ) );
	assert.ok( framePhaseFailed( control, generation ) );
	const next = nextFrameGeneration( generation );
	publishFramePhase( control, next, 1, 2 );
	serveFramePhase( control, () => {} );
	assert.ok( !framePhaseFailed( control, next ), "a failure belongs to its own phase" );
});

test("the owner finishes the chunk a stalled worker holds", async () => {
	const control = sharedInts( FRAME_CONTROL_WORDS ),
		runs = sharedInts( MAX_FRAME_CHUNKS ),
		kernels = sharedInts( MAX_FRAME_CHUNKS );
	const workers = await startWorkers( 1, control, runs, kernels, 0 );
	try {
		const generation = nextFrameGeneration( 0 ), chunks = 6;
		publishFramePhase( control, generation, 2, chunks );
		// Let the worker claim chunk 0 and stall in it before the owner serves.
		kernels.fill( -1 );
		const started = Date.now();
		while ( Atomics.load( kernels, 0 ) !== 2 ) {
			if ( Date.now() - started > JOIN_LIMIT_MS ) throw Error( "worker did not claim" );
		}
		const owner = [];
		serveFramePhase( control, ( _, chunk ) => {
			owner.push( chunk );
			Atomics.add( runs, chunk, 1 );
		} );
		assert.ok( !framePhaseComplete( control, generation ), "the stalled chunk holds the phase open" );
		stopFrameJobs( control );
		finishFramePhase( control, generation, ( _, chunk ) => {
			owner.push( chunk );
			Atomics.add( runs, chunk, 1 );
		} );
		assert.ok( framePhaseComplete( control, generation ) );
		assert.deepEqual( owner, [ 1, 2, 3, 4, 5, 0 ] );
		for ( let chunk = 0; chunk < chunks; chunk++ ) assert.equal( Atomics.load( runs, chunk ), 1 );
		// The closed phase hands out nothing more.
		serveFramePhase( control, () => assert.fail( "claimed from a finished phase" ) );
	} finally {
		await Promise.all( workers.map( worker => worker.terminate() ) );
	}
});

test("a thread holding replaced tables claims nothing; one holding the new tables serves", () => {
	const control = new Int32Array( FRAME_CONTROL_WORDS ), ran = [];
	const run = ( _, chunk ) => ran.push( chunk );
	assert.equal( replaceFrameTables( control ), 1 );
	assert.equal( frameTables( control ), 1 );
	const generation = nextFrameGeneration( 0 );
	publishFramePhase( control, generation, 3, 4 );
	serveFramePhase( control, run, 0 );
	assert.deepEqual( ran, [], "stale tables" );
	serveFramePhase( control, run, 1 );
	assert.deepEqual( ran, [ 0, 1, 2, 3 ] );
	assert.ok( framePhaseComplete( control, generation ) );
	// The owner holds its own tables whatever the count.
	const next = nextFrameGeneration( generation );
	replaceFrameTables( control );
	publishFramePhase( control, next, 3, 2 );
	serveFramePhase( control, run );
	assert.deepEqual( ran.slice( 4 ), [ 0, 1 ] );
});

test("a worker leaves to take replaced tables, or when stopped, and counts itself out", () => {
	const control = new Int32Array( new SharedArrayBuffer( FRAME_CONTROL_WORDS * Int32Array.BYTES_PER_ELEMENT ) );
	replaceFrameTables( control );
	assert.equal( serveFrameJobs( control, () => assert.fail( "served with stale tables" ), 0 ), "tables" );
	assert.equal( readyFrameWorkers( control ), 0 );
	stopFrameJobs( control );
	assert.equal( serveFrameJobs( control, () => {}, 1 ), "stopped" );
	assert.equal( readyFrameWorkers( control ), 0 );
});
