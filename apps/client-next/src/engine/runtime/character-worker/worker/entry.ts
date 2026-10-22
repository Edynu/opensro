/*
===========================================================================

entry.ts - the character worker: the character presentation off the main thread

Port-only, not native (Experimental "Characters on a worker",
docs/CLIENT_WORKERS_PLAN.md 5.11). Started by character-worker.ts with one
start message, then stepped by one frame message at a time. It builds the
presentation the main thread would (runtime/characters, unchanged) with
stand-ins for what lives on the main thread: the renderer, the asset owner,
the audio queue and the effective-HP owner. It keeps its own projection of
the simulation's world batches and its own random stream. Each frame it
repeats what the main thread did to the presentation (batches, resets,
lifecycle events, options, the clock origin), steps it once and posts back
the renderer commands, sounds, HP operations and answers it produced.

===========================================================================
*/
import type {
	CharacterWorkerFrame,
	CharacterWorkerHealth,
	CharacterWorkerInput,
	CharacterWorkerMessage,
	CharacterWorkerState
} from "@/engine/contracts/character-worker";
import type { SoundEvent } from "@/engine/contracts/audio";
import type { FrameWork } from "@/engine/contracts/runtime";
import type { WorldBatch } from "@/engine/contracts/world";
import { sampleSoundTerrain, type SoundTerrain } from "@/engine/foundation/audio/terrain-sounds";
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

/*
================
createCharacterWorkerStep

The worker's presentation and everything it is given in place of the main
thread's owners; step answers one frame message with one output.
================
*/
function createCharacterWorkerStep( origin: string, seed: number ) {
	// Buffers and bitmaps the asset results brought, which move on to the
	// main thread instead of being copied (renderer-stand-in.ts).
	const delivered = new WeakSet<object>();
	const assets = createAssetStandIn( delivered );
	// A renderer character owner of the worker's own, without a GPU or
	// frame workers: it answers the skeleton queries.
	const skeletons = createCharacters();
	const rendererStandIn = createRendererStandIn( skeletons, delivered );
	const projection = createPresentation();
	let sounds: SoundEvent[] = [], health: CharacterWorkerHealth[] = [];
	let soundTerrain: readonly SoundTerrain[] = [], soundEnabled = true, frameLevel = 0;
	let lastBatch: WorldBatch | null = null;
	// The main thread's frame-work level; the worker spends nothing of it.
	const frameWork: FrameWork = { level: () => frameLevel, remaining: () => Infinity, spend() {} };
	const characters = createCharacterPresentation(
		assets.assets,
		rendererStandIn.renderer,
		origin,
		event => sounds.push( event ),
		createPresentationRandom( seed ),
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
	return {
		/*
		================
		step

		The main thread's order (runtime.ts frame): its operations, the
		feedback, the HP owner's step, the mall outfit, the presentation's
		step, then the answers the main thread reads after it.
		================
		*/
		step( frame: CharacterWorkerFrame ) {
			const started = performance.now();
			for ( const op of frame.ops ) {
				if ( op.kind === "batch" ) {
					lastBatch = op.batch;
					projection.apply( op.batch );
				} else if ( op.kind === "reset" ) {
					characters.reset();
					rendererStandIn.reset();
				} else if ( op.kind === "lifecycle" ) {
					if ( lastBatch ) characters.receiveLifecycle( lastBatch.events );
				} else if ( op.kind === "options" ) characters.options( op.value );
				else characters.simulationOrigin( op.ms );
			}
			const { step, facts } = frame;
			assets.frame( frame.available, frame.results );
			rendererStandIn.frame( facts, step.seconds );
			if ( facts.soundTerrain ) soundTerrain = facts.soundTerrain;
			soundEnabled = step.soundEnabled;
			frameLevel = step.frameLevel;
			characters.frameWork( frameWork );
			characters.receiveFeedback( projection.takeFeedback(), projection.entities() );
			projection.step( step.simulationMs );
			characters.mallOutfit( step.mallItems, step.mallSkin );
			characters.step(
				projection.entities(),
				projection.gameplay(),
				step.seconds,
				step.simulationMs,
				step.cameraPitch,
				step.dock,
				step.preview,
				step.lizard,
				step.effectDetail,
				step.blindHeld,
				step.nativeServerName,
				step.normalFortressClothes
			);
			const state: CharacterWorkerState = {
				cameraTarget: characters.cameraTarget(),
				cameraScripts: characters.takeCameraScripts(),
				eventRain: characters.eventRain(),
				damageText: [ ...characters.damageText() ],
				orbGauge: characters.orbGauge(),
				ready: characters.ready( step.localGid ),
				entryReady: characters.entryReady(),
				previewReady: characters.previewReady(),
				dockReady: characters.dockReady(),
				error: characters.error() ?? null,
				mallPreviewState: characters.mallPreviewState(),
				uncensored: characters.uncensored( step.nativeServerName )
			};
			const { commands, transfer } = rendererStandIn.take(), { requests, cancels } = assets.take();
			const output = {
				kind: "output" as const,
				commands,
				sounds,
				health,
				state,
				requests,
				cancels,
				stepMs: performance.now() - started
			};
			sounds = [];
			health = [];
			return { output, transfer };
		}
	};
}

let worker: ReturnType<typeof createCharacterWorkerStep> | null = null;
port.onmessage = event => {
	try {
		const message = event.data;
		if ( message.kind === "start" ) {
			worker = createCharacterWorkerStep( message.origin, message.seed );
			return;
		}
		if ( !worker ) throw Error( "Character worker stepped before its start" );
		const { output, transfer } = worker.step( message );
		port.postMessage( output, transfer );
	} catch ( error ) {
		worker = null;
		port.onmessage = null;
		port.postMessage( { kind: "failure", message: String( error ) }, [] );
	}
};
