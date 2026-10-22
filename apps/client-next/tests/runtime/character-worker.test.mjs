/*
===========================================================================

character-worker.test.mjs - the character worker's stand-ins answer as the main thread's owners

On the character worker (runtime/character-worker, CLIENT_WORKERS_PLAN.md
5.11) the presentation talks to stand-ins for the renderer and the asset
owner. These tests hold them to the real owners: the renderer stand-in's
skeleton queries and byte costs against a renderer character owner given
the full models, its record of commands, the load messages and actor
table it fills, and its facts; the asset
stand-in and the main thread's relay against an asset owner, round trip.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

const { createCharacters } = await import( "../../src/engine/runtime/renderer/characters/characters.ts" );
const { createRendererStandIn, skeletonModel } = await import(
	"../../src/engine/runtime/character-worker/worker/renderer-stand-in.ts"
);
const { createAssetStandIn } = await import( "../../src/engine/runtime/character-worker/worker/asset-stand-in.ts" );
const { createAssetRelay } = await import( "../../src/engine/runtime/character-worker/asset-relay.ts" );
const { ASSET_REQUEST_SLOTS } = await import( "../../src/engine/foundation/assets/asset-budget.ts" );
const { collectTransferables } = await import( "../../src/engine/foundation/workers/transferables.ts" );
const { createActorTable, createActorTableReader, createActorTableWriter } = await import(
	"../../src/engine/foundation/animation/actor-table.ts"
);
const { createSharedStrings, createStringReader, createStringWriter } = await import(
	"../../src/engine/foundation/workers/shared-strings.ts"
);
const { createActorSnapshots } = await import( "../../src/engine/runtime/renderer/characters/actor-snapshots.ts" );

const identity = () => Float32Array.of( 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 );
const BONES = [ "root", "Bip01", "Bip01 Spine", "Bip01 R Hand" ];

/*
================
bodyModel

A skinned body: a root, a pelvis bone that walks, a spine that turns and
a hand at its end, one primitive with cloth over its four vertices.
================
*/
/** @returns {any} */
function bodyModel() {
	const vertices = 4;
	return {
		nodes: BONES.map( ( name, i ) => ({
			name,
			parent: i - 1,
			translation: [ 0, i ? 10 : 0, i === 3 ? 4 : 0 ],
			rotation: [ 0, 0, 0, 1 ],
			scale: [ 1, 1, 1 ]
		}) ),
		images: [],
		clips: [ {
			name: "stand",
			duration: 2,
			channels: [
				{
					node: 1,
					path: "translation",
					interpolation: "LINEAR",
					times: Float32Array.of( 0, 1, 2 ),
					values: Float32Array.of( 0, 10, 0, 3, 11, 1, 0, 10, 0 )
				},
				{
					node: 2,
					path: "rotation",
					interpolation: "LINEAR",
					times: Float32Array.of( 0, 2 ),
					values: Float32Array.of( 0, 0, 0, 1, 0, 0.7071068, 0, 0.7071068 )
				}
			]
		} ],
		primitives: [ {
			name: "body",
			node: 0,
			joints: [ 1, 2, 3 ],
			inverseBind: Float32Array.from( [ ...identity(), ...identity(), ...identity() ] ),
			image: -1,
			cloth: {
				mobility: [ 0, 1, 1, 0 ],
				pins: [ 0, 0, 0, 0 ],
				constraints: [ [ 0, 1, 1 ], [ 1, 2, 1 ] ],
				order: [ 0, 1 ],
				force: null,
				gravity: 1,
				gravityMobility: 1,
				windMobility: 0,
				damping: .1,
				windPeriod: 10
			},
			geometry: {
				positions: new Float32Array( vertices * 3 ).map( ( _, i ) => i ),
				normals: new Float32Array( vertices * 3 ),
				uvs: new Float32Array( vertices * 2 ),
				joints: Uint32Array.of( 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 0, 1, 2, 0 ),
				weights: new Float32Array( vertices * 4 ).fill( .25 ),
				indices: Uint32Array.of( 0, 1, 2, 0, 2, 3 ),
				transform: identity(),
				material: { color: [ 1, 1, 1, 1 ], alphaCutoff: 0, blend: false, doubleSided: false }
			}
		} ]
	};
}

/*
================
itemModel

An item a body holds, skinned to its one bone as character models are.
================
*/
/** @returns {any} */
function itemModel() {
	return {
		nodes: [ { name: "root", parent: -1, translation: [ 0, 0, 0 ], rotation: [ 0, 0, 0, 1 ], scale: [ 1, 1, 1 ] } ],
		images: [],
		clips: [],
		primitives: [ {
			name: "blade",
			node: 0,
			joints: [ 0 ],
			inverseBind: identity(),
			image: -1,
			geometry: {
				positions: Float32Array.of( 0, 0, 0, 1, 0, 0, 0, 1, 0 ),
				joints: new Uint32Array( 12 ),
				weights: Float32Array.of( 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0 ),
				indices: Uint32Array.of( 0, 1, 2 ),
				transform: identity(),
				material: { color: [ 1, 1, 1, 1 ], alphaCutoff: 0, blend: false, doubleSided: false }
			}
		} ]
	};
}

/*
================
rows

A body at its clip time and the item in its hand.
================
*/
/** @param {number} time @returns {any[]} */
function rows( time ) {
	const pose = { regionId: 257, x: 5, y: 0, z: 3, yaw: .5 };
	return [
		{ gid: 1, model: "body", clip: "stand", time, loop: true, scale: 1.2, pose },
		{
			gid: 2,
			model: "item",
			clip: "stand",
			time: 0,
			loop: true,
			scale: 1,
			pose,
			attachment: { gid: 1, bone: "Bip01 R Hand", offset: [ 0, 0, 0 ] }
		}
	];
}

/*
================
facts

The main thread's facts for a frame; overrides replace defaults.
================
*/
/** @returns {any} */
function facts( overrides = {} ) {
	return {
		camera: { regionId: 257, x: 0, y: 0, z: 0 },
		listener: null,
		night: false,
		particleTimes: [],
		enchantSparks: false,
		sharedActorRoom: true,
		batchedEffects: false,
		vHidesCompanions: false,
		dungeonPvs: false,
		...overrides
	};
}

/*
================
standInOf

A renderer stand-in over a fresh actor table, recording the load messages
it posts; reader reads the table back.
================
*/
function standInOf( delivered = new WeakSet() ) {
	const block = createActorTable(), strings = createSharedStrings();
	/** @type {{ load: any, transfer: Transferable[] }[]} */
	const posted = [];
	const standIn = createRendererStandIn(
		createCharacters(),
		delivered,
		createActorTableWriter( block, createStringWriter( strings ) ),
		( load, transfer ) => posted.push( { load, transfer } )
	);
	return { standIn, posted, reader: createActorTableReader( block, createStringReader( strings ) ) };
}

test("the stand-in answers skeleton queries as the renderer given the full models", () => {
	const renderer = createCharacters();
	renderer.model( "body", bodyModel(), [] );
	renderer.model( "item", itemModel(), [] );
	const { standIn } = standInOf();
	standIn.renderer.setCharacterModel( "body", bodyModel(), [] );
	standIn.renderer.setCharacterModel( "item", itemModel(), [] );
	let compared = 0;
	for ( const time of [ 0, .25, .9, 1.5, 3.3 ] ) {
		standIn.frame( facts(), time );
		const actors = rows( time );
		for ( const bone of BONES ) {
			/** @type {[ number, number, number ]} */
			const offset = [ 1, 2, 3 ];
			assert.deepEqual(
				standIn.renderer.characterSocket( actors, 1, bone, offset ),
				renderer.socket( actors, 1, bone, offset ),
				`socket ${bone} at ${time}`
			);
			assert.deepEqual(
				standIn.renderer.characterLocalMatrix( actors, 1, bone ),
				renderer.localMatrix( actors, 1, bone ),
				`local ${bone} at ${time}`
			);
			compared++;
		}
		assert.deepEqual(
			standIn.renderer.characterMatrix( actors, 2 ),
			renderer.matrix( actors, 2 ),
			`held at ${time}`
		);
		assert.ok( standIn.renderer.characterMatrix( actors, 2 )?.every( Number.isFinite ) );
	}
	assert.equal( compared, 20 );
	// The posed hand moves: the comparison is not of rest poses.
	assert.notDeepEqual(
		renderer.socket( rows( 0 ), 1, "Bip01 R Hand", [ 0, 0, 0 ] ),
		renderer.socket( rows( 1 ), 1, "Bip01 R Hand", [ 0, 0, 0 ] )
	);
});

test("a skeleton model keeps the skeleton and drops the geometry, images and cloth", () => {
	const model = bodyModel(), skeleton = skeletonModel( model );
	assert.equal( skeleton.nodes, model.nodes );
	assert.equal( skeleton.clips, model.clips );
	const [primitive] = skeleton.primitives;
	assert.equal( primitive.cloth, undefined );
	assert.equal( primitive.inverseBind, model.primitives[0].inverseBind );
	assert.deepEqual( primitive.joints, model.primitives[0].joints );
	assert.equal( primitive.geometry.positions.length, 0 );
	assert.equal( primitive.geometry.indices.length, 0 );
	assert.ok( primitive.geometry.joints instanceof Uint32Array && primitive.geometry.weights instanceof Float32Array );
	// The source is untouched: it still goes to the main thread whole.
	assert.equal( model.primitives[0].geometry.positions.length, 12 );
	assert.ok( model.primitives[0].cloth );
});

test("the stand-in charges a clip as the renderer charges the full model", () => {
	const renderer = createCharacters();
	const { standIn } = standInOf();
	renderer.model( "body", bodyModel(), [] );
	standIn.renderer.setCharacterModel( "body", bodyModel(), [] );
	/** @type {() => any} */
	const clip = () => ({
		duration: 1,
		channels: [ {
			bone: "Bip01 Spine",
			path: "rotation",
			interpolation: "LINEAR",
			times: Float32Array.of( 0, 1 ),
			values: Float32Array.of( 0, 0, 0, 1, 0, 0, 0, 1 )
		} ]
	});
	const charged = renderer.animation( "body", "walk", clip() );
	assert.equal( standIn.renderer.setCharacterAnimation( "body", "walk", clip() ), charged );
	// A clip the body already holds charges nothing more.
	assert.equal(
		standIn.renderer.setCharacterAnimation( "body", "walk", clip() ),
		renderer.animation( "body", "walk", clip() )
	);
	assert.ok( charged > 0 );
});

test("the stand-in records the renderer commands in order; loads and actors go through shared memory", () => {
	const delivered = new WeakSet(), model = bodyModel();
	// The model's positions arrived in an asset result; its normals did not.
	delivered.add( model.primitives[0].geometry.positions.buffer );
	const { standIn, posted, reader } = standInOf( delivered );
	const { renderer } = standIn;
	renderer.setCharacterModel( "body", model, [] );
	renderer.setCharacterAssembly( "dressed", "body", [] );
	renderer.setCharacterAssembly( "dressed", "body", [] );
	renderer.retainCharacterModels( [ "body", "dressed" ] );
	renderer.retainCharacterModels( [ "body", "dressed" ] );
	const actors = rows( 0 );
	renderer.setCharacterActors( actors.slice( 1 ), undefined );
	renderer.setFootprints( [] );
	renderer.setCharacterActors( actors, undefined );
	/** @type {{ commands: any[], loads: number }} */
	const { commands, loads } = standIn.take();
	// The same retain again changes nothing; a second publication replaces
	// the first, at its own place.
	assert.deepEqual( commands.map( command => command.kind ), [
		"load",
		"assembly",
		"assembly",
		"retain",
		"footprints",
		"actors"
	] );
	assert.deepEqual( commands[1].definition, { base: "body", parts: [] } );
	assert.equal( commands[2].definition, undefined );
	// The model goes as a numbered load message; only its delivered buffer moves.
	assert.equal( loads, 1 );
	assert.equal( commands[0].sequence, 1 );
	assert.equal( posted.length, 1 );
	assert.equal( posted[0].load.sequence, 1 );
	assert.equal( posted[0].load.model, model );
	assert.deepEqual( posted[0].transfer, [ model.primitives[0].geometry.positions.buffer ] );
	assert.ok( !delivered.has( model.primitives[0].geometry.positions.buffer ) );
	// The table holds the last publication, as the renderer would admit it.
	assert.deepEqual(
		JSON.parse( JSON.stringify( createActorSnapshots().updateFromTable( reader, 0 ) ) ),
		JSON.parse( JSON.stringify( createActorSnapshots().update( actors ) ) )
	);
	// Taken once; a clip is a load of its own.
	assert.deepEqual( standIn.take().commands, [] );
	renderer.setCharacterAnimation( "body", "walk", {
		duration: 1,
		channels: [ {
			bone: "Bip01 Spine",
			path: "rotation",
			interpolation: "LINEAR",
			times: Float32Array.of( 0, 1 ),
			values: Float32Array.of( 0, 0, 0, 1, 0, 0, 0, 1 )
		} ]
	} );
	assert.deepEqual( standIn.take(), { commands: [ { kind: "load", sequence: 2 } ], loads: 2 } );
	assert.equal( posted[1].load.load, "animation" );
	// The renderer's admission: an assembly needs an admitted body.
	assert.throws( () => renderer.setCharacterAssembly( "other", "missing", [] ), /not admitted/ );
});

test("the stand-in answers the renderer's other queries from the frame's facts", () => {
	const { standIn } = standInOf();
	/** @type {any} */
	const renderer = standIn.renderer;
	const scenery = { emitters: [], night: true };
	standIn.frame(
		facts( {
			night: true,
			particleTimes: [ [ 7, 1.5 ] ],
			batchedEffects: true,
			scenery,
			dungeonVisibility: [ [ 0, 1 ], [ 1 ] ]
		} ),
		1
	);
	assert.equal( renderer.presentationNight(), true );
	assert.equal( renderer.characterParticleTime( 7 ), 1.5 );
	assert.equal( renderer.characterParticleTime( 8 ), undefined );
	assert.equal( renderer.batchedEffects(), true );
	assert.equal( renderer.scenery(), scenery );
	// world.ts blockHides: a room the active room does not draw.
	assert.equal( renderer.dungeonBlockHides( 0, 1 ), true );
	assert.equal( renderer.dungeonBlockHides( 1, 1 ), false );
	assert.equal( renderer.dungeonBlockHides( 1, 0 ), false );
	assert.equal( renderer.dungeonBlockHides( 0, undefined ), false );
	assert.equal( renderer.dungeonBlockHides( 0, 5 ), false );
	// Facts sent only on change keep their last value; per-frame ones do not.
	standIn.frame( facts(), 2 );
	assert.equal( renderer.scenery(), scenery );
	assert.equal( renderer.dungeonBlockHides( 0, 1 ), true );
	assert.equal( renderer.characterParticleTime( 7 ), undefined );
	standIn.frame( facts( { dungeonVisibility: null, scenery: null } ), 3 );
	assert.equal( renderer.dungeonBlockHides( 0, 1 ), false );
	assert.equal( renderer.scenery(), null );
});

/*
================
fakeAssets

An asset owner with the real one's slots: request throws past them, a
result is taken once, cancel releases the slot.
================
*/
function fakeAssets() {
	const jobs = new Map(), log = [];
	let next = 100;
	return {
		log,
		finish( id, result ) {
			jobs.get( id ).result = { ...result, id };
		},
		ids: () => [ ...jobs.keys() ],
		owner: {
			available: () => ASSET_REQUEST_SLOTS - jobs.size,
			request( url, limit, decode ) {
				if ( jobs.size >= ASSET_REQUEST_SLOTS ) throw Error( "Asset request exceeds budget" );
				const id = ++next;
				jobs.set( id, { result: null } );
				log.push( [ "request", id, url, limit, decode ] );
				return id;
			},
			take( id ) {
				const job = jobs.get( id );
				if ( !job?.result ) return null;
				jobs.delete( id );
				return job.result;
			},
			cancel( id ) {
				log.push( [ "cancel", id ] );
				jobs.delete( id );
			}
		}
	};
}

test("the worker's asset requests reach the real owner in order and their results come back", () => {
	const assets = fakeAssets(), relay = createAssetRelay( assets.owner );
	const delivered = new WeakSet(), standIn = createAssetStandIn( delivered );
	let poll = relay.poll();
	assert.equal( poll.available, ASSET_REQUEST_SLOTS );
	standIn.frame( poll.available, poll.results );
	const a = standIn.assets.request( "https://h/a.glb", undefined, "character" );
	const b = standIn.assets.request( "https://h/b.bin" );
	assert.equal( standIn.assets.available(), ASSET_REQUEST_SLOTS - 2 );
	let taken = standIn.take();
	relay.receive( taken.requests, taken.cancels );
	// Issued as the output arrives, in order, with the owner's default limit.
	assert.deepEqual(
		assets.log.map( row => row.slice( 0, 5 ) ),
		[ [ "request", 101, "https://h/a.glb", 16 << 20, "character" ], [
			"request",
			102,
			"https://h/b.bin",
			16 << 20,
			undefined
		] ]
	);
	const buffer = new ArrayBuffer( 8 );
	assets.finish( 102, { kind: "bytes", buffer } );
	poll = relay.poll();
	assert.deepEqual( poll.transfer, [ buffer ] );
	// The worker is offered the owner's slots less its own outstanding one.
	assert.equal( poll.available, ASSET_REQUEST_SLOTS - 1 );
	standIn.frame( poll.available, poll.results );
	assert.equal( standIn.assets.take( a ), null );
	/** @type {any} */
	const result = standIn.assets.take( b );
	assert.equal( result.id, b );
	assert.equal( result.buffer, buffer );
	assert.ok( delivered.has( buffer ) );
	assert.equal( standIn.assets.take( b ), null, "taken once" );
	// A cancelled request releases the owner's job.
	standIn.assets.cancel( a );
	taken = standIn.take();
	relay.receive( taken.requests, taken.cancels );
	assert.deepEqual( assets.log.at( -1 ), [ "cancel", 101 ] );
	assert.deepEqual( assets.ids(), [] );
});

test("a request the owner has no slot for waits in the relay and starts at the next poll", () => {
	const assets = fakeAssets(), relay = createAssetRelay( assets.owner );
	const standIn = createAssetStandIn( new WeakSet() );
	// Another owner holds every slot but one.
	for ( let i = 0; i < ASSET_REQUEST_SLOTS - 1; i++ ) assets.owner.request( `https://h/other${i}` );
	standIn.frame( relay.poll().available, [] );
	const ids = [ standIn.assets.request( "https://h/1" ), standIn.assets.request( "https://h/2" ) ];
	const taken = standIn.take();
	relay.receive( taken.requests, taken.cancels );
	assert.equal( assets.log.filter( row => row[2]?.endsWith( "/1" ) ).length, 1 );
	assert.equal( assets.log.filter( row => row[2]?.endsWith( "/2" ) ).length, 0 );
	// A slot frees: the waiting request starts at the poll, before anyone else's.
	assets.finish( 101, { kind: "bytes", buffer: new ArrayBuffer( 1 ) } );
	assets.owner.take( 101 );
	const poll = relay.poll();
	assert.equal( assets.log.filter( row => row[2]?.endsWith( "/2" ) ).length, 1 );
	assert.equal( poll.available, ASSET_REQUEST_SLOTS - 2 );
	// A stand-in with no slot offered refuses as the real owner does.
	standIn.frame( 0, [] );
	assert.throws( () => standIn.assets.request( "https://h/3" ), /exceeds budget/ );
	assert.equal( ids.length, 2 );
});

test("transferables are the buffers under a value, each once, as accepted", () => {
	const shared = new ArrayBuffer( 16 );
	const value = {
		a: new Float32Array( shared ),
		b: [ new Uint8Array( shared, 4 ), new ArrayBuffer( 2 ) ],
		c: { d: 1 }
	};
	const all = collectTransferables( value );
	assert.equal( all.length, 2 );
	assert.ok( all.includes( shared ) );
	assert.deepEqual( collectTransferables( value, buffer => buffer === shared ), [ shared ] );
	assert.deepEqual( collectTransferables( 5 ), [] );
});
