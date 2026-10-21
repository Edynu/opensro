/*
===========================================================================

town-crowd-bench.mjs - frame rate of the real client inside a live crowd

Puts the benchmark's scratch character (asd2 on the dev account, created
when the world has none) beside the target character's live position,
boots the dev client uncapped at 1600x900 through the shared harness
(core/client.mjs) and measures one scenario with the crowd in view. Start town-crowd.mjs first so there is
something to draw; this bench never admits players itself.

The crowd moves on its own clocks, so two runs never see the same frames.
Compare runs made back to back (docs/PROFILING.md), and two trees by
pointing SRO_PROBE_CLIENT_NEXT_BASE_URL at the other tree's dev server.

Usage (from apps/client-next):
  node tools/perf/bench/town-crowd-bench.mjs --near NAME [--seconds 5]
       [--walk | --turn | --wiggle | --hover] [--spans] [--counts]
       [--cpu | --trace] [--heap] [--capped] [--frame-limit N] [--clone-cost]
       [--frame-workers off|auto|1|2|4|8] [--monsters CODENAME:COUNT]

--spans adds runtime-stage timings (dense marks add overhead; use them to
explain a frame, not to claim its rate). --counts adds WebGPU commands per
frame (slows the frame; read only its counts). --cpu, --heap and --trace
write captures into temp/artifacts/town-crowd. --clone-cost times what one
frame's character actor list costs to structured-clone and post to a
worker, the per-frame price of a message-based worker design.
--frame-workers starts the page with that Experimental "Worker threads"
setting; the result records the frame workers' state. --monsters tops the
monsters of one reference near the observer up to COUNT with the native GM
/LOADMONSTER (the scratch character is a GM, made /INVINCIBLE first), so
the scene holds players and monsters. GM monsters are ordinary monsters
with no nest: they stay until killed, so a later run finds them and loads
only what is missing. Choose a passive reference, such as MOB_EU_MOVOI
(tactics AggressType 1): an aggressive one fights the crowd.

===========================================================================
*/
import path from "node:path";
import { parseArgs } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
	MISSION_MOVEMENT_FIXTURES,
	ensureMissionBenchmarkFixtureCharacter
} from "../../../../../scripts/lib/missionMovementFixture.mjs";
import { CHARACTER, openClient, closeClient, createCaptures, measure } from "../core/client.mjs";
import { keepGoing, walk, drag, loadCombat, monsterReference, sceneMonsters } from "./scenarios.mjs";

const SHARDS_PATH = new URL( "../../../../server/config/shards.json", import.meta.url );
const OUT_DIR = path.join( "temp", "artifacts", "town-crowd" );
// The observer stands this far from the target, so the crowd fills the view.
const OBSERVER_OFFSET = 60;
// Wiggle: a camera turn of at most WIGGLE_RANGE px each way, WIGGLE_STEP px per input.
const WIGGLE_RANGE = 40;
const WIGGLE_STEP = 3;
// Hover sweeps the middle HOVER_SPAN of the canvas, HOVER_STEP px per input.
const HOVER_SPAN = .6;
const HOVER_STEP = 5;
const INPUT_INTERVAL_MS = 8;
// Clone cost: repetitions averaged per measurement.
const CLONE_REPEATS = 200;

const { values } = parseArgs( {
	options: {
		near: { type: "string" },
		shard: { type: "string", default: "global-official" },
		seconds: { type: "string", default: "5" },
		walk: { type: "boolean", default: false },
		turn: { type: "boolean", default: false },
		wiggle: { type: "boolean", default: false },
		hover: { type: "boolean", default: false },
		spans: { type: "boolean", default: false },
		counts: { type: "boolean", default: false },
		cpu: { type: "boolean", default: false },
		heap: { type: "boolean", default: false },
		trace: { type: "boolean", default: false },
		capped: { type: "boolean", default: false },
		"frame-limit": { type: "string", default: "0" },
		"clone-cost": { type: "boolean", default: false },
		"frame-workers": { type: "string", default: "" },
		monsters: { type: "string", default: "" }
	}
} );
if ( !values.near ) throw Error( "--near NAME: the character the crowd stands around" );
// The Experimental "Worker threads" setting the page starts with; unset
// keeps whatever the profile holds (a fresh profile: off).
const FRAME_WORKER_SETTINGS = { off: "off", auto: "auto", 1: 1, 2: 2, 4: 4, 8: 8 };
const frameWorkers = Object.hasOwn( FRAME_WORKER_SETTINGS, values["frame-workers"] ) ?
	FRAME_WORKER_SETTINGS[values["frame-workers"]] :
	undefined;
if ( values["frame-workers"] && frameWorkers === undefined ) {
	throw Error( "--frame-workers must be one of " + Object.keys( FRAME_WORKER_SETTINGS ).join( ", " ) );
}
const [monsterCodename, monsterCount] = values.monsters ? values.monsters.split( ":" ) : [];
if (
	values.monsters && !(monsterCodename && Number.isInteger( Number( monsterCount ) ) && Number( monsterCount ) > 0)
) {
	throw Error( "--monsters must be CODENAME:COUNT" );
}

/*
================
targetPosition

The live position of the named online character and the shard's player
count, from the shard's loopback observatory.
================
*/
async function targetPosition( name, shardId ) {
	const { shards } = JSON.parse( await readFile( SHARDS_PATH, "utf8" ) );
	const shard = shards.find( row => row.id === shardId );
	if ( !shard ) throw Error( `unknown shard ${shardId}` );
	const response = await fetch( new URL( "/internal/diagnostics/observatory", shard.controlUrl ), {
		headers: { "X-SRO-Local-Diagnostics": "1" }
	} );
	if ( !response.ok ) throw Error( `observatory: HTTP ${response.status} - is the local cluster running?` );
	const { players } = await response.json();
	const player = players.find( row => row.name.toLowerCase() === name.toLowerCase() );
	if ( !player ) throw Error( `${name} is not online on ${shardId}` );
	return { players: players.length, start: { regionId: player.region, x: player.x, y: player.y, z: player.z } };
}

/*
================
cloneCost

What one frame's actor list costs to send to a worker by message: a
structured clone and a MessageChannel post (the receiving side is not
timed). Self-contained for page.evaluate.
================
*/
function cloneCost( repeats ) {
	const actors = globalThis.__benchRuntime.characterActors();
	const channel = new MessageChannel();
	channel.port2.onmessage = () => {};
	const time = run => {
		const started = performance.now();
		for ( let i = 0; i < repeats; i++ ) run();
		return (performance.now() - started) / repeats;
	};
	const result = {
		actors: actors.length,
		cloneMs: time( () => structuredClone( actors ) ),
		postMs: time( () => channel.port1.postMessage( actors ) )
	};
	channel.port1.close();
	return result;
}

/*
================
wiggle

A small camera turn back and forth: the same crowd stays in view, so only
the camera motion differs from standing still.
================
*/
async function wiggle( page, more ) {
	const box = await page.locator( "canvas" ).first().boundingBox();
	const y = box.y + box.height * .45, centre = box.x + box.width / 2;
	let x = centre, step = WIGGLE_STEP;
	await page.mouse.move( x, y );
	await page.mouse.down( { button: "right" } );
	try {
		while ( more() ) {
			x += step;
			if ( Math.abs( x - centre ) > WIGGLE_RANGE ) step = -step;
			await page.mouse.move( x, y );
			await page.waitForTimeout( INPUT_INTERVAL_MS );
		}
	} finally {
		await page.mouse.up( { button: "right" } );
	}
}

/*
================
hover

The pointer sweeps over the crowd with no button held: hover picking only.
================
*/
async function hover( page, more ) {
	const box = await page.locator( "canvas" ).first().boundingBox();
	const y = box.y + box.height * .5;
	const left = box.x + box.width * (1 - HOVER_SPAN) / 2, right = box.x + box.width * (1 + HOVER_SPAN) / 2;
	let x = left, step = HOVER_STEP;
	while ( more() ) {
		x += step;
		if ( x > right || x < left ) step = -step;
		await page.mouse.move( x, y );
		await page.waitForTimeout( INPUT_INTERVAL_MS );
	}
}

/*
================
scenarioOf
================
*/
function scenarioOf() {
	if ( values.walk ) return { name: "walk", drive: walk };
	if ( values.turn ) return { name: "turn", drive: drag };
	if ( values.wiggle ) return { name: "wiggle", drive: wiggle };
	if ( values.hover ) return { name: "hover", drive: hover };
	return { name: "still", drive: keepGoing };
}

/*
================
topUpMonsters

Brings the live monsters of codename near the observer up to count,
loading only the missing ones. Returns how many are near.
================
*/
async function topUpMonsters( page, codename, count ) {
	const refObjId = await monsterReference( page, codename );
	if ( refObjId === null ) throw Error( `no monster ${codename} in the published manifest` );
	const near = (await sceneMonsters( page )).filter( monster => monster.refObjId === refObjId ).length;
	if ( near < count ) {
		await loadCombat( page, { codename, count: count - near, type: "NORMAL", vulnerable: false } );
	}
	return (await sceneMonsters( page )).filter( monster => monster.refObjId === refObjId ).length;
}

// ============================================================================

const target = await targetPosition( values.near, values.shard );
const start = { ...target.start, z: Math.max( 0, target.start.z - OBSERVER_OFFSET ) };
const fixture = { ...MISSION_MOVEMENT_FIXTURES.movement, id: "town-crowd-observer", start };
const scenario = scenarioOf();
console.log(
	`[bench] ${target.players} players online; observer at region ${start.regionId} (${start.x.toFixed( 0 )}, ${
		start.z.toFixed( 0 )
	})`
);
await mkdir( OUT_DIR, { recursive: true } );
// A fresh world has no scratch character; create it through the ordinary contract.
await ensureMissionBenchmarkFixtureCharacter( {
	characterName: CHARACTER,
	onLog: line => console.log( `[bench] ${line}` )
} );
const client = await openClient( fixture, {
	counts: values.counts,
	spans: values.spans,
	uncapped: !values.capped,
	frameLimit: Number( values["frame-limit"] ),
	lineInfo: values.cpu,
	experimental: frameWorkers === undefined ? undefined : { frameWorkers }
} );
try {
	const monsters = monsterCodename ? await topUpMonsters( client.page, monsterCodename, Number( monsterCount ) ) : 0;
	if ( monsterCodename ) console.log( `[bench] ${monsters} ${monsterCodename} near the observer` );
	const clone = values["clone-cost"] ? await client.page.evaluate( cloneCost, CLONE_REPEATS ) : null;
	if ( clone ) console.log( `[bench] clone cost ${JSON.stringify( clone )}` );
	const captures = await createCaptures( client.page, {
		dir: OUT_DIR,
		cpu: values.cpu,
		heap: values.heap,
		trace: values.trace ? path.join( OUT_DIR, `crowd-${scenario.name}.json` ) : null
	} );
	await captures.start();
	const row = await measure(
		client.page,
		`crowd-${scenario.name}`,
		Number( values.seconds ) * 1000,
		more => scenario.drive( client.page, more )
	);
	const allocated = await captures.stop( `crowd-${scenario.name}` );
	await captures.finish();
	// Which actors animate on the GPU and which need CPU palettes, and the batch census.
	const characters = await client.page.evaluate( () => globalThis.__benchRuntime.characterStats() );
	const workers = await client.page.evaluate( () => ({
		isolated: globalThis.crossOriginIsolated,
		...globalThis.__benchRuntime.frameWorkers()
	}) );
	console.log(
		`crowd/${scenario.name} ${row.fps.toFixed( 0 )} fps  frame p50 ${row.p50.toFixed( 2 )} p99 ${
			row.p99.toFixed( 2 )
		} max ${row.max.toFixed( 1 )} ms  main ${row.main.toFixed( 2 )} world ${row.world.toFixed( 2 )} ms/f`
	);
	if ( allocated !== null ) console.log( `[bench] sampled allocation ${(allocated / 1024).toFixed( 0 )} KB` );
	console.log( JSON.stringify( row.counts ) );
	console.log( JSON.stringify( characters ) );
	console.log( `[bench] frame workers ${JSON.stringify( workers )}` );
	await writeFile(
		path.join( OUT_DIR, `crowd-${scenario.name}.result.json` ),
		JSON.stringify(
			{ players: target.players, scenario: scenario.name, row, characters, clone, allocated },
			null,
			"\t"
		)
	);
} finally {
	await closeClient( client );
}
