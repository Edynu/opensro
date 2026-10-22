/*
===========================================================================

character-worker.ts - the main thread's side of the character worker

Port-only, not native (Experimental "Characters on a worker",
docs/CLIENT_WORKERS_PLAN.md 5.11). Stands where the character presentation
stands in the runtime, with the methods the runtime calls on it, while the
presentation itself runs on worker/entry.ts. The two share memory, as the
plan's tables do (5.1): this side writes each frame into the inbox and
advances the frame counter; the worker writes the actor table and the
outbox and advances the output counter. Each step here applies the
worker's last answer once the counter shows it (the actor lists straight
from the table into the renderer's rows, then the commands in their
order, the sounds, the effective-HP operations, the asset requests) and,
when the worker is idle, writes it the next frame. It never waits:
characters are drawn one frame after the simulation state they show, and
the camera follows the same output. Only loads and asset results, whose
buffers move, travel as messages; the simulation worker posts its world
batches to the worker directly.

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
	CharacterWorkerLoad,
	CharacterWorkerMemory,
	CharacterWorkerMessage,
	CharacterWorkerOp,
	CharacterWorkerOutput,
	CharacterWorkerState,
	CharacterWorkerStep
} from "@/engine/contracts/character-worker";
import type { Footprint } from "@/engine/contracts/footprint";
import type { CastImpact, GameplayState } from "@/engine/contracts/gameplay";
import type { FrameWork, Renderer } from "@/engine/contracts/runtime";
import type { EntityState, WorldEvent } from "@/engine/contracts/world";
import { createActorTable, createActorTableReader } from "@/engine/foundation/animation/actor-table";
import type { SoundTerrain } from "@/engine/foundation/audio/terrain-sounds";
import { sameValue } from "@/engine/foundation/data/same-value";
import type { GameOptions } from "@/engine/foundation/gameplay/game-options";
import {
	answered,
	COMMAND_ACTORS,
	COMMAND_ASSEMBLY,
	COMMAND_DEFINED_ASSEMBLY,
	COMMAND_FOOTPRINTS,
	COMMAND_LOAD,
	COMMAND_RETAIN,
	createFrameControl,
	postFrame
} from "@/engine/foundation/workers/shared-frame";
import {
	createSharedStrings,
	createStringReader,
	createStringWriter
} from "@/engine/foundation/workers/shared-strings";
import { createSharedBlock, createValueReader, createValueWriter } from "@/engine/foundation/workers/shared-values";
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
		| "setCharacterActorTable"
		| "characterActors"
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
	// The front end's phase, which the runtime's world-reset rule reads.
	readonly frontendPhase: () => string;
	// The simulation worker's port for its world batches (simulation/host.ts presentationPort).
	readonly simulation: MessagePort;
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
	const memory: CharacterWorkerMemory = {
		control: createFrameControl(),
		inboxStrings: createSharedStrings(),
		inbox: createSharedBlock(),
		outboxStrings: createSharedStrings(),
		outbox: createSharedBlock(),
		actors: createActorTable()
	};
	const control = new Int32Array( memory.control );
	const inbox = createValueWriter( memory.inbox, createStringWriter( memory.inboxStrings ) );
	const outboxStrings = createStringReader( memory.outboxStrings );
	const outbox = createValueReader( memory.outbox, outboxStrings );
	const table = createActorTableReader( memory.actors, outboxStrings );
	const worker = new Worker( new URL( "./worker/entry.ts", import.meta.url ), {
		type: "module",
		name: "sro-characters"
	} );
	const relay = createAssetRelay( owners.assets );
	let ops: CharacterWorkerOp[] = [], posted = 0, applied = true, assetMessages = 0;
	let state = INITIAL_STATE, cameraScripts: CameraScript[] = [];
	let failure: string | null = null, disposed = false;
	let frameWork: FrameWork | undefined;
	let mall: { items: readonly number[] | null; skin: CharacterWorkerStep["mallSkin"]; } = { items: null, skin: null };
	let sentTerrain: readonly SoundTerrain[] | null = null;
	let sentVisibility: CharacterWorkerFacts["dungeonVisibility"] | undefined;
	// Loads by number, until the outbox that names them is applied.
	const loads = new Map<number, CharacterWorkerLoad>();
	let loaded = 0;
	// Every assembly definition the worker sent: it sends one once.
	const assemblies = new Map<string, { base: string; parts: readonly CharacterAttachment[]; }>();
	worker.onmessage = ( event: MessageEvent<CharacterWorkerMessage> ) => {
		if ( disposed ) return;
		if ( event.data.kind === "failure" ) {
			failure = `Character worker failed: ${event.data.message}`;
			return;
		}
		loads.set( event.data.sequence, event.data );
		loaded = Math.max( loaded, event.data.sequence );
	};
	worker.onerror = event => {
		failure = `Character worker failed: ${event.message}`;
	};
	const send = ( message: CharacterWorkerInput, transfer: Transferable[] = [] ) =>
		worker.postMessage( message, transfer );
	send( { kind: "start", origin: owners.origin, seed: owners.seed, memory, simulation: owners.simulation }, [
		owners.simulation
	] );
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
	apply

	The worker's answer on the main thread, in the order it was made; false
	while a load it names has not arrived (it is applied next frame).
	================
	*/
	const apply = (): boolean => {
		outbox.begin();
		// The loads the commands name must have arrived.
		if ( outbox.number() > loaded ) return false;
		const commands = outbox.number();
		for ( let i = 0; i < commands; i++ ) {
			const kind = outbox.number();
			if ( kind === COMMAND_ACTORS ) owners.renderer.setCharacterActorTable?.( table );
			else if ( kind === COMMAND_ASSEMBLY || kind === COMMAND_DEFINED_ASSEMBLY ) {
				const id = outbox.text();
				if ( kind === COMMAND_DEFINED_ASSEMBLY ) {
					assemblies.set( id, outbox.value() as { base: string; parts: readonly CharacterAttachment[]; } );
				}
				const definition = assemblies.get( id );
				if ( definition ) {
					attempt(
						"assembly",
						() => owners.renderer.setCharacterAssembly( id, definition.base, definition.parts )
					);
				}
			} else if ( kind === COMMAND_LOAD ) {
				const sequence = outbox.number(), load = loads.get( sequence )!;
				loads.delete( sequence );
				attempt( load.load, () => {
					if ( load.load === "model" ) owners.renderer.setCharacterModel( load.id, load.model, load.images );
					else owners.renderer.setCharacterAnimation( load.id, load.name, load.clip );
				} );
			} else if ( kind === COMMAND_RETAIN ) owners.renderer.retainCharacterModels( outbox.value() as string[] );
			else owners.renderer.setFootprints( outbox.value() as Footprint[] );
		}
		const value = outbox.value() as CharacterWorkerOutput;
		for ( const sound of value.sounds ) attempt( "sound", () => owners.play( sound ) );
		for ( const operation of value.health ) repeat( operation );
		relay.receive( value.requests, value.cancels );
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
		return true;
	};
	/*
	================
	facts

	The renderer's and the world's answers as of the frame drawn last.
	================
	*/
	const facts = (): CharacterWorkerFacts => {
		const terrain = owners.soundTerrain(), visibility = owners.renderer.dungeonVisibility?.() ?? null;
		const particleTimes: [number, number][] = [];
		for ( const actor of owners.renderer.characterActors() ) {
			if ( !actor.deferredParticle ) continue;
			const time = owners.renderer.characterParticleTime( actor.gid );
			if ( time !== undefined ) particleTimes.push( [ actor.gid, time ] );
		}
		const value: CharacterWorkerFacts = {
			camera: owners.renderer.presentationCamera(),
			listener: owners.renderer.audioListener(),
			night: owners.renderer.presentationNight(),
			particleTimes,
			enchantSparks: owners.renderer.enchantSparks?.(),
			sharedActorRoom: owners.renderer.sharedActorRoom?.(),
			batchedEffects: owners.renderer.batchedEffects?.(),
			vHidesCompanions: owners.renderer.vHidesCompanions?.(),
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
		// The worker applies the simulation's batches, their lifecycle events
		// and the world-reset rule itself (worker/entry.ts).
		receiveLifecycle( _events: readonly WorldEvent[] ) {},
		eventRain: () => state.eventRain,
		// The worker takes the feedback from its own projection.
		receiveFeedback( _events: unknown, _entities: readonly EntityState[] ) {},
		/*
		================
		step

		Apply the worker's answer once the output counter shows it, then,
		while it is idle, write it this frame.
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
			if ( !applied ) {
				if ( !answered( control, posted ) || !apply() ) return;
				applied = true;
			}
			const { results, transfer, available } = relay.poll();
			if ( results.length ) send( { kind: "assets", sequence: ++assetMessages, results }, transfer );
			inbox.begin();
			inbox.value( ops );
			inbox.value(
				{
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
					soundEnabled: owners.soundEnabled(),
					phase: owners.frontendPhase(),
					assets: assetMessages,
					available
				} satisfies CharacterWorkerStep
			);
			inbox.value( facts() );
			inbox.end();
			ops = [];
			applied = false;
			postFrame( control, ++posted );
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
		// The worker resets by the runtime's world-reset rule (worker/entry.ts).
		reset() {},
		dispose() {
			if ( disposed ) return;
			disposed = true;
			relay.dispose();
			worker.terminate();
		}
	};
}
