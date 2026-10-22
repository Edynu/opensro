/*
===========================================================================

frame-kernel-bench.mjs - how the pose phase scales with characters and threads

Runs the shipping pose presentation (pose-presentation.ts and its frame
kernel) on Node worker threads over growable shared memory, the same
frame-jobs loop and kernel dispatch the browser's frame workers run, with
seeded walking characters (tests/helpers/walk-scenario.mjs). No server,
browser or assets: it measures the main thread's time per frame in
prepare (its main-thread setup, then the phase and its join) and in
handing the predicted calls out, for each character count and thread
count.

Usage (from apps/client-next):
  node tools/perf/bench/frame-kernel-bench.mjs [--actors 200,500,1000,2000,4000]
       [--threads 0,1,2,4,8] [--frames 300] [--warmup 60]

0 threads runs the phase on the main thread through the same code: the
single-threaded cost the workers replace. Node's worker threads and V8 are
the browser's; absolute numbers depend on the machine, the ratios less so.

===========================================================================
*/
import "../../../tests/helpers/native-source-loader.mjs";
import { parseArgs } from "node:util";
import { performance } from "node:perf_hooks";
import { Worker } from "node:worker_threads";
import {
	SAMPLE_DISTANCE,
	TICK_MS,
	WALK_SPEED,
	alongWalk,
	createRandom,
	createWalk,
	shapedSample
} from "../../../tests/helpers/walk-scenario.mjs";

const { createPosePresentation } = await import( "../../../src/engine/runtime/characters/pose-presentation.ts" );
const { createFrameKernelMemory } = await import( "../../../src/engine/foundation/kernels/frame-kernels.ts" );
const {
	FRAME_CONTROL_WORDS,
	framePhaseComplete,
	nextFrameGeneration,
	publishFramePhase,
	readyFrameWorkers,
	serveFramePhase,
	stopFrameJobs
} = await import( "../../../src/engine/foundation/workers/frame-jobs.ts" );

const WORKER = new URL( "../../../tests/helpers/frame-kernel-worker.mjs", import.meta.url );
const FRAME_SECONDS = 1 / 60;

const { values } = parseArgs( {
	options: {
		actors: { type: "string", default: "200,500,1000,2000,4000" },
		threads: { type: "string", default: "0,1,2,4,8" },
		frames: { type: "string", default: "300" },
		warmup: { type: "string", default: "60" }
	}
} );
const actorCounts = values.actors.split( "," ).map( Number ), threadCounts = values.threads.split( "," ).map( Number );
const frames = Number( values.frames ), warmup = Number( values.warmup );

/*
================
createThreads

Worker threads over growable shared kernel tables; a phase publishes,
serves beside them and joins, as frame-workers.ts does.
================
*/
async function createThreads( count ) {
	const control = new Int32Array( new SharedArrayBuffer( FRAME_CONTROL_WORDS * Int32Array.BYTES_PER_ELEMENT ) );
	const kernels = createFrameKernelMemory( ( bytes, maxBytes ) =>
		new SharedArrayBuffer( bytes, { maxByteLength: maxBytes } )
	);
	const threads = Array.from(
		{ length: count },
		() => new Worker( WORKER, { workerData: { control: control.buffer, kernels } } )
	);
	while ( readyFrameWorkers( control ) < count ) await new Promise( resolve => setTimeout( resolve, 5 ) );
	let generation = 0, joinMs = 0, phaseMs = 0;
	return {
		memory: () => kernels,
		run( kernel, chunks, local ) {
			const opened = performance.now();
			generation = nextFrameGeneration( generation );
			publishFramePhase( control, generation, kernel, chunks );
			serveFramePhase( control, local );
			const waiting = performance.now();
			while ( !framePhaseComplete( control, generation ) ) {}
			joinMs += performance.now() - waiting;
			phaseMs += performance.now() - opened;
		},
		take() {
			const taken = { joinMs, phaseMs };
			joinMs = 0;
			phaseMs = 0;
			return taken;
		},
		async close() {
			stopFrameJobs( control );
			await Promise.all( threads.map( thread => thread.terminate() ) );
		}
	};
}

/*
================
measure

One character count on one thread count (0: a pool without workers, the
main thread running every chunk): ms per frame in prepare's setup (inputs
and snapshots, main thread only), in its phase, in the phase's join wait,
and in handing out two calls per character.
================
*/
async function measure( actors, threadCount ) {
	const threads = await createThreads( threadCount );
	const presentation = createPosePresentation( threads );
	presentation.origin( 0 );
	const random = createRandom( 0xbe9c + actors );
	const walks = Array.from( { length: actors }, ( _, gid ) => {
		const walk = createWalk( random, gid );
		walk.length = (walk.points.length - 1) * SAMPLE_DISTANCE;
		walk.relocation = 0;
		walk.chain = walk.points.slice( 0, 2 );
		walk.chained = gid % 3 !== 0;
		return walk;
	} );
	let now = 0, prepareMs = 0, poseMs = 0, joinMs = 0, phaseMs = 0;
	for ( let frame = 0; frame < warmup + frames; frame++ ) {
		now += FRAME_SECONDS;
		const samples = new Map(), requests = [];
		for ( let gid = 0; gid < actors; gid++ ) {
			const walk = walks[gid];
			const simulationMs = Math.floor( (now - .03) * 1000 / TICK_MS ) * TICK_MS;
			if ( simulationMs > walk.atMs ) {
				walk.walked = Math.min( walk.length, walk.walked + WALK_SPEED * (simulationMs - walk.atMs) / 1000 );
				walk.atMs = simulationMs;
				walk.at = alongWalk( walk, walk.walked );
				if ( random() < .1 ) {
					walk.chain = walk.points.slice( 0, Math.min( walk.points.length, walk.at.edge + 2 ) );
				}
				walk.target = walk.at.pose;
				if ( walk.walked >= walk.length ) walk.walked = 0;
			}
			walk.target ??= walk.points[0];
			walk.at ??= alongWalk( walk, 0 );
			samples.set( gid, shapedSample( random, walk, walk.at, simulationMs ) );
			requests.push( { gid, target: walk.target } );
		}
		presentation.samples( samples );
		const prepared = performance.now();
		presentation.prepare( requests, now );
		const posed = performance.now();
		for ( let gid = 0; gid < actors; gid++ ) {
			presentation.pose( gid, walks[gid].target, now );
			presentation.pose( gid, walks[gid].target, now );
		}
		const done = performance.now();
		const phase = threads.take();
		if ( frame >= warmup ) {
			prepareMs += posed - prepared;
			poseMs += done - posed;
			joinMs += phase.joinMs;
			phaseMs += phase.phaseMs;
		}
	}
	await threads.close();
	return {
		setup: (prepareMs - phaseMs) / frames,
		phase: phaseMs / frames,
		join: joinMs / frames,
		pose: poseMs / frames
	};
}

console.log( `frame-kernel-bench: ${frames} frames after ${warmup} warmup; ms per frame on the main thread` );
console.log( "actors".padStart( 7 ) + threadCounts.map( t => `${t} thr`.padStart( 26 ) ).join( "" ) );
console.log( " ".repeat( 7 ) + threadCounts.map( () => "setup/phase/join/pose".padStart( 26 ) ).join( "" ) );
for ( const actors of actorCounts ) {
	const cells = [];
	for ( const threadCount of threadCounts ) {
		const r = await measure( actors, threadCount );
		cells.push(
			`${r.setup.toFixed( 2 )}/${r.phase.toFixed( 2 )}/${r.join.toFixed( 2 )}/${r.pose.toFixed( 2 )}`.padStart(
				26
			)
		);
	}
	console.log( String( actors ).padStart( 7 ) + cells.join( "" ) );
}
