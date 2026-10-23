/*
===========================================================================

entry.ts - the character worker: the character presentation off the main thread

Port-only, not native (Experimental "Characters on a worker",
docs/CLIENT_WORKERS_PLAN.md 5.11). Started by character-worker.ts with one
start message carrying the shared memory and the simulation's world journal.
It builds the presentation the main thread would (runtime/characters,
unchanged) with stand-ins for what lives on the main thread: the
renderer, the asset owner, the audio queue and the effective-HP owner. It
keeps its own projection of the simulation's world batches, read from
the simulation's shared world journal, and its own random stream.

A frame crosses through shared memory: the worker waits for the frame
counter (without blocking its message loop), reads the inbox, applies the
world batches that arrived as the runtime does (its world-reset rule
included), steps the presentation once, writes the actor table and the
outbox, then advances the output counter. Only loads (models, clips) and
asset results travel as messages, their buffers moved.

===========================================================================
*/
import type {
	CharacterWorkerAssets,
	CharacterWorkerCommand,
	CharacterWorkerFacts,
	CharacterWorkerHealth,
	CharacterWorkerInput,
	CharacterWorkerMessage,
	CharacterWorkerOp,
	CharacterWorkerOutput,
	CharacterWorkerStart,
	CharacterWorkerState,
	CharacterWorkerStep
} from "@/engine/contracts/character-worker";
import type { SoundEvent } from "@/engine/contracts/audio";
import type { FrameWork } from "@/engine/contracts/runtime";
import type { WorldBatch } from "@/engine/contracts/world";
import { createActorTableWriter } from "@/engine/foundation/animation/actor-table";
import { createJournalReader, JOURNAL_PRESENTATION } from "@/engine/foundation/workers/shared-journal";
import { sampleSoundTerrain, type SoundTerrain } from "@/engine/foundation/audio/terrain-sounds";
import {
	COMMAND_ACTORS,
	COMMAND_ASSEMBLY,
	COMMAND_DEFINED_ASSEMBLY,
	COMMAND_FOOTPRINTS,
	COMMAND_LOAD,
	COMMAND_RETAIN,
	nextFrame,
	postOutput
} from "@/engine/foundation/workers/shared-frame";
import { createStringReader, createStringWriter } from "@/engine/foundation/workers/shared-strings";
import { createValueReader, createValueWriter } from "@/engine/foundation/workers/shared-values";
import { createCharacterPresentation } from "@/engine/runtime/characters/characters";
import { createPresentation } from "@/engine/runtime/presentation/presentation";
import { createPresentationRandom } from "@/engine/runtime/random/random";
import { createCharacters } from "@/engine/runtime/renderer/characters/characters";
import { createAssetStandIn } from "./asset-stand-in";
import { createRendererStandIn } from "./renderer-stand-in";

const port = globalThis as unknown as {
	onmessage: (( event: MessageEvent<CharacterWorkerInput> ) => void) | null;
	postMessage( message: CharacterWorkerMessage, transfer: Transferable[] ): void;
};

// The runtime's world-reset rule (runtime.ts frame): a reset batch resets
// the presentation at once in these front-end phases, else when the front
// end next enters loading-world.
const RESET_PHASES = [ "world", "loading-world" ];

/*
================
createCharacterWorker

The worker's presentation and everything it is given in place of the main
thread's owners; run steps it for every frame the host posts.
================
*/
function createCharacterWorker( start: CharacterWorkerStart ) {
	const { memory } = start;
	const control = new Int32Array( memory.control );
	const inbox = createValueReader( memory.inbox, createStringReader( memory.inboxStrings ) );
	const outboxStrings = createStringWriter( memory.outboxStrings );
	const outbox = createValueWriter( memory.outbox, outboxStrings );
	const table = createActorTableWriter( memory.actors, outboxStrings );
	// Buffers and bitmaps the asset results brought, which move on to the
	// main thread with the loads instead of being copied (renderer-stand-in.ts).
	const delivered = new WeakSet<object>();
	const assets = createAssetStandIn( delivered );
	// A renderer character owner of the worker's own, without a GPU or
	// frame workers: it answers the skeleton queries.
	const rendererStandIn = createRendererStandIn(
		createCharacters(),
		delivered,
		table,
		( load, transfer ) => port.postMessage( load, transfer )
	);
	const projection = createPresentation();
	let sounds: SoundEvent[] = [], health: CharacterWorkerHealth[] = [];
	let soundTerrain: readonly SoundTerrain[] = [], soundEnabled = true, frameLevel = 0;
	let batches: WorldBatch[] = [], pendingReset = false, stopped = false;
	// Asset results by message, and the number of the last one received.
	let results: CharacterWorkerAssets["results"][number][] = [], received = 0;
	let resultWaiter: (() => void) | null = null;
	// The main thread's frame-work level; the worker spends nothing of it.
	const frameWork: FrameWork = { level: () => frameLevel, remaining: () => Infinity, spend() {} };
	const characters = createCharacterPresentation(
		assets.assets,
		rendererStandIn.renderer,
		start.origin,
		event => sounds.push( event ),
		createPresentationRandom( start.seed ),
		pose => sampleSoundTerrain( soundTerrain, pose ),
		{
			impact( gid, key, impact, now, source ) {
				health.push( { kind: "impact", gid, key, impact, now, source } );
				return projection.impact( gid, key, impact, now, source );
			},
			currentResult: ( gid, key ) => projection.currentResult( gid, key ),
			dead: gid => projection.dead( gid ),
			release( key, now ) {
				health.push( { kind: "release", key, now } );
				projection.release( key, now );
			},
			finishedCasts() {
				health.push( { kind: "finished-casts" } );
				projection.finishedCasts();
			}
		},
		() => soundEnabled
	);
	// The world journal's batches, read as this worker's own (shared-journal.ts).
	const worlds = createJournalReader( start.simulation, JOURNAL_PRESENTATION );
	/*
	================
	writeCommands

	The step's renderer commands as bare words, read back by the host's
	apply in the same layout.
	================
	*/
	const writeCommands = ( commands: readonly CharacterWorkerCommand[] ) => {
		outbox.number( commands.length );
		for ( const command of commands ) {
			if ( command.kind === "actors" ) outbox.number( COMMAND_ACTORS );
			else if ( command.kind === "assembly" ) {
				outbox.number( command.definition ? COMMAND_DEFINED_ASSEMBLY : COMMAND_ASSEMBLY );
				outbox.text( command.id );
				if ( command.definition ) outbox.value( command.definition );
			} else if ( command.kind === "load" ) {
				outbox.number( COMMAND_LOAD );
				outbox.number( command.sequence );
			} else if ( command.kind === "retain" ) {
				outbox.number( COMMAND_RETAIN );
				outbox.value( command.ids );
			} else {
				outbox.number( COMMAND_FOOTPRINTS );
				outbox.value( command.value );
			}
		}
	};
	/*
	================
	reset
	================
	*/
	const reset = () => {
		characters.reset();
		rendererStandIn.reset();
	};
	/*
	================
	step

	The main thread's order (runtime.ts frame): the world batches and their
	lifecycle events, the operations, the feedback, the HP owner's step, the
	mall outfit, the presentation's step, then the answers it reads after.
	================
	*/
	const step = (
		frame: number,
		ops: readonly CharacterWorkerOp[],
		input: CharacterWorkerStep,
		facts: CharacterWorkerFacts
	) => {
		const started = performance.now();
		for ( let batch = worlds.poll(); batch; batch = worlds.poll() ) batches.push( batch );
		const arrived = batches;
		batches = [];
		for ( const batch of arrived ) {
			if ( projection.apply( batch ) ) {
				if ( RESET_PHASES.includes( input.phase ) ) reset();
				else pendingReset = true;
			}
			characters.receiveLifecycle( batch.events );
		}
		if ( pendingReset && input.phase === "loading-world" ) {
			pendingReset = false;
			reset();
		}
		for ( const op of ops ) {
			if ( op.kind === "options" ) characters.options( op.value as Parameters<typeof characters.options>[0] );
			else characters.simulationOrigin( op.ms );
		}
		const answered = results;
		results = [];
		assets.frame( input.available, answered );
		rendererStandIn.frame( facts, input.seconds );
		if ( facts.soundTerrain ) soundTerrain = facts.soundTerrain;
		soundEnabled = input.soundEnabled;
		frameLevel = input.frameLevel;
		characters.frameWork( frameWork );
		characters.receiveFeedback( projection.takeFeedback(), projection.entities() );
		projection.step( input.simulationMs );
		characters.mallOutfit( input.mallItems, input.mallSkin );
		characters.step(
			projection.entities(),
			projection.gameplay(),
			input.seconds,
			input.simulationMs,
			input.cameraPitch,
			input.dock,
			input.preview,
			input.lizard,
			input.effectDetail,
			input.blindHeld,
			input.nativeServerName,
			input.normalFortressClothes
		);
		const state: CharacterWorkerState = {
			cameraTarget: characters.cameraTarget(),
			cameraScripts: characters.takeCameraScripts(),
			eventRain: characters.eventRain(),
			damageText: characters.damageText(),
			orbGauge: characters.orbGauge(),
			ready: characters.ready( input.localGid ),
			entryReady: characters.entryReady(),
			previewReady: characters.previewReady(),
			dockReady: characters.dockReady(),
			error: characters.error() ?? null,
			mallPreviewState: characters.mallPreviewState(),
			uncensored: characters.uncensored( input.nativeServerName )
		};
		const { commands, loads } = rendererStandIn.take(), { requests, cancels } = assets.take();
		const output: CharacterWorkerOutput = {
			sounds,
			health,
			state,
			requests,
			cancels,
			stepMs: performance.now() - started
		};
		outbox.begin();
		outbox.number( loads );
		writeCommands( commands );
		outbox.value( output );
		outbox.end();
		sounds = [];
		health = [];
		postOutput( control, frame );
	};
	return {
		/*
		================
		assets

		A results message: kept for the step of the frame that names it.
		================
		*/
		assets( message: CharacterWorkerAssets ) {
			results.push( ...message.results );
			received = message.sequence;
			resultWaiter?.();
		},
		/*
		================
		run

		Frames until stopped: wait for the next, wait for the asset results
		it follows, step it.
		================
		*/
		async run() {
			let seen = 0;
			while ( !stopped ) {
				seen = await nextFrame( control, seen );
				inbox.begin();
				const ops = inbox.value() as readonly CharacterWorkerOp[];
				const input = inbox.value() as CharacterWorkerStep, facts = inbox.value() as CharacterWorkerFacts;
				while ( received < input.assets ) await new Promise<void>( resolve => resultWaiter = resolve );
				resultWaiter = null;
				step( seen, ops, input, facts );
			}
		},
		stop() {
			stopped = true;
		}
	};
}

let worker: ReturnType<typeof createCharacterWorker> | null = null;
/*
================
fail
================
*/
const fail = ( error: unknown ) => {
	worker?.stop();
	worker = null;
	port.onmessage = null;
	port.postMessage( { kind: "failure", message: String( error ) }, [] );
};
port.onmessage = event => {
	try {
		const message = event.data;
		if ( message.kind === "start" ) {
			worker = createCharacterWorker( message );
			worker.run().catch( fail );
			return;
		}
		if ( !worker ) throw Error( "Character worker given assets before its start" );
		worker.assets( message );
	} catch ( error ) {
		fail( error );
	}
};
