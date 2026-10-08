/*
===========================================================================

host.ts - the main thread's renderer proxy for the render thread

Port-only, not native (Experimental "Render thread"). Stands in for the
renderer when it runs in a worker (entry.ts) on the canvas's
OffscreenCanvas. The runtime keeps calling the Renderer interface:

- setters are queued and sent once a frame with the frame itself, so the
  worker replays them in the order the runtime made them;
- the renderer's readable state (stats, cameras, world view, timing) is
  the worker's last reply, one frame old;
- pointer picks answer from the last reply for the same arguments, and
  are asked again for the next frame. A hover pick also asks the ground
  and destination picks at its point, so a click there finds them;
- character sockets and placements are pure functions of the models and
  the actors passed in: a main-thread character owner (the mirror, no
  GPU) receives every model, clip and assembly and answers them exactly.

frame() sends the frame and returns at once; it never waits for the
worker. The worker draws at its own rate and gathers the messages that
arrive during a draw, so neither thread's frame adds to the other's.

===========================================================================
*/
import type {
	CharacterStatistics,
	GpuTimingStats,
	RenderFrameProbe,
	Renderer,
	RuntimeDiagnostics
} from "@/engine/contracts/runtime";
import type { CharacterActor } from "@/engine/contracts/character";
import type { WorldRenderStats } from "@/engine/contracts/scene";
import type { WorldTerrainPart } from "@/engine/contracts/world-admission";
import type { SoundEvent } from "@/engine/contracts/audio";
import type {
	HostMessage,
	PickRequest,
	RenderCall,
	RenderReply,
	RenderThreadMirror,
	WorkerMessage
} from "@/engine/contracts/render-thread";
import { createActorEncoder, createUiEncoder, sameData } from "@/engine/foundation/rendering/render-thread-delta";
import { sameUiQuad } from "@/engine/foundation/ui/ui-equality";

const EMPTY_WORLD_STATS: WorldRenderStats = {
	pendingGroups: 0,
	sceneId: null,
	residentGroups: 0,
	visibleGroups: 0,
	triangles: 0,
	pendingTextures: 0,
	bundleRebuilds: 0
};

// Frame messages the worker may be behind before the main thread holds
// one back: one drawing and one waiting keeps the worker busy without a
// queue of stale frames.
const MAX_FRAMES_AHEAD = 2;

/*
================
createRenderThread
================
*/
export function createRenderThread(
	canvas: HTMLCanvasElement,
	mirror: RenderThreadMirror,
	sound?: ( event: SoundEvent ) => void,
	diagnostics: RuntimeDiagnostics = {}
): Renderer {
	const worker = new Worker( new URL( "./entry.ts", import.meta.url ), { type: "module", name: "sro-render" } );
	const offscreen = canvas.transferControlToOffscreen();
	const start: HostMessage = {
		kind: "start",
		canvas: offscreen,
		diagnostics,
		seed: Math.trunc( performance.now() ) >>> 0
	};
	worker.postMessage( start, [ offscreen ] );
	// Only what changed crosses each frame (render-thread-delta.ts).
	const actorEncoder = createActorEncoder(), uiEncoder = createUiEncoder( sameUiQuad );
	let calls: RenderCall[] = [];
	let last: RenderReply | null = null, failure: string | null = null, disposed = false;
	// Frame messages sent, and the last one a reply covered.
	let sent = 0, answered = 0;
	let picks = new Map<string, unknown>();
	// A click waiting for its picks (deferPick), the frame message that asks
	// them, and whether one is re-running.
	let deferredClick: (() => void) | null = null, deferredAfter = 0, retrying = false, missed = false;
	// Inside a deferPick probe: its picks are answered even from a frame the
	// worker gathers behind a newer one.
	let probing = false;
	const pickRequests = new Map<string, PickRequest>();
	const particleAnswers = new Map<
		number,
		{ snapshot: { readonly matrix: Float32Array; readonly regionId: number; } | null; time: number | undefined; }
	>();
	const particleRequests = new Set<number>();
	let detailedRequest: { posed: boolean; } | undefined;
	let scenery: ReturnType<Renderer["scenery"]> = null, neededTextures: readonly string[] = [];
	let actors: readonly CharacterActor[] = [];
	const partIds = new WeakMap<WorldTerrainPart, number>();
	let nextPart = 1;
	// Calls the runtime repeats unchanged every frame cross only on a change:
	// a setter's last arguments, a texture's last image, and the frame each
	// assembly was last asked in (one asked every frame stays in use, so the
	// worker cannot have retired it).
	const lastSetters = new Map<string, readonly unknown[]>();
	const sentWorldTextures = new Map<string, unknown>(), sentUiTextures = new Map<string, unknown>();
	const assemblyFrames = new Map<string, number>();
	let frameNumber = 0;

	worker.onmessage = ( event: MessageEvent<WorkerMessage> ) => {
		const message = event.data;
		if ( message.kind === "failed" ) {
			failure ??= message.message;
			return;
		}
		if ( message.kind === "sound" ) {
			for ( const row of message.events ) sound?.( row );
			return;
		}
		last = message.reply;
		picks = new Map( last.picks );
		particleAnswers.clear();
		for ( const [gid, snapshot, time] of last.particles ) particleAnswers.set( gid, { snapshot, time } );
		if ( last.scenery !== undefined ) scenery = last.scenery;
		if ( last.neededTextures !== undefined ) neededTextures = last.neededTextures;
		answered = last.sequence;
		const click = deferredClick;
		if ( click && answered >= deferredAfter ) {
			deferredClick = null;
			retrying = true;
			try {
				click();
			} finally {
				retrying = false;
			}
		}
	};
	worker.onerror = event => {
		failure ??= "Render thread: " + (event.message || "worker error");
	};

	/*
	================
	queue
	================
	*/
	function queue( method: string, ...args: unknown[] ) {
		if ( disposed ) throw Error( "Renderer disposed" );
		calls.push( { method, args } );
	}

	/*
	================
	setter

	An idempotent setter: queued only when its arguments changed.
	================
	*/
	function setter( method: string, ...args: unknown[] ) {
		const previous = lastSetters.get( method );
		if ( previous && sameData( previous, args ) ) return;
		lastSetters.set( method, args );
		queue( method, ...args );
	}

	/*
	================
	pick

	The last frame's answer for these arguments; asked again for the next.
	================
	*/
	function pick<T>( kind: PickRequest["kind"], args: readonly unknown[] ): T | null {
		const key = kind + ":" + JSON.stringify( args );
		pickRequests.set( key, { key, kind, args, required: probing || pickRequests.get( key )?.required } );
		if ( picks.has( key ) ) return picks.get( key ) as T;
		missed = true;
		return null;
	}

	/*
	================
	post

	Send the queued calls and this frame, then settle the mirror (after the
	send: a model it retires may still have been in the queued calls).
	================
	*/
	function post( viewport: Parameters<Renderer["frame"]>[0], timeSeconds?: number, frameId?: number ) {
		const message: HostMessage = {
			kind: "frame",
			sequence: ++sent,
			calls,
			viewport,
			timeSeconds,
			frameId,
			picks: [ ...pickRequests.values() ],
			particles: [ ...particleRequests ],
			detailedStats: detailedRequest
		};
		calls = [];
		frameNumber++;
		for ( const [id, at] of assemblyFrames ) if ( frameNumber - at > 2 ) assemblyFrames.delete( id );
		pickRequests.clear();
		particleRequests.clear();
		detailedRequest = undefined;
		try {
			worker.postMessage( message );
		} catch ( error ) {
			failure ??= "Render thread: " + String( error );
		}
		mirror.settle( actors );
	}

	return {
		setFrameWork() {},
		readbackWaitMs: () => last?.readbackWaitMs ?? 0,
		scenery: () => scenery,
		gpuTiming: (): GpuTimingStats & { readonly enabled: boolean; } =>
			last?.gpuTiming ?? {
				attempted: 0,
				completed: 0,
				omittedPasses: 0,
				supported: false,
				skipped: 0,
				failed: 0,
				samples: [],
				enabled: !!diagnostics.gpuTiming
			},
		videoOptions: value => setter( "videoOptions", value ),
		experimentalVideo: value => setter( "experimentalVideo", value ),
		setSelectionDecal: value => setter( "setSelectionDecal", value ),
		setFootprints: value => setter( "setFootprints", value ),
		pickGround: ( x, y ) => pick( "ground", [ x, y ] ),
		pickDestination: ( x, y ) => pick( "destination", [ x, y ] ),
		pickFrontendCharacter: ( x, y, ids ) => pick( "frontend-character", [ x, y, ids ] ),
		pickFrontendRace: ( x, y ) => pick( "frontend-race", [ x, y ] ),
		frontendRaceCenters: () => last?.frontendRaceCenters ?? [],
		presentationCamera: () => last?.presentationCamera ?? null,
		audioListener: () => last?.audioListener ?? null,
		setCharacterPreview: camera => setter( "setCharacterPreview", camera ),
		/*
		================
		characterParticleSnapshot
		================
		*/
		characterParticleSnapshot( gid ) {
			particleRequests.add( gid );
			const snapshot = particleAnswers.get( gid )?.snapshot;
			return snapshot ? { matrix: snapshot.matrix.slice(), regionId: snapshot.regionId } : null;
		},
		/*
		================
		characterParticleTime
		================
		*/
		characterParticleTime( gid ) {
			particleRequests.add( gid );
			return particleAnswers.get( gid )?.time;
		},
		presentationNight: () => last?.presentationNight ?? false,
		characterLocalMatrix: mirror.localMatrix,
		characterMatrix: mirror.matrix,
		characterSocket: mirror.socket,
		/*
		================
		pickEntity

		Also asks the ground pick at this point: a skill aimed at the pointer
		reads it at once (runtime.ts sessionCommand), without a retry.
		================
		*/
		pickEntity( x, y, excluded, blindHeld = false ) {
			pick( "ground", [ x, y ] );
			return pick<number>( "entity", [ x, y, excluded, blindHeld ] );
		},
		/*
		================
		deferPick

		A click whose picks the worker has not answered yet runs again after
		the reply that answers them: the one covering the next frame message,
		which carries the probe's requests.
		================
		*/
		deferPick( probe, retry ) {
			if ( retrying || disposed || failure ) return false;
			missed = false;
			probing = true;
			try {
				probe();
			} finally {
				probing = false;
			}
			if ( !missed ) return false;
			deferredClick = retry;
			// The next frame message carries the probe's requests.
			deferredAfter = sent + 1;
			return true;
		},
		setWeather: value => setter( "setWeather", value ),
		setWorldClock: value => setter( "setWorldClock", value ),
		setUi: scene => queue( "setUiDelta", uiEncoder.encode( scene ) ),
		setDamageText: rows => setter( "setDamageText", rows ),
		/*
		================
		setUiTexture
		================
		*/
		setUiTexture( id, image ) {
			if ( sentUiTextures.get( id ) === image && image ) return;
			if ( image ) sentUiTextures.set( id, image );
			else sentUiTextures.delete( id );
			queue( "setUiTexture", id, image );
		},
		/*
		================
		retainCharacterModels
		================
		*/
		retainCharacterModels( ids ) {
			mirror.retain( ids );
			setter( "retainCharacterModels", ids );
		},
		/*
		================
		setCharacterAssembly
		================
		*/
		setCharacterAssembly( id, base, parts ) {
			mirror.assembly( id, base, parts );
			const asked = assemblyFrames.get( id );
			assemblyFrames.set( id, frameNumber );
			if ( asked !== undefined && frameNumber - asked <= 1 ) return;
			queue( "setCharacterAssembly", id, base, parts );
		},
		/*
		================
		characterStats

		A detailed census is asked for the next frame; until it arrives the
		ordinary one stands in.
		================
		*/
		characterStats( details = false, posed = false ): CharacterStatistics {
			if ( details ) detailedRequest = { posed };
			return (details ? last?.detailedStats : undefined) ?? last?.characterStats ?? mirror.stats();
		},
		/*
		================
		setCharacterModel
		================
		*/
		setCharacterModel( id, model, images ) {
			mirror.model( id, model, images );
			queue( "setCharacterModel", id, model, images );
		},
		/*
		================
		setCharacterAnimation

		The mirror admits the same clip, so its charge is the renderer's.
		================
		*/
		setCharacterAnimation( id, name, clip ) {
			const bytes = mirror.animation( id, name, clip );
			queue( "setCharacterAnimation", id, name, clip );
			return bytes;
		},
		// Only teleports are kept (renderer.ts setTeleportGates): send only them.
		setTeleportGates: entities => setter( "setTeleportGates", entities.filter( e => e.kind === "teleport" ) ),
		/*
		================
		setCharacterActors
		================
		*/
		setCharacterActors( value, portraits ) {
			actors = value;
			queue( "setCharacterActorsDelta", actorEncoder.encode( value ), portraits );
		},
		characterActors: () => actors,
		worldView: () => last?.worldView ?? null,
		setWorld: scene => queue( "setWorld", scene ),
		/*
		================
		adoptWorld

		The lease is taken here; the worker rebuilds it. Terrain parts go by
		id, each sent once.
		================
		*/
		adoptWorld( lease, detail, terrain ) {
			const world = lease.takeWorld();
			queue( "adoptWorld", {
				sceneId: lease.sceneId,
				world,
				detail,
				terrain: terrain?.map( part => {
					const known = partIds.get( part );
					if ( known !== undefined ) return { id: known };
					const id = nextPart++;
					partIds.set( part, id );
					return { id, part };
				} )
			} );
		},
		cancelWorldUpdate: () => queue( "cancelWorldUpdate" ),
		setWorldCamera: camera => queue( "setWorldCamera", camera ),
		/*
		================
		setWorldTexture

		The same image again for a path is not sent (it would be copied).
		================
		*/
		setWorldTexture( path, image, alpha ) {
			if ( sentWorldTextures.get( path ) === image && image ) return;
			sentWorldTextures.set( path, image );
			queue( "setWorldTexture", path, image, alpha );
		},
		neededWorldTextures: () => neededTextures,
		worldStats: () => last?.worldStats ?? EMPTY_WORLD_STATS,
		setGeometryInstances: instances => queue( "setGeometryInstances", instances ),
		setGeometryTransform: transform => queue( "setGeometryTransform", transform ),
		setGeometry: data => queue( "setGeometry", data ),
		setImage: image => queue( "setImage", image ),
		/*
		================
		frame

		Never waits for the worker. While it is MAX_FRAMES_AHEAD messages
		behind, this frame is held: its calls and picks join the next send.
		The probe sees this thread's share; the worker's own time is a count.
		================
		*/
		frame( viewport, timeSeconds?: number, frameId?: number, probe?: RenderFrameProbe ) {
			if ( disposed || failure ) return;
			probe?.renderBegin();
			probe?.renderCount?.( "render thread ms", last?.workerMs ?? 0 );
			probe?.renderCount?.( "render thread replay ms", last?.replayMs ?? 0 );
			// The rate the canvas is presented at; this thread's FPS can be higher.
			probe?.renderCount?.( "render thread frame ms", last?.drawIntervalMs ?? 0 );
			probe?.renderCount?.( "render thread pick ms", last?.pickMs ?? 0 );
			probe?.renderCount?.( "render thread picks", last?.pickCount ?? 0 );
			probe?.renderCount?.( "render thread frames behind", sent - answered );
			probe?.renderCount?.( "render thread gathered", last?.gathered ?? 0 );
			if ( last ) probe?.renderSpans?.( last.stages );
			if ( sent - answered >= MAX_FRAMES_AHEAD ) {
				probe?.renderCount?.( "render thread held", 1 );
				return;
			}
			post( viewport, timeSeconds, frameId );
			probe?.renderMark( "render-thread-send" );
		},
		presentedFrameMs: () => last?.drawIntervalMs || undefined,
		phase: () => failure ? "failed" : disposed ? "disposed" : last?.phase ?? "starting",
		error: () => failure ?? last?.error ?? null,
		/*
		================
		dispose
		================
		*/
		dispose() {
			if ( disposed ) return;
			disposed = true;
			try {
				worker.postMessage( { kind: "dispose", calls } satisfies HostMessage );
			} catch {
				worker.terminate();
			}
			calls = [];
			mirror.dispose( null, null );
		}
	};
}
