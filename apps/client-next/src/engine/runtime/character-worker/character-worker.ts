/*
===========================================================================

character-worker.ts - the main thread's side of the character worker

Port-only, not native (Experimental "Characters on a worker",
docs/CLIENT_WORKERS_PLAN.md 5.11). Stands where the character presentation
stands in the runtime, with the methods the runtime calls on it, while the
presentation itself runs on worker/entry.ts. Each step repeats the worker's
last output on the main thread's owners (the renderer's commands in their
order, the sounds, the effective-HP operations, the asset requests) and,
when the worker is idle, posts it this frame: what happened since the last
frame, step's inputs, the renderer's facts and the asset answers. It never
waits for the worker: characters are drawn one frame after the simulation
state they show, and the camera follows the same output.

===========================================================================
*/
import type { AssetOwner } from "@/engine/contracts/assets";
import type { SoundEvent } from "@/engine/contracts/audio";
import type { CameraScript } from "@/engine/contracts/camera-script";
import type { CharacterAttachment } from "@/engine/contracts/character";
import type {
	CharacterWorkerFacts,
	CharacterWorkerHealth,
	CharacterWorkerInput,
	CharacterWorkerMessage,
	CharacterWorkerOp,
	CharacterWorkerOutput,
	CharacterWorkerState,
	CharacterWorkerStep
} from "@/engine/contracts/character-worker";
import type { CastImpact, GameplayState } from "@/engine/contracts/gameplay";
import type { FrameWork, Renderer } from "@/engine/contracts/runtime";
import type { EntityState, WorldBatch, WorldEvent } from "@/engine/contracts/world";
import type { SoundTerrain } from "@/engine/foundation/audio/terrain-sounds";
import type { GameOptions } from "@/engine/foundation/gameplay/game-options";
import { sameValue } from "@/engine/foundation/data/same-value";
import { createAssetRelay } from "./asset-relay";

/*
================
CharacterWorkerOwners

The main thread's owners the worker's output reaches and its facts come from.
================
*/
export interface CharacterWorkerOwners {
	readonly assets: Pick<AssetOwner, "available" | "request" | "take" | "cancel">;
	readonly renderer: Pick<
		Renderer,
		| "setCharacterActors"
		| "setCharacterAssembly"
		| "setCharacterModel"
		| "setCharacterAnimation"
		| "retainCharacterModels"
		| "setFootprints"
		| "characterParticleTime"
		| "scenery"
		| "presentationNight"
		| "presentationCamera"
		| "audioListener"
		| "enchantSparks"
		| "sharedActorRoom"
		| "batchedEffects"
		| "vHidesCompanions"
		| "dungeonVisibility"
	>;
	readonly play: ( event: SoundEvent ) => void;
	readonly soundEnabled: () => boolean;
	readonly soundTerrain: () => readonly SoundTerrain[];
	readonly health: {
		impact( gid: number, key: string, impact: CastImpact, now: number, source?: "cast" | "hawk" ): boolean;
		release( key: string, now: number ): void;
		finishedCasts(): void;
	};
	readonly origin: string;
	readonly seed: number;
	// Reports what the main thread's owners refused of the output (a model
	// over the renderer's budget), which the presentation cannot see.
	readonly report: ( message: string ) => void;
}

// The answers before the worker's first output: nothing drawn, nothing ready.
const INITIAL_STATE: CharacterWorkerState = {
	cameraTarget: null,
	cameraScripts: [],
	eventRain: false,
	damageText: [],
	orbGauge: { authoritative: 0, displayed: 0, pending: 0 },
	ready: false,
	entryReady: false,
	previewReady: false,
	dockReady: false,
	error: null,
	mallPreviewState: { wearable: [] },
	uncensored: false
};

/*
================
createCharacterWorker
================
*/
export function createCharacterWorker( owners: CharacterWorkerOwners ) {
	const worker = new Worker( new URL( "./worker/entry.ts", import.meta.url ), {
		type: "module",
		name: "sro-characters"
	} );
	const relay = createAssetRelay( owners.assets );
	let ops: CharacterWorkerOp[] = [], output: CharacterWorkerOutput | null = null, inFlight = false;
	let state = INITIAL_STATE, cameraScripts: CameraScript[] = [];
	let failure: string | null = null, disposed = false;
	let frameWork: FrameWork | undefined,
		mall: { items: readonly number[] | null; skin: CharacterWorkerStep["mallSkin"]; } = {
			items: null,
			skin: null
		};
	let sentTerrain: readonly SoundTerrain[] | null = null;
	let sentVisibility: CharacterWorkerFacts["dungeonVisibility"] | undefined;
	// The deferred-particle actors of the last applied list, whose clocks
	// the worker's presentation asks the renderer for.
	let deferredGids: number[] = [];
	// Every assembly definition the worker sent: it sends one once.
	const assemblies = new Map<string, { base: string; parts: readonly CharacterAttachment[]; }>();
	worker.onmessage = ( event: MessageEvent<CharacterWorkerMessage> ) => {
		if ( disposed ) return;
		if ( event.data.kind === "failure" ) {
			failure = `Character worker failed: ${event.data.message}`;
			return;
		}
		output = event.data;
		inFlight = false;
		// Asset requests leave at once: a load the presentation waits on
		// should not wait for the next frame as well.
		relay.receive( output.requests, output.cancels );
	};
	worker.onerror = event => {
		failure = `Character worker failed: ${event.message}`;
	};
	const send = ( message: CharacterWorkerInput, transfer: Transferable[] = [] ) =>
		worker.postMessage( message, transfer );
	send( { kind: "start", origin: owners.origin, seed: owners.seed } );
	/*
	================
	attempt

	One output entry on a main-thread owner; what it refuses is reported,
	not fatal, as the presentation would have caught it.
	================
	*/
	const attempt = ( what: string, run: () => void ) => {
		try {
			run();
		} catch ( error ) {
			owners.report( `Character worker ${what}: ${String( error )}` );
		}
	};
	/*
	================
	apply

	The worker's output on the main thread, in the order it was made.
	================
	*/
	const apply = ( value: CharacterWorkerOutput ) => {
		for ( const command of value.commands ) {
			if ( command.kind === "actors" ) {
				owners.renderer.setCharacterActors( command.actors, command.portraits );
				deferredGids = command.actors.filter( actor => actor.deferredParticle ).map( actor => actor.gid );
			} else if ( command.kind === "assembly" ) {
				if ( command.definition ) assemblies.set( command.id, command.definition );
				const definition = assemblies.get( command.id );
				if ( definition ) {
					attempt(
						"assembly",
						() => owners.renderer.setCharacterAssembly( command.id, definition.base, definition.parts )
					);
				}
			} else if ( command.kind === "model" ) {
				attempt(
					"model",
					() => owners.renderer.setCharacterModel( command.id, command.model, command.images )
				);
			} else if ( command.kind === "animation" ) {
				attempt(
					"animation",
					() => owners.renderer.setCharacterAnimation( command.id, command.name, command.clip )
				);
			} else if ( command.kind === "retain" ) owners.renderer.retainCharacterModels( command.ids );
			else owners.renderer.setFootprints( command.value );
		}
		for ( const sound of value.sounds ) attempt( "sound", () => owners.play( sound ) );
		for ( const operation of value.health ) repeat( operation );
		// An answer the main thread compares by identity (the UI's mall and
		// HUD state, the renderer's damage text) keeps it while unchanged.
		const steady = <T>( previous: T, next: T ): T => sameValue( previous, next ) ? previous : next;
		state = {
			...value.state,
			cameraTarget: steady( state.cameraTarget, value.state.cameraTarget ),
			damageText: steady( state.damageText, value.state.damageText ),
			orbGauge: steady( state.orbGauge, value.state.orbGauge ),
			mallPreviewState: steady( state.mallPreviewState, value.state.mallPreviewState )
		};
		cameraScripts.push( ...value.state.cameraScripts );
	};
	/*
	================
	repeat

	An effective-HP operation the worker's projection made, on the main
	thread's, which the UI reads.
	================
	*/
	const repeat = ( operation: CharacterWorkerHealth ) => {
		if ( operation.kind === "impact" ) {
			owners.health.impact( operation.gid, operation.key, operation.impact, operation.now, operation.source );
		} else if ( operation.kind === "release" ) owners.health.release( operation.key, operation.now );
		else owners.health.finishedCasts();
	};
	/*
	================
	facts

	The renderer's and the world's answers as of the frame drawn last.
	================
	*/
	const facts = (): CharacterWorkerFacts => {
		const terrain = owners.soundTerrain(), visibility = owners.renderer.dungeonVisibility?.() ?? null;
		const value: CharacterWorkerFacts = {
			camera: owners.renderer.presentationCamera(),
			listener: owners.renderer.audioListener(),
			night: owners.renderer.presentationNight(),
			particleTimes: deferredGids.flatMap( gid => {
				const time = owners.renderer.characterParticleTime( gid );
				return time === undefined ? [] : [ [ gid, time ] as const ];
			} ),
			enchantSparks: owners.renderer.enchantSparks?.(),
			sharedActorRoom: owners.renderer.sharedActorRoom?.(),
			batchedEffects: owners.renderer.batchedEffects?.(),
			vHidesCompanions: owners.renderer.vHidesCompanions?.(),
			dungeonPvs: visibility !== null,
			scenery: owners.renderer.scenery(),
			...(visibility !== sentVisibility ? { dungeonVisibility: visibility } : {}),
			...(terrain !== sentTerrain ? { soundTerrain: terrain } : {})
		};
		sentVisibility = visibility;
		sentTerrain = terrain;
		return value;
	};
	return {
		frameWork( work: FrameWork ) {
			frameWork = work;
		},
		mallOutfit( items: readonly number[] | null, skin: CharacterWorkerStep["mallSkin"] = null ) {
			mall = { items, skin };
		},
		mallPreviewState: () => state.mallPreviewState,
		options( value: GameOptions ) {
			ops.push( { kind: "options", value } );
		},
		/*
		================
		receiveBatch

		A world batch the main thread's projection applied, for the worker's.
		================
		*/
		receiveBatch( batch: WorldBatch ) {
			ops.push( { kind: "batch", batch } );
		},
		receiveLifecycle( _events: readonly WorldEvent[] ) {
			ops.push( { kind: "lifecycle" } );
		},
		eventRain: () => state.eventRain,
		// The worker takes the feedback from its own projection.
		receiveFeedback( _events: unknown, _entities: readonly EntityState[] ) {},
		/*
		================
		step

		Repeat the worker's last output here, then, unless a step is in
		flight, post this frame.
		================
		*/
		step(
			_entities: readonly EntityState[],
			gameplay: GameplayState | null,
			seconds: number,
			simulationMs = 0,
			cameraPitch?: number,
			dock?: CharacterWorkerStep["dock"],
			preview: CharacterWorkerStep["preview"] = null,
			lizard = false,
			effectDetail = 2,
			blindHeld = false,
			nativeServerName?: string,
			normalFortressClothes = false
		) {
			if ( disposed || failure ) return;
			if ( output ) {
				const value = output;
				output = null;
				apply( value );
			}
			if ( inFlight ) return;
			const { results, transfer, available } = relay.poll();
			send( {
				kind: "frame",
				ops,
				step: {
					seconds,
					simulationMs,
					cameraPitch,
					dock,
					preview,
					lizard,
					effectDetail,
					blindHeld,
					nativeServerName,
					normalFortressClothes,
					mallItems: mall.items,
					mallSkin: mall.skin,
					localGid: gameplay?.localGid ?? 0,
					frameLevel: frameWork?.level() ?? 0,
					soundEnabled: owners.soundEnabled()
				},
				facts: facts(),
				available,
				results
			}, transfer );
			ops = [];
			inFlight = true;
		},
		uncensored: ( _nativeServerName: string | undefined ) => state.uncensored,
		ready: ( _gid: number ) => state.ready,
		entryReady: () => state.entryReady,
		previewReady: () => state.previewReady,
		dockReady: () => state.dockReady,
		profile( _value: unknown ) {},
		cameraTarget: () => state.cameraTarget,
		takeCameraScripts: () => cameraScripts.splice( 0 ),
		orbGauge: () => state.orbGauge,
		damageText: () => state.damageText,
		error: () => failure ?? state.error,
		simulationOrigin( ms: number ) {
			ops.push( { kind: "origin", ms } );
		},
		reset() {
			ops.push( { kind: "reset" } );
		},
		dispose() {
			if ( disposed ) return;
			disposed = true;
			relay.dispose();
			worker.terminate();
		}
	};
}
