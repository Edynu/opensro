/*
===========================================================================

character-worker.ts - the messages between the main thread and the character worker

Port-only, not native: with Experimental "Characters on a worker" the
character presentation (runtime/characters) runs on a worker of its own
(docs/CLIENT_WORKERS_PLAN.md 5.11). The main thread posts one frame a
display frame while no step is in flight; the worker answers each with
one output. These are their shapes; runtime/character-worker owns what
they do.

===========================================================================
*/
import type { AssetResult } from "./assets";
import type { SoundEvent, SoundListener } from "./audio";
import type { CameraScript } from "./camera-script";
import type { CharacterActor, CharacterAttachment, CharacterModel } from "./character";
import type { DamageText } from "./damage-text";
import type { Footprint } from "./footprint";
import type { CreationSnapshot } from "./frontend";
import type { CastImpact } from "./gameplay";
import type { MallPreviewState } from "./item-mall";
import type { BerserkGauge } from "./orb";
import type { FollowCameraTarget } from "./scene";
import type { SceneryPresentation } from "./scenery";
import type { CharacterRecord } from "./session";
import type { WorldTexture } from "./texture";
import type { WorldBatch } from "./world";
import type { NativeClip } from "@/engine/foundation/animation/native-clip";
import type { LodPoint } from "@/engine/foundation/animation/entity-lod";
import type { SoundTerrain } from "@/engine/foundation/audio/terrain-sounds";
import type { GameOptions } from "@/engine/foundation/gameplay/game-options";

/*
================
CharacterWorkerStart

The worker's construction arguments, posted once before any frame.
================
*/
export interface CharacterWorkerStart {
	readonly kind: "start";
	readonly origin: string;
	// The worker's own presentation random stream (decision 7.1).
	readonly seed: number;
}

/*
================
CharacterWorkerOp

What happened to the presentation since the last frame, in the order the
main thread did it: a world batch its projection applied, a reset of the
presentation, the lifecycle events of the last batch, the options, the
simulation clock's origin.
================
*/
export type CharacterWorkerOp =
	| { readonly kind: "batch"; readonly batch: WorldBatch; }
	| { readonly kind: "reset"; }
	| { readonly kind: "lifecycle"; }
	| { readonly kind: "options"; readonly value: GameOptions; }
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
}

/*
================
CharacterWorkerFacts

The renderer's and the world's answers as of the frame the main thread
drew last. A field marked optional is sent only when it changed.
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
	readonly dungeonPvs: boolean;
	readonly scenery?: SceneryPresentation | null;
	readonly dungeonVisibility?: readonly (readonly number[])[] | null;
	readonly soundTerrain?: readonly SoundTerrain[];
}

/*
================
CharacterWorkerFrame
================
*/
export interface CharacterWorkerFrame {
	readonly kind: "frame";
	readonly ops: readonly CharacterWorkerOp[];
	readonly step: CharacterWorkerStep;
	readonly facts: CharacterWorkerFacts;
	// The main thread's free asset slots, and the results of the worker's
	// requests since the last frame (their buffers and bitmaps transferred).
	readonly available: number;
	readonly results: readonly (readonly [number, AssetResult])[];
}

/*
================
CharacterWorkerCommand

One renderer command the presentation issued, in its order. An assembly
carries its definition the first time its id is sent.
================
*/
export type CharacterWorkerCommand =
	| {
		readonly kind: "actors";
		readonly actors: readonly CharacterActor[];
		readonly portraits: readonly CharacterActor[] | undefined;
	}
	| {
		readonly kind: "assembly";
		readonly id: string;
		readonly definition?: { readonly base: string; readonly parts: readonly CharacterAttachment[]; };
	}
	| {
		readonly kind: "model";
		readonly id: string;
		readonly model: CharacterModel;
		readonly images: WorldTexture[];
	}
	| { readonly kind: "animation"; readonly id: string; readonly name: string; readonly clip: NativeClip; }
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
================
*/
export interface CharacterWorkerOutput {
	readonly kind: "output";
	readonly commands: readonly CharacterWorkerCommand[];
	readonly sounds: readonly SoundEvent[];
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

/*
================
CharacterWorkerFailure
================
*/
export interface CharacterWorkerFailure {
	readonly kind: "failure";
	readonly message: string;
}

export type CharacterWorkerInput = CharacterWorkerStart | CharacterWorkerFrame;
export type CharacterWorkerMessage = CharacterWorkerOutput | CharacterWorkerFailure;
