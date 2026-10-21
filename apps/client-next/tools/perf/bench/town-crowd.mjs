/*
===========================================================================

town-crowd.mjs - hold a live crowd of varied players around your character

Admits up to MAX_COUNT throwaway players into the local cluster and keeps
them in world until Ctrl+C, so the real client can be measured inside a
town-sized crowd (town-crowd-bench.mjs). core/crowd.mjs serves the 32-peer
acceptance benches; this tool exists for crowds of hundreds.

Every player is a real account with a real character on a real GameWorld
socket, created through the ordinary character-create contract with a
random model (all 52 Chinese and European roster models), height, volume,
weapon and armor, so the renderer sees many distinct batches instead of one
repeated model.

The players start in rings around the live position of the target
character (read from the shard's loopback observatory), so they are on
screen as soon as they enter. Each uses the beginner's speed scroll (the
starter kit's, used again every 20 minutes), then walks to a random point
near its spot every few seconds and casts Fire Force (River Fire Force,
skill 124, a self-cast weapon imbue) at random. --still keeps them standing.

Logins run LOGIN_CONCURRENCY at a time. The Agent rate-limits logins per
client address (burst 10, then one per 6 s) and takes that address from
X-Forwarded-For only on its loopback listener, where the local TLS edge
sits (server.go clientIP). This local-only tool declares a private address
per player there, so 200 players enter in seconds instead of 20 minutes.
A network client cannot do the same: its forwarding headers are ignored.

Ctrl+C or closing the window logs them out and disables the throwaway
accounts. A run that was killed outright is swept at the next start, from
the journal in the main checkout's .state/town-crowd.

Usage (from apps/client-next, with the local cluster up and the target
character logged in):
  node tools/perf/bench/town-crowd.mjs --near NAME [--count 200] [--shard global-official] [--still]

===========================================================================
*/
import assert from "node:assert/strict";
import { parseArgs } from "node:util";
import { readFile, writeFile, readdir, mkdir, unlink } from "node:fs/promises";
import { randomBytes, randomInt } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { createCodec } from "../../../src/engine/runtime/simulation/worker/network/codec/codec.ts";
import {
	validateProbeSessionRoute,
	resolveShardTransportUrl,
	fetchProbeSessionJson,
	mintProbeTransportAdmissionToken,
	mintProbeEnterWorldToken
} from "../../../../../scripts/lib/probeSession.mjs";
import { probeAgentUrl } from "../../../../../scripts/lib/probeEndpoints.mjs";
import { BENCHMARK_FIXTURE_RESET_PATH } from "../../../../../scripts/lib/missionMovementFixture.mjs";
import { MAIN_CHECKOUT_ROOT } from "../../../../../scripts/lib/generatedRoot.mjs";
import { serverGameDataRoot } from "../../../../../scripts/build/world/paths.mjs";
import { RELEASE_PROTOCOL, RELEASE_PROTOCOL_HEADER } from "../../../src/engine/foundation/release/protocol.ts";

const MAX_COUNT = 1000;
// Logins in flight: the Agent hashes at most 16 passwords at once.
const LOGIN_CONCURRENCY = 12;
const PROVISIONING_URL = "http://127.0.0.1:8789";
// The local cluster's state is the main checkout's, shared by every worktree.
const TOKEN_PATH = path.join( MAIN_CHECKOUT_ROOT, "apps", "server", ".state", "cluster", "agent-provisioning-token" );
const JOURNAL_DIR = path.join( MAIN_CHECKOUT_ROOT, ".state", "town-crowd" );
const SHARDS_PATH = new URL( "../../../../server/config/shards.json", import.meta.url );
const REQUEST_TIMEOUT_MS = 30000;
const MAX_LOGIN_RETRIES = 40;
const DEFAULT_RETRY_AFTER_S = 1;

// Region geometry: a region id is (z cell << 8) | x cell, each cell 1920
// units square. Dungeon regions (high bit) have no neighbours to wrap into.
const REGION_SIZE = 1920;
const DUNGEON_REGION_BIT = 0x8000;

// Rings around the target: the first holds 8 players 20 units out, each
// further ring 15 units wider and 4 players larger.
const FIRST_RING_RADIUS = 20;
const RING_SPACING = 15;
const FIRST_RING_SIZE = 8;
const RING_GROWTH = 4;

// Creation choices the server accepts (enterworld/loadout.go):
// heights and volumes 0..4; China weapons 1..5 with armor 0..3 (0 = none);
// Europe weapons 1..9, armor required, limited by weapon class.
const BODY_INDICES = 5;
const CHINA_WEAPONS = 5;
const CHINA_PROTECTORS = 3;
const EUROPE_PROTECTORS_BY_WEAPON = [ 0, 1, 2, 2, 2, 1, 1, 1, 1, 2 ];
const MODEL_CATALOG = path.join( serverGameDataRoot, "character-authority", "catalog.json" );

// Wire opcodes of this port (not the retail numbers).
const OP_MOVE = 0x7738;
const OP_TARGET_ACTION = 0x72cd;
const OP_ITEM_USE = 0x75bd;
const OP_ITEM_USE_ACK = 0xb5bd;
// River Fire Force: SKILL_CH_FIRE_GIGONGTA_A_01, a self-cast imbue (5 s reuse).
const FIRE_FORCE_SKILL = 124;
// Fixture loadout: a level and intellect with MP for the imbue.
const CROWD_LEVEL = 20;
const CROWD_INTELLECT = 100;
// ITEM_ETC_SPEED_UP_BASIC (refObjId 24198), type ids 3/3/13/1. The buff
// lasts longer than this, so it is used again before it runs out.
const SPEED_SCROLL_TYPE = 0x0eec;
const SPEED_SCROLL_EVERY_MS = 20 * 60 * 1000;
// Bag slots searched for the starter kit's scroll (equipment ends at 13).
const BAG_FIRST_SLOT = 13;
const BAG_SEARCH_SLOTS = 32;
const ITEM_USE_REPLY_MS = 1500;
// Behaviour: a new walk target within WALK_RADIUS of the spot every
// WALK_MIN_MS..WALK_MAX_MS; Fire Force on CAST_CHANCE of those turns.
const WALK_RADIUS = 40;
const WALK_MIN_MS = 2000;
const WALK_MAX_MS = 7000;
const CAST_CHANCE = 0.35;
const REGION_EDGE = 2;

const { values } = parseArgs( {
	options: {
		count: { type: "string", default: "200" },
		near: { type: "string" },
		shard: { type: "string", default: "global-official" },
		still: { type: "boolean", default: false }
	}
} );
if ( !values.near ) throw Error( "--near NAME: the logged-in character the crowd gathers around" );
const count = Number( values.count );
if ( !Number.isInteger( count ) || count < 1 || count > MAX_COUNT ) throw Error( `--count must be 1..${MAX_COUNT}` );

/*
================
provisioner

Loopback provisioning calls with the bootstrap's token.
================
*/
async function provisioner() {
	const token = (await readFile( TOKEN_PATH, "utf8" )).trim();
	return async ( route, method, body ) => {
		const response = await fetch( new URL( route, PROVISIONING_URL ), {
			method,
			headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
			body: JSON.stringify( body ),
			signal: AbortSignal.timeout( REQUEST_TIMEOUT_MS )
		} );
		if ( !response.ok ) {
			throw Error( `provisioning ${method} ${route}: HTTP ${response.status} ${await response.text()}` );
		}
	};
}

/*
================
sweepAbandonedRuns

Disables the accounts of earlier runs whose process is gone (killed
without its Ctrl+C cleanup). A run that is still alive keeps its crowd.
================
*/
async function sweepAbandonedRuns( provision ) {
	await mkdir( JOURNAL_DIR, { recursive: true } );
	for ( const name of await readdir( JOURNAL_DIR ) ) {
		if ( !/^run-.*\.json$/.test( name ) ) continue;
		const file = path.join( JOURNAL_DIR, name );
		const journal = JSON.parse( await readFile( file, "utf8" ) );
		if ( processAlive( journal.pid ) ) continue;
		for ( const id of journal.accounts ) {
			await provision( `/v1/accounts/${id}/disabled`, "PUT", { disabled: true } ).catch( error =>
				console.log( `[crowd] could not disable ${id}: ${error.message}` )
			);
		}
		if ( journal.accounts.length ) console.log( `[crowd] swept ${journal.accounts.length} accounts of an old run` );
		await unlink( file );
	}
}

/*
================
processAlive
================
*/
function processAlive( pid ) {
	try {
		process.kill( pid, 0 );
		return true;
	} catch ( error ) {
		return error.code === "EPERM";
	}
}

/*
================
targetPosition

The live position of the named online character, from the shard's
loopback observatory.
================
*/
async function targetPosition( name, shardId ) {
	const { shards } = JSON.parse( await readFile( SHARDS_PATH, "utf8" ) );
	const shard = shards.find( row => row.id === shardId );
	if ( !shard ) throw Error( `unknown shard ${shardId}` );
	const response = await fetch( new URL( "/internal/diagnostics/observatory", shard.controlUrl ), {
		headers: { "X-SRO-Local-Diagnostics": "1" },
		signal: AbortSignal.timeout( REQUEST_TIMEOUT_MS )
	} );
	if ( !response.ok ) throw Error( `observatory: HTTP ${response.status} - is the local cluster running?` );
	const { players } = await response.json();
	const player = players.find( row => row.name.toLowerCase() === name.toLowerCase() );
	if ( !player ) throw Error( `${name} is not online on ${shardId}: log in first, then run the crowd` );
	return { regionId: player.region, x: player.x, y: player.y, z: player.z };
}

/*
================
ringSpot

Place number index on the rings around the target, wrapping into the
neighbouring region when a spot crosses the region edge.
================
*/
function ringSpot( target, index ) {
	let ring = 0, first = 0, size = FIRST_RING_SIZE;
	while ( index >= first + size ) {
		first += size;
		ring++;
		size += RING_GROWTH;
	}
	const radius = FIRST_RING_RADIUS + ring * RING_SPACING;
	// Offset alternate rings by half a step so nobody stands behind a neighbour.
	const angle = (index - first + (ring % 2) * 0.5) / size * Math.PI * 2;
	let cellX = target.regionId & 0xff, cellZ = (target.regionId >>> 8) & 0xff;
	let x = target.x + Math.cos( angle ) * radius, z = target.z + Math.sin( angle ) * radius;
	if ( target.regionId & DUNGEON_REGION_BIT ) {
		x = Math.min( Math.max( x, 0 ), REGION_SIZE );
		z = Math.min( Math.max( z, 0 ), REGION_SIZE );
	} else {
		if ( x < 0 ) (x += REGION_SIZE, cellX--);
		if ( x >= REGION_SIZE ) (x -= REGION_SIZE, cellX++);
		if ( z < 0 ) (z += REGION_SIZE, cellZ--);
		if ( z >= REGION_SIZE ) (z -= REGION_SIZE, cellZ++);
	}
	return {
		regionId: (target.regionId & DUNGEON_REGION_BIT) | (cellZ << 8) | cellX,
		x,
		y: target.y,
		z,
		angle: randomInt( 0x10000 )
	};
}

/*
================
randomLook

A random model and a creation choice the server accepts for its race.
================
*/
function randomLook( models ) {
	const modelCodename = models[randomInt( models.length )];
	const look = {
		modelCodename,
		heightIndex: randomInt( BODY_INDICES ),
		volumeIndex: randomInt( BODY_INDICES ),
		weaponSelected: true
	};
	if ( modelCodename.startsWith( "CHAR_EU_" ) ) {
		const weapon = 1 + randomInt( EUROPE_PROTECTORS_BY_WEAPON.length - 1 );
		const protector = 1 + randomInt( EUROPE_PROTECTORS_BY_WEAPON[weapon] );
		return { ...look, weaponIndex: weapon, protectorIndex: protector, armorSelected: true };
	}
	const protector = randomInt( CHINA_PROTECTORS + 1 );
	return {
		...look,
		weaponIndex: 1 + randomInt( CHINA_WEAPONS ),
		protectorIndex: protector,
		armorSelected: protector > 0
	};
}

/*
================
createLoginGate

Logins LOGIN_CONCURRENCY at a time. Each declares its own private client
address, so the Agent's per-IP login budget never makes one wait; a busy
answer (all password slots taken) is retried shortly.
================
*/
function createLoginGate( divisionId ) {
	let running = 0;
	const waiting = [];
	return async ( loginId, loginPassword, index ) => {
		if ( running >= LOGIN_CONCURRENCY ) await new Promise( resolve => waiting.push( resolve ) );
		running++;
		try {
			for ( let tries = 0;; tries++ ) {
				const response = await fetch( probeAgentUrl( "/title/login" ), {
					method: "POST",
					headers: {
						"content-type": "application/json",
						[RELEASE_PROTOCOL_HEADER]: String( RELEASE_PROTOCOL ),
						"x-forwarded-for": `10.77.${(index >>> 8) & 255}.${index & 255}`
					},
					body: JSON.stringify( { id: loginId, password: loginPassword, serverId: divisionId } ),
					signal: AbortSignal.timeout( REQUEST_TIMEOUT_MS )
				} );
				const body = await response.json().catch( () => null );
				if ( response.ok ) {
					const session = validateProbeSessionRoute( body, divisionId );
					return { ...session, transportUrl: resolveShardTransportUrl( divisionId, session.transportUrl ) };
				}
				if ( (response.status !== 429 && response.status !== 503) || tries >= MAX_LOGIN_RETRIES ) {
					throw Error( `login ${loginId}: HTTP ${response.status} ${JSON.stringify( body )}` );
				}
				await delay( 1000 * (Number( response.headers.get( "retry-after" ) ) || DEFAULT_RETRY_AFTER_S) );
			}
		} finally {
			running--;
			waiting.shift()?.();
		}
	};
}

/*
================
connectPeer

Enter the world over the GameWorld WebSocket with the production codec,
as tools/perf/core/crowd.mjs does. After admission, socket.reply (when
set) sees every frame.
================
*/
async function connectPeer( session, character ) {
	const admission = await mintProbeTransportAdmissionToken( session );
	const enter = await mintProbeEnterWorldToken( session, character );
	const endpoint = new URL( session.transportUrl );
	endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
	endpoint.pathname = endpoint.pathname.replace( /\/$/, "" ) + "/transport/ws";
	const socket = new WebSocket( endpoint );
	socket.binaryType = "arraybuffer";
	await new Promise( ( resolve, reject ) => {
		let ready = false;
		const timer = setTimeout( () => reject( Error( "peer admission timed out" ) ), REQUEST_TIMEOUT_MS );
		const fail = message => {
			clearTimeout( timer );
			reject( Error( message ) );
		};
		socket.onopen = () => socket.send( codec.encode( codec.hello( admission ) ) );
		socket.onerror = () => fail( "peer transport failed" );
		socket.onclose = () => {
			if ( !ready ) fail( "peer closed before admission" );
			else console.log( `[crowd] ${character} was disconnected` );
		};
		socket.onmessage = event => {
			try {
				const frame = codec.decode( new Uint8Array( event.data ) );
				if ( frame.opcode === 2 ) {
					codec.welcome( frame.payload );
					socket.send( codec.encode( codec.enterWorld( session.divisionId, character, enter ) ) );
				} else if ( frame.opcode === 3 ) {
					socket.send( codec.encode( { opcode: 4, payload: frame.payload } ) );
				} else if ( frame.opcode === 7 ) {
					assert.ok( frame.payload.length >= 9 && frame.payload[0] === 1, "EnterWorld accepted" );
					socket.send( codec.encode( { opcode: 0x3012, payload: new Uint8Array() } ) );
					ready = true;
					clearTimeout( timer );
					resolve();
				} else if ( frame.opcode === 5 ) {
					fail( "peer received server goodbye" );
				} else if ( ready ) {
					socket.reply?.( frame );
				}
			} catch ( error ) {
				fail( String( error ) );
			}
		};
	} );
	return socket;
}

// ============================================================================
//
// Behaviour: speed scroll, walking and Fire Force over the peer's socket.
//
// ============================================================================

/*
================
send
================
*/
function send( socket, opcode, bytes ) {
	if ( socket.readyState !== WebSocket.OPEN ) return;
	socket.send( codec.encode( { opcode, payload: Uint8Array.from( bytes ) } ) );
}

/*
================
useSpeedScroll

Use the starter kit's speed scroll. Its bag slot is not tracked here, so
each slot is tried until one answers 0xB5BD success (a wrong slot or type
is refused). Returns the slot for the next use, or -1.
================
*/
async function useSpeedScroll( socket, known = -1 ) {
	const slots = known >= 0 ?
		[ known ] :
		Array.from( { length: BAG_SEARCH_SLOTS }, ( _, i ) => BAG_FIRST_SLOT + i );
	for ( const slot of slots ) {
		const answer = new Promise( resolve => {
			const timer = setTimeout( () => resolve( false ), ITEM_USE_REPLY_MS );
			socket.reply = frame => {
				if ( frame.opcode !== OP_ITEM_USE_ACK ) return;
				clearTimeout( timer );
				resolve( frame.payload[0] === 1 );
			};
		} );
		send( socket, OP_ITEM_USE, [ slot, SPEED_SCROLL_TYPE & 255, SPEED_SCROLL_TYPE >>> 8 ] );
		const used = await answer;
		socket.reply = undefined;
		if ( used ) return slot;
	}
	return -1;
}

/*
================
walkTo

A ground move to a random point near the spot, within its region:
0x7738 [1][u16 region][i16 x][i16 y][i16 z], region-local units.
================
*/
function walkTo( socket, spot ) {
	const angle = Math.random() * Math.PI * 2, distance = Math.random() * WALK_RADIUS;
	const clamp = value => Math.round( Math.min( Math.max( value, REGION_EDGE ), REGION_SIZE - REGION_EDGE ) );
	const body = new DataView( new ArrayBuffer( 9 ) );
	body.setUint8( 0, 1 );
	body.setUint16( 1, spot.regionId, true );
	body.setInt16( 3, clamp( spot.x + Math.cos( angle ) * distance ), true );
	body.setInt16( 5, Math.round( spot.y ), true );
	body.setInt16( 7, clamp( spot.z + Math.sin( angle ) * distance ), true );
	send( socket, OP_MOVE, new Uint8Array( body.buffer ) );
}

/*
================
castFireForce

0x72CD skill action without a target: [1][4][u32 skill][0].
================
*/
function castFireForce( socket ) {
	const skill = FIRE_FORCE_SKILL;
	send( socket, OP_TARGET_ACTION, [ 1, 4, skill & 255, (skill >>> 8) & 255, (skill >>> 16) & 255, skill >>> 24, 0 ] );
}

/*
================
live

One player's loop: the speed scroll now and every SPEED_SCROLL_EVERY_MS,
then walk turns at random intervals, some of them casting Fire Force.
================
*/
async function live( socket, spot ) {
	let slot = await useSpeedScroll( socket );
	if ( slot < 0 ) console.log( "[crowd] a player found no speed scroll (is the beta starter kit on?)" );
	let scrollAt = Date.now();
	while ( !closing && socket.readyState === WebSocket.OPEN ) {
		await delay( WALK_MIN_MS + Math.random() * (WALK_MAX_MS - WALK_MIN_MS) );
		if ( slot >= 0 && Date.now() - scrollAt >= SPEED_SCROLL_EVERY_MS ) {
			slot = await useSpeedScroll( socket, slot );
			scrollAt = Date.now();
		}
		if ( Math.random() < CAST_CHANCE ) castFireForce( socket );
		walkTo( socket, spot );
	}
}

// ============================================================================

const codec = createCodec();
const provision = await provisioner();
await sweepAbandonedRuns( provision );
const target = await targetPosition( values.near, values.shard );
const { models: catalog } = JSON.parse( await readFile( MODEL_CATALOG, "utf8" ) );
const models = catalog.map( row => row.codename );
const prefix = randomBytes( 3 ).toString( "hex" );
const journalFile = path.join( JOURNAL_DIR, `run-${prefix}.json` );
const accounts = [], sockets = [];
const login = createLoginGate( values.shard );
const journal = () => writeFile( journalFile, JSON.stringify( { pid: process.pid, accounts }, null, 2 ) );
await journal();
let closing = false;

console.log(
	`[crowd] ${values.near} is in region ${target.regionId} at (${target.x.toFixed( 0 )}, ${target.z.toFixed( 0 )})`
);
console.log( `[crowd] admitting ${count} players, ${LOGIN_CONCURRENCY} logins at a time` );

/*
================
admit

One fake player end to end: account, character, spot, loadout, world
entry, then its behaviour loop.
================
*/
async function admit( index ) {
	const id = `crowd${prefix}${index}`, password = randomBytes( 24 ).toString( "hex" );
	const character = `C${prefix}${index}`, look = randomLook( models ), spot = ringSpot( target, index );
	await provision( "/v1/accounts", "POST", { id, password } );
	accounts.push( id );
	await journal();
	const session = await login( id, password, index );
	await fetchProbeSessionJson( session, "/character/create", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify( { characterName: character, ...look } )
	} );
	await fetchProbeSessionJson( session, BENCHMARK_FIXTURE_RESET_PATH, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify( {
			characterName: character,
			fixtureId: "town-crowd",
			movementMode: 3,
			spawn: spot,
			loadout: { level: CROWD_LEVEL, intellect: CROWD_INTELLECT, skills: [ FIRE_FORCE_SKILL ] }
		} )
	} );
	const socket = await connectPeer( session, character );
	sockets.push( socket );
	console.log( `[crowd] ${sockets.length}/${count} ${character} ${look.modelCodename}` );
	if ( !values.still ) live( socket, spot ).catch( error => console.log( `[crowd] ${character}: ${error.message}` ) );
}

/*
================
shutdown

Log every player out and disable this run's accounts, once.
================
*/
async function shutdown() {
	if ( closing ) return;
	closing = true;
	console.log( "[crowd] removing the players..." );
	for ( const socket of sockets ) socket.close();
	for ( const id of accounts ) {
		await provision( `/v1/accounts/${id}/disabled`, "PUT", { disabled: true } ).catch( error =>
			console.log( `[crowd] could not disable ${id}: ${error.message}` )
		);
	}
	await unlink( journalFile ).catch( () => {} );
	process.exit( 0 );
}
// SIGINT is Ctrl+C, SIGBREAK Ctrl+Break, SIGHUP the console window closing.
for ( const signal of [ "SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP" ] ) process.on( signal, shutdown );

const started = Date.now();
const settled = await Promise.allSettled( Array.from( { length: count }, ( _, index ) => admit( index ) ) );
const failed = settled.filter( result => result.status === "rejected" );
for ( const result of failed ) console.log( `[crowd] a player failed: ${result.reason?.message ?? result.reason}` );
console.log(
	`[crowd] ${sockets.length} fake players are around ${values.near} after ${
		((Date.now() - started) / 1000).toFixed( 0 )
	} s. Ctrl+C removes them.`
);
// Keep the process (and the players' sockets) alive until interrupted.
setInterval( () => {}, 1 << 30 );
