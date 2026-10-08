/*
===========================================================================

entry.ts - the render thread: the real renderer on an OffscreenCanvas

Port-only, not native (Experimental "Render thread"). Owns the renderer
the main thread's proxy (host.ts) stands in for. Frame messages are
gathered into an inbox; a draw replays every gathered message's calls in
order, draws the newest frame, and answers with the renderer's readable
state, the pointer picks and the particle snapshots the messages asked
for. The main thread never waits for a reply: a draw slower than the main
thread's frame gathers several messages into one, so the worker draws at
its own rate instead of the two threads taking turns.

The presentation random sequence here is the worker's own (seeded by the
host): renderer draws (cloth gusts, particles) no longer interleave with
the main thread's presentation draws in one sequence.

===========================================================================
*/
import type { Renderer } from "@/engine/contracts/runtime";
import type { SoundEvent } from "@/engine/contracts/audio";
import type { WorldTerrainPart } from "@/engine/contracts/world-admission";
import { createRenderer } from "../renderer";
import { createPresentationRandom } from "@/engine/runtime/random/random";
import { createStageProbe } from "@/engine/runtime/stage-probe";
import {
	createActorDecoder,
	createUiDecoder,
	type ActorFrame,
	type UiFrame
} from "@/engine/foundation/rendering/render-thread-delta";
import type {
	AdoptWorldCall,
	HostMessage,
	PickRequest,
	RenderCall,
	RenderReply,
	WorkerMessage
} from "@/engine/contracts/render-thread";

// Adoptions a terrain part outlives after its last mention: the world owner
// keeps the previous scene while the next one prepares.
const TERRAIN_PART_ADOPTIONS = 4;

const port = globalThis as unknown as {
	onmessage: (( event: MessageEvent<HostMessage> ) => void) | null;
	postMessage( message: WorkerMessage ): void;
	close(): void;
};
let renderer: Renderer | null = null, failure: string | null = null, disposed = false;
const sounds: SoundEvent[] = [];
const parts = new Map<number, { part: WorldTerrainPart; adoption: number; }>();
let adoptions = 0, sentScenery: unknown = undefined, sentTextures = "";
type FrameMessage = Extract<HostMessage, { kind: "frame"; }>;
// Frame messages not yet drawn, a draw in progress, and a draw timer set.
let inbox: FrameMessage[] = [], drawing = false, scheduled = false;
// When the previous draw started: the interval between draws is the rate
// the canvas is actually presented at.
let lastDrawAt = 0;
// The worker's display clock (Chrome and Firefox give a dedicated worker
// requestAnimationFrame for its OffscreenCanvas): a draw in its callback
// presents in step with the display, instead of whenever a message lands.
const displayFrame = (globalThis as { requestAnimationFrame?: ( callback: () => void ) => number; })
	.requestAnimationFrame?.bind( globalThis );
// The renderer's own stage times, sent with each reply for the main panel.
const stages = createStageProbe();
const actorDecoder = createActorDecoder(), uiDecoder = createUiDecoder();

/*
================
sendToHost
================
*/
function sendToHost( message: WorkerMessage ) {
	port.postMessage( message );
}

/*
================
closePort
================
*/
function closePort() {
	port.close();
}

/*
================
fail
================
*/
function fail( error: unknown ) {
	failure ??= error instanceof Error ? error.message : String( error );
	sendToHost( { kind: "failed", message: failure } );
}

/*
================
adoptWorld

Rebuild the lease the main thread took, and its terrain parts by id.
================
*/
function adoptWorld( call: AdoptWorldCall ) {
	adoptions++;
	const terrain = call.terrain?.map( row => {
		const known = parts.get( row.id ) ?? (row.part ? { part: row.part, adoption: adoptions } : undefined);
		if ( !known ) throw Error( "Render thread terrain part " + row.id + " was never sent" );
		known.adoption = adoptions;
		parts.set( row.id, known );
		return known.part;
	} );
	for ( const [id, row] of parts ) if ( adoptions - row.adoption > TERRAIN_PART_ADOPTIONS ) parts.delete( id );
	const world = call.world;
	renderer!.adoptWorld(
		{ sceneId: call.sceneId, takeWorld: () => world },
		call.detail as Parameters<Renderer["adoptWorld"]>[1],
		terrain
	);
}

/*
================
freezeRuns

A UiScene's text runs are deeply frozen by their producer and the
renderer admits only frozen ones; a structured clone arrives unfrozen.
================
*/
function freezeRuns( scene: import("@/engine/contracts/ui").UiScene | null ) {
	for ( const quad of scene?.quads ?? [] ) {
		const run = quad.run;
		if ( !run || Object.isFrozen( run ) ) continue;
		for ( const glyph of run.glyphs ) {
			Object.freeze( glyph.uv );
			Object.freeze( glyph );
		}
		Object.freeze( run.glyphs );
		Object.freeze( run );
	}
}

/*
================
replay

The runtime's calls in order. A call that throws is reported and the
rest still run: the main thread already returned from it.
================
*/
function replay( calls: readonly RenderCall[] ) {
	for ( const call of calls ) {
		try {
			if ( call.method === "adoptWorld" ) adoptWorld( call.args[0] as AdoptWorldCall );
			else if ( call.method === "setUiDelta" ) {
				const scene = uiDecoder.decode( call.args[0] as UiFrame );
				freezeRuns( scene );
				renderer!.setUi( scene );
			} else if ( call.method === "setCharacterActorsDelta" ) {
				renderer!.setCharacterActors(
					actorDecoder.decode( call.args[0] as ActorFrame ),
					call.args[1] as Parameters<Renderer["setCharacterActors"]>[1]
				);
			} else {
				const method = (renderer as unknown as Record<string, ( ...args: unknown[] ) => unknown>)[call.method];
				if ( typeof method !== "function" ) throw Error( "Unknown render thread call " + call.method );
				method( ...call.args );
			}
		} catch ( error ) {
			console.error( "[SRO render thread] " + call.method + " failed:", error );
		}
	}
}

/*
================
answer

One pointer pick, with the renderer the main thread would have asked.
================
*/
function answer( request: PickRequest ): unknown {
	const r = renderer!, a = request.args as number[];
	switch ( request.kind ) {
		case "entity":
			return r.pickEntity( a[0]!, a[1]!, a[2]!, request.args[3] as boolean );
		case "ground":
			return r.pickGround( a[0]!, a[1]! );
		case "destination":
			return r.pickDestination( a[0]!, a[1]! );
		case "frontend-character":
			return r.pickFrontendCharacter( a[0]!, a[1]!, request.args[2] as number[] );
		case "frontend-race":
			return r.pickFrontendRace( a[0]!, a[1]! );
	}
}

/*
================
reply

The renderer's readable state after a draw, with the answers every
gathered message asked for.
================
*/
function reply( gathered: readonly FrameMessage[], workerMs: number, replayMs: number ): RenderReply {
	const r = renderer!, newest = gathered[gathered.length - 1]!;
	const scenery = r.scenery(), textures = r.neededWorldTextures(), textureKey = textures.join( "\n" );
	const picks = new Map<string, PickRequest>(), particles = new Set<number>();
	let detailed: FrameMessage["detailedStats"];
	const picksStarted = performance.now();
	for ( const message of gathered ) {
		for ( const request of message.picks ) {
			if ( message === newest || request.required ) picks.set( request.key, request );
		}
		for ( const gid of message.particles ) particles.add( gid );
		detailed = message.detailedStats ?? detailed;
	}
	const answered = [ ...picks.values() ].map( request => [ request.key, answer( request ) ] as const );
	const pickMs = performance.now() - picksStarted;
	const result: RenderReply = {
		drawIntervalMs: 0,
		pickMs,
		pickCount: answered.length,
		sequence: newest.sequence,
		gathered: gathered.length,
		phase: r.phase(),
		error: failure ?? r.error(),
		readbackWaitMs: r.readbackWaitMs?.() ?? 0,
		gpuTiming: r.gpuTiming(),
		worldStats: r.worldStats(),
		characterStats: r.characterStats(),
		detailedStats: detailed ? r.characterStats( true, detailed.posed ) : undefined,
		worldView: r.worldView(),
		presentationCamera: r.presentationCamera(),
		audioListener: r.audioListener(),
		presentationNight: r.presentationNight(),
		frontendRaceCenters: r.frontendRaceCenters(),
		scenery: scenery === sentScenery ? undefined : scenery,
		neededTextures: textureKey === sentTextures ? undefined : textures,
		picks: answered,
		particles: [ ...particles ].map( gid =>
			[ gid, r.characterParticleSnapshot( gid ), r.characterParticleTime( gid ) ] as const
		),
		workerMs,
		replayMs,
		stages: stages.take( 1 )
	};
	sentScenery = scenery;
	sentTextures = textureKey;
	return result;
}

/*
================
draw

Replay every gathered message in order, then draw the newest frame. A
draw that waits on the GPU (a deferred particle query) holds the inbox
until it ends: the renderer takes no calls inside a frame.
================
*/
async function draw() {
	scheduled = false;
	if ( drawing || !inbox.length || !renderer || disposed ) return;
	drawing = true;
	const gathered = inbox;
	inbox = [];
	try {
		const started = performance.now(), interval = lastDrawAt ? started - lastDrawAt : 0;
		lastDrawAt = started;
		for ( const message of gathered ) replay( message.calls );
		const replayed = performance.now(), newest = gathered[gathered.length - 1]!;
		const pending = renderer.frame( newest.viewport, newest.timeSeconds, newest.frameId, stages.probe );
		if ( pending ) await pending;
		if ( disposed ) return;
		if ( sounds.length ) sendToHost( { kind: "sound", events: sounds.splice( 0 ) } );
		sendToHost( {
			kind: "reply",
			frameId: newest.frameId,
			reply: { ...reply( gathered, performance.now() - started, replayed - started ), drawIntervalMs: interval }
		} );
	} finally {
		drawing = false;
	}
	if ( inbox.length ) schedule();
}

/*
================
schedule

The draw runs on the next display frame (or, without a worker display
clock, as its own task), after the frame messages already queued behind
this one: they join its inbox instead of each drawing.
================
*/
function schedule() {
	if ( scheduled || drawing ) return;
	scheduled = true;
	const run = () => void draw().catch( fail );
	if ( displayFrame ) displayFrame( run );
	else setTimeout( run, 0 );
}

port.onmessage = event => {
	const message = event.data;
	try {
		if ( message.kind === "start" ) {
			renderer = createRenderer(
				message.canvas,
				createPresentationRandom( message.seed ),
				event => void sounds.push( event ),
				{ ...message.diagnostics, renderThread: false }
			);
			return;
		}
		if ( !renderer || disposed ) return;
		if ( message.kind === "dispose" ) {
			disposed = true;
			for ( const queued of inbox ) replay( queued.calls );
			inbox = [];
			replay( message.calls );
			renderer.dispose();
			closePort();
			return;
		}
		inbox.push( message );
		schedule();
	} catch ( error ) {
		fail( error );
	}
};
