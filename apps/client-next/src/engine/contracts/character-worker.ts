/*
===========================================================================

character-worker.ts - what the main thread and the character worker share

Port-only, not native: with Experimental "Characters on a worker" the
character presentation (runtime/characters) runs on a worker of its own
(docs/CLIENT_WORKERS_PLAN.md 5.11). A frame crosses through shared memory,
never a message: the main thread writes the frame into the inbox and
advances the frame counter; the worker writes its answer into the outbox
and the actor table and advances the output counter (Atomics). Messages
carry only what moves once: the start, the loads (models and clips, their
buffers and bitmaps transferred) and asset results, and a failure. These
are the shapes; runtime/character-worker owns what they do.

===========================================================================
*/
import type { AssetResult } from "./assets";
import type { CameraScript } from "./camera-script";
import type { CharacterAttachment, CharacterModel } from "./character";
import type { DamageText } from "./damage-text";
import type { Footprint } from "./footprint";
import type { CreationSnapshot } from "./frontend";
import type { CastImpact } from "./gameplay";
import type { MallPreviewState } from "./item-mall";
import type { BerserkGauge } from "./orb";
import type { FollowCameraTarget } from "./scene";
import type { SceneryPresentation } from "./scenery";
import type { CharacterRecord } from "./session";
import type { SoundListener } from "./audio";
import type { WorldTexture } from "./texture";
import type { NativeClip } from "@/engine/foundation/animation/native-clip";
import type { LodPoint } from "@/engine/foundation/animation/entity-lod";
import type { SoundTerrain } from "@/engine/foundation/audio/terrain-sounds";
import type { SharedStrings } from "@/engine/foundation/workers/shared-strings";

/*
================
CharacterWorkerMemory

The shared buffers, made by the main thread and posted once. Each string
table and block has one writer: inbox and its strings the main thread,
outbox, the actor table and their strings the worker.
================
*/
export interface CharacterWorkerMemory {
	readonly control: SharedArrayBuffer;
	readonly inboxStrings: SharedStrings;
	readonly inbox: SharedArrayBuffer;
	readonly outboxStrings: SharedStrings;
	readonly outbox: SharedArrayBuffer;
	readonly actors: SharedArrayBuffer;
}

/*
================
CharacterWorkerStart

The worker's construction, posted once before any frame; simulation is the
simulation worker's port its world batches arrive on.
================
*/
export interface CharacterWorkerStart {
	readonly kind: "start";
	readonly origin: string;
	// The worker's own presentation random stream (decision 7.1).
	readonly seed: number;
	readonly memory: CharacterWorkerMemory;
	readonly simulation: MessagePort;
}

/*
================
CharacterWorkerAssets

Asset results for the worker's requests, by its ids, numbered so a frame
can name the last one it follows.
================
*/
export interface CharacterWorkerAssets {
	readonly kind: "assets";
	readonly sequence: number;
	readonly results: readonly (readonly [number, AssetResult])[];
}

/*
================
CharacterWorkerLoad

A model or clip the presentation gave the renderer, numbered so the
outbox can name where it falls among the frame's commands.
================
*/
export type CharacterWorkerLoad =
	& {
		readonly kind: "load";
		readonly sequence: number;
	}
	& (
		| {
			readonly load: "model";
			readonly id: string;
			readonly model: CharacterModel;
			readonly images: WorldTexture[];
		}
		| { readonly load: "animation"; readonly id: string; readonly name: string; readonly clip: NativeClip; }
	);

/*
================
CharacterWorkerFailure
================
*/
export interface CharacterWorkerFailure {
	readonly kind: "failure";
	readonly message: string;
}

export type CharacterWorkerInput = CharacterWorkerStart | CharacterWorkerAssets;
export type CharacterWorkerMessage = CharacterWorkerLoad | CharacterWorkerFailure;

/*
================
CharacterWorkerOp

What the main thread did to the presentation since the last frame, in its
order: the options, the simulation clock's origin.
================
*/
export type CharacterWorkerOp =
	| { readonly kind: "options"; readonly value: Readonly<Record<string, boolean>>; }
	| { readonly kind: "origin"; readonly ms: number; };

/*
================
CharacterWorkerStep

step's arguments and the inputs the main thread reads for it each frame.
================
*/
export interface CharacterWorkerStep {
	readonly seconds: number;
	readonly simulationMs: number;
	readonly cameraPitch: number | undefined;
	readonly dock: readonly CharacterRecord[] | undefined;
	readonly preview: CreationSnapshot | null;
	readonly lizard: boolean;
	readonly effectDetail: number;
	readonly blindHeld: boolean;
	readonly nativeServerName: string | undefined;
	readonly normalFortressClothes: boolean;
	readonly mallItems: readonly number[] | null;
	readonly mallSkin: { readonly model: number; readonly shape: number; } | null;
	// The gid ready() is asked about after the step.
	readonly localGid: number;
	// The main thread's frame-work level (FrameWork.level).
	readonly frameLevel: number;
	readonly soundEnabled: boolean;
	// The front end's phase: the runtime's world-reset rule reads it.
	readonly phase: string;
	// The last asset results message this frame follows, and the asset
	// slots offered the worker (asset-relay.ts).
	readonly assets: number;
	readonly available: number;
}

/*
================
CharacterWorkerFacts

The renderer's and the world's answers as of the frame the main thread
drew last. A field marked optional is written only when it changed.
================
*/
export interface CharacterWorkerFacts {
	readonly camera: LodPoint | null;
	readonly listener: SoundListener | null;
	readonly night: boolean;
	// The emitter clock of each deferred-particle actor the renderer holds.
	readonly particleTimes: readonly (readonly [number, number])[];
	readonly enchantSparks: boolean | undefined;
	readonly sharedActorRoom: boolean | undefined;
	readonly batchedEffects: boolean | undefined;
	readonly vHidesCompanions: boolean | undefined;
	readonly scenery: SceneryPresentation | null;
	readonly dungeonVisibility?: readonly (readonly number[])[] | null;
	readonly soundTerrain?: readonly SoundTerrain[];
}

/*
================
CharacterWorkerCommand

One renderer command the presentation issued, in its order: the actor
table's lists, an assembly (its definition the first time its id is
sent), a load by its message's number, the retained models, footprints.
================
*/
export type CharacterWorkerCommand =
	| { readonly kind: "actors"; }
	| {
		readonly kind: "assembly";
		readonly id: string;
		readonly definition?: { readonly base: string; readonly parts: readonly CharacterAttachment[]; };
	}
	| { readonly kind: "load"; readonly sequence: number; }
	| { readonly kind: "retain"; readonly ids: readonly string[]; }
	| { readonly kind: "footprints"; readonly value: readonly Footprint[]; };

/*
================
CharacterWorkerHealth

One effective-HP operation the step made on the worker's projection, for
the main thread's projection to repeat.
================
*/
export type CharacterWorkerHealth =
	| {
		readonly kind: "impact";
		readonly gid: number;
		readonly key: string;
		readonly impact: CastImpact;
		readonly now: number;
		readonly source: "cast" | "hawk" | undefined;
	}
	| { readonly kind: "release"; readonly key: string; readonly now: number; }
	| { readonly kind: "finished-casts"; };

/*
================
CharacterWorkerState

What the main thread reads from the presentation after its step.
================
*/
export interface CharacterWorkerState {
	readonly cameraTarget: FollowCameraTarget | null;
	readonly cameraScripts: readonly CameraScript[];
	readonly eventRain: boolean;
	readonly damageText: readonly DamageText[];
	readonly orbGauge: BerserkGauge;
	readonly ready: boolean;
	readonly entryReady: boolean;
	readonly previewReady: boolean;
	readonly dockReady: boolean;
	readonly error: string | null;
	readonly mallPreviewState: MallPreviewState;
	readonly uncensored: boolean;
}

/*
================
CharacterWorkerOutput

The outbox after a step: first the last load message its commands name,
then the commands as bare words (shared-frame.ts COMMAND_*), so the main
thread reads the two hundred assemblies a crowd requests a frame without
building an object for each, then this.
================
*/
export interface CharacterWorkerOutput {
	readonly sounds: readonly import("./audio").SoundEvent[];
	readonly health: readonly CharacterWorkerHealth[];
	readonly state: CharacterWorkerState;
	// Asset requests and cancellations by the worker's own ids.
	readonly requests: readonly {
		readonly id: number;
		readonly url: string;
		readonly limit: number | undefined;
		readonly decode: string | undefined;
	}[];
	readonly cancels: readonly number[];
	// The worker's step time, for the frame probe.
	readonly stepMs: number;
}
