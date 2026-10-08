/*
===========================================================================

render-thread.ts - messages between the main thread and the render thread

Port-only, not native (Experimental "Render thread"). The main thread's
renderer proxy (renderer/thread/host.ts) queues the runtime's renderer calls and sends them
once a frame with the frame itself; the render worker (renderer/thread/entry.ts) replays
them in order on the real renderer and draws the newest frame it holds.
Neither thread waits for the other: a reply names the last frame message
it covers (sequence) and carries the renderer's state the runtime reads
back, and the picks and particle snapshots the proxy asked for. Everything
here is structured-clone data.

===========================================================================
*/
import type { RuntimeDiagnostics, Viewport, CharacterStatistics, GpuTimingStats } from "@/engine/contracts/runtime";
import type { WorldRenderStats } from "@/engine/contracts/scene";
import type { WorldTerrainPart, PreparedWorldScene } from "@/engine/contracts/world-admission";
import type { SoundEvent, SoundListener } from "@/engine/contracts/audio";
import type { CharacterActor, CharacterModel, CharacterAttachment } from "@/engine/contracts/character";
import type { WorldTexture } from "@/engine/contracts/texture";
import type { NativeClip } from "@/engine/foundation/animation/native-clip";
import type { Renderer } from "@/engine/contracts/runtime";

/*
================
RenderThreadMirror

The main thread's character owner (no GPU) behind the render thread
proxy: it receives every model, clip and assembly the renderer does and
answers the socket and placement queries, which are pure functions of
those and the actors passed in. settle is its residency, since it never
prepares a frame.
================
*/
export interface RenderThreadMirror {
	model( id: string, model: CharacterModel, images: WorldTexture[] ): void;
	animation( id: string, name: string, clip: NativeClip ): number;
	assembly( id: string, base: string, parts: readonly CharacterAttachment[] ): void;
	retain( ids: readonly string[] ): void;
	settle( actors: readonly CharacterActor[] ): void;
	socket: Renderer["characterSocket"];
	matrix: Renderer["characterMatrix"];
	localMatrix: Renderer["characterLocalMatrix"];
	stats(): CharacterStatistics;
	dispose( geometry: null, images: null ): void;
}

/*
================
RenderCall

One queued renderer call: its method name and arguments, replayed in order.
adoptWorld travels as AdoptWorldCall: its lease is taken on the main
thread and its terrain parts keep their identity by id.
================
*/
export interface RenderCall {
	readonly method: string;
	readonly args: readonly unknown[];
}

/*
================
AdoptWorldCall

terrain: each part's id, with the part itself the first time the render
thread sees that id. The renderer keeps a part's GPU resources by object
identity across region crossings, so the worker must hand it the same
object again.
================
*/
export interface AdoptWorldCall {
	readonly sceneId: string;
	readonly world: PreparedWorldScene;
	readonly detail: unknown;
	readonly terrain?: readonly { readonly id: number; readonly part?: WorldTerrainPart; }[];
}

/*
================
PickRequest

A pointer query the runtime asked this frame, answered after the next
frame the worker draws. key identifies the kind and arguments.
================
*/
export interface PickRequest {
	readonly key: string;
	readonly kind: "entity" | "ground" | "destination" | "frontend-character" | "frontend-race";
	readonly args: readonly unknown[];
	// A click waits for it (deferPick): answered from any gathered frame. A
	// hover pick is answered only from the newest: the pointer has moved on.
	readonly required?: boolean;
}

/*
================
HostMessage
================
*/
export type HostMessage =
	| {
		readonly kind: "start";
		readonly canvas: OffscreenCanvas;
		readonly diagnostics: RuntimeDiagnostics;
		readonly seed: number;
	}
	| {
		readonly kind: "frame";
		// Counts the frame messages from 1, in send order.
		readonly sequence: number;
		readonly calls: readonly RenderCall[];
		readonly viewport: Viewport;
		readonly timeSeconds?: number;
		readonly frameId?: number;
		readonly picks: readonly PickRequest[];
		readonly particles: readonly number[];
		readonly detailedStats?: { readonly posed: boolean; };
	}
	| { readonly kind: "dispose"; readonly calls: readonly RenderCall[]; };

/*
================
RenderReply

The renderer's readable state after a frame. scenery and neededTextures
are undefined when unchanged since the last reply.
================
*/
export interface RenderReply {
	// The last frame message replayed before this draw.
	readonly sequence: number;
	// Frame messages this draw gathered (more than one: the worker fell behind).
	readonly gathered: number;
	readonly phase: "starting" | "running" | "failed" | "disposed";
	readonly error: string | null;
	readonly readbackWaitMs: number;
	readonly gpuTiming: GpuTimingStats & { readonly enabled: boolean; };
	readonly worldStats: WorldRenderStats;
	readonly characterStats: CharacterStatistics;
	readonly detailedStats?: CharacterStatistics;
	readonly worldView: import("@/engine/contracts/runtime").WorldViewSnapshot | null;
	readonly presentationCamera: import("@/engine/foundation/animation/entity-lod").LodPoint | null;
	readonly audioListener: SoundListener | null;
	readonly presentationNight: boolean;
	readonly frontendRaceCenters: readonly (readonly [number, number, number] | null)[];
	readonly scenery?: import("@/engine/contracts/scenery").SceneryPresentation | null;
	readonly neededTextures?: readonly string[];
	readonly picks: readonly (readonly [string, unknown])[];
	readonly particles: readonly (readonly [
		number,
		{ readonly matrix: Float32Array; readonly regionId: number; } | null,
		number | undefined
	])[];
	// The worker's own time for the frame: replay, prepare and submit.
	readonly workerMs: number;
	// Since the previous draw started: the canvas's presented frame time.
	readonly drawIntervalMs: number;
	// Answering this reply's picks, after the draw (not in workerMs), and how many.
	readonly pickMs: number;
	readonly pickCount: number;
	// Of workerMs: replaying the queued calls, before the frame itself.
	readonly replayMs: number;
	// The worker renderer's stage times for the frame (stage-probe.ts keys).
	readonly stages: Readonly<Record<string, number>>;
}

/*
================
WorkerMessage
================
*/
export type WorkerMessage =
	| { readonly kind: "reply"; readonly frameId?: number; readonly reply: RenderReply; }
	| { readonly kind: "sound"; readonly events: readonly SoundEvent[]; }
	| { readonly kind: "failed"; readonly message: string; };
