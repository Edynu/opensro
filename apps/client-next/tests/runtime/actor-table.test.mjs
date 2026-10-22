/*
===========================================================================

actor-table.test.mjs - the shared actor table admits what a published list admits

The character worker writes a frame's actors into shared memory
(foundation/animation/actor-table.ts) and the renderer reads them straight
into its rows (actor-snapshots.ts updateFromTable). These tests drive two
snapshot owners through the same frames, one admitting the published
lists and one the table, and require the same rows, the same model
reference revisions and the same reuse of nested storage; the writer
refuses what a publication's admission refuses.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRandom } from "../helpers/walk-scenario.mjs";

const { createActorSnapshots } = await import( "../../src/engine/runtime/renderer/characters/actor-snapshots.ts" );
const { createActorTable, createActorTableReader, createActorTableWriter } = await import(
	"../../src/engine/foundation/animation/actor-table.ts"
);
const { createSharedStrings, createStringReader, createStringWriter } = await import(
	"../../src/engine/foundation/workers/shared-strings.ts"
);
const { sameValue } = await import( "../../src/engine/foundation/data/same-value.ts" );
const { animationActivation } = await import( "../../src/engine/foundation/animation/animation-activation.ts" );

const json = value => JSON.parse( JSON.stringify( value ) );

/*
================
table

A table's writer and reader over one block and string table.
================
*/
function table() {
	const block = createActorTable(), strings = createSharedStrings();
	return {
		writer: createActorTableWriter( block, createStringWriter( strings ) ),
		reader: createActorTableReader( block, createStringReader( strings ) )
	};
}

/*
================
randomActor

An actor with each optional field present or not, as producers publish.
================
*/
function randomActor( random, gid ) {
	const pick = ( p = .5 ) => random() < p;
	const n = () => Math.round( random() * 1000 ) / 10;
	const maybe = ( value, p = .4 ) => pick( p ) ? value : undefined;
	/** @type {any} */
	const actor = {
		gid,
		model: [ "body", "body2", "effect:fx", "assembly:long:" + "x".repeat( 300 ) ][Math.floor( random() * 4 )],
		clip: [ "stand", "run", "attack" ][Math.floor( random() * 3 )],
		time: n(),
		loop: pick(),
		scale: 1 + random(),
		pose: { regionId: 25000 + Math.floor( random() * 2 ), x: n(), y: n(), z: n(), yaw: random() * 6 }
	};
	for ( const key of [ "groundItem", "shadowAttachment", "blindable", "blindableCompanion", "drawGeometry" ] ) {
		if ( pick( .3 ) ) actor[key] = pick();
	}
	for ( const key of [ "absoluteEffectScale", "pickable", "pickWhenFiltered", "effectEntity" ] ) {
		if ( pick( .3 ) ) actor[key] = pick();
	}
	for (
		const key of [
			"shadowSize",
			"heightFactor",
			"effectBaseScale",
			"height",
			"pickOwner",
			"dungeonBlock",
			"mountedOn"
		]
	) {
		if ( pick( .3 ) ) actor[key] = Math.floor( random() * 100 );
	}
	if ( pick( .3 ) ) actor.modifierId = Math.floor( random() * 1000 );
	if ( pick( .3 ) ) actor.emissionEnd = n();
	if ( pick( .3 ) ) actor.opacity = random();
	if ( pick( .3 ) ) actor.previewClip = "preview-" + Math.floor( random() * 3 );
	if ( pick( .3 ) ) {
		const selector = () => ({
			set: "set" + Math.floor( random() * 3 ),
			state: Math.floor( random() * 4 ),
			...(pick() ? { override: pick() } : {})
		});
		actor.modelAnimation = {
			selected: pick() ? selector() : null,
			revision: Math.floor( random() * 9 ),
			restarted: Array.from( { length: Math.floor( random() * 3 ) }, selector ),
			dispatch: Array.from( { length: Math.floor( random() * 3 ) }, () => ({
				selector: selector(),
				ranges: Array.from( { length: Math.floor( random() * 3 ) }, () => [ n(), n() ] )
			}) )
		};
	}
	actor.animationLod = maybe( { fraction: random(), crowded: pick(), ...(pick() ? { optional: pick() } : {}) }, .7 );
	actor.deferredParticle = maybe( {
		offset: Math.floor( random() * 256 ),
		...(pick() ? { nightOnly: pick() } : {}),
		...(pick() ? { lodHidden: pick() } : {})
	}, .2 );
	actor.pointLight = maybe( {
		pose: { regionId: 25000, x: n(), y: n(), z: n() },
		ambient: [ random(), random(), random() ],
		diffuse: [ random(), random(), random() ],
		attenuation: random(),
		range: n()
	}, .2 );
	actor.bloodEffects = maybe( [ pick() ? "blood-a" : null, pick() ? "blood-b" : null ], .2 );
	actor.effectBasis = maybe( Array.from( { length: 9 }, n ), .2 );
	actor.materialTint = maybe( [ random(), random(), random() ], .2 );
	actor.effectRotation = maybe( { axis: [ "x", "y", "z" ][Math.floor( random() * 3 )], angle: n() }, .2 );
	actor.effectAnchor = maybe( { bone: pick() ? "Bip01 Head" : null, offset: [ n(), n(), n() ] }, .2 );
	actor.bodyVolume = maybe( { index: Math.floor( random() * 5 ), female: pick() }, .2 );
	actor.layers = maybe(
		Array.from( { length: Math.floor( random() * 4 ) }, () => ({
			...(pick() ? { rate: random() * 2 } : {}),
			clip: "layer" + Math.floor( random() * 3 ),
			time: n(),
			loop: pick(),
			weight: random(),
			lane: pick() ? "event" : "timed",
			...(pick() ? { activation: animationActivation( Math.floor( random() * 5 ) ) } : {})
		}) ),
		.5
	);
	actor.boneRotation = maybe( { bone: "Bip01 Spine1", rotation: [ random(), random(), random(), random() ] }, .2 );
	actor.attachment = maybe( {
		gid: Math.floor( random() * 30 ),
		bone: [ "hand", "Bip01 R Hand", "" ][Math.floor( random() * 3 )],
		offset: [ n(), n(), n() ],
		...(pick() ? { rootIfMissing: pick() } : {}),
		...(pick() ? { root: pick() } : {}),
		...(pick() ? { basis: [ "native", "native-bsr", "bsr", "compound" ][Math.floor( random() * 4 )] } : {}),
		...(pick() ? { keepRotation: pick() } : {}),
		...(pick() ? { modelScale: random() * 2 } : {}),
		...(pick() ? { rotation: Float32Array.from( { length: 16 }, () => random() ) } : {}),
		...(pick() ? { facing: random() * 6 } : {}),
		...(pick() ? { ground: pick() } : {})
	}, .3 );
	for ( const key of Object.keys( actor ) ) if ( actor[key] === undefined ) delete actor[key];
	return actor;
}

/*
================
frameOf

A frame's actors: a random subset of 30 gids, in a random order.
================
*/
function frameOf( random ) {
	const gids = [];
	for ( let gid = 0; gid < 30; gid++ ) if ( random() < .6 ) gids.push( gid );
	for ( let i = gids.length - 1; i > 0; i-- ) {
		const j = Math.floor( random() * (i + 1) );
		[gids[i], gids[j]] = [ gids[j], gids[i] ];
	}
	return gids.map( gid => randomActor( random, gid ) );
}

test("a frame admitted from the table holds the rows the published list gives", () => {
	const random = createRandom( 0x7ab1e );
	const published = createActorSnapshots(), shared = createActorSnapshots(), { writer, reader } = table();
	let reused = 0, compared = 0;
	for ( let frame = 0; frame < 300; frame++ ) {
		const actors = frameOf( random ), portraits = frame % 7 ? [] : frameOf( random ).slice( 0, 2 );
		const expected = published.update( actors );
		const before = new Map( [ ...shared.index ].map( ( [gid, row] ) => [ gid, { ...row } ] ) );
		writer.write( actors, portraits );
		const rows = shared.updateFromTable( reader, 0 );
		assert.equal( rows.length, expected.length );
		for ( let i = 0; i < rows.length; i++ ) {
			assert.ok(
				sameValue( rows[i], expected[i] ),
				`frame ${frame} actor ${expected[i].gid}: ${JSON.stringify( json( rows[i] ) )}`
			);
			compared++;
			// Nested storage the row owned is reused, as actor-snapshots.ts copy reuses it.
			const old = before.get( rows[i].gid );
			for (
				const key of [
					"attachment",
					"pointLight",
					"effectBasis",
					"materialTint",
					"effectAnchor",
					"layers",
					"boneRotation"
				]
			) {
				if ( old?.[key] && rows[i][key] ) {
					assert.equal( rows[i][key], old[key], `${key} storage reused` );
					reused++;
				}
			}
		}
		assert.equal( shared.modelRevision(), published.modelRevision(), `frame ${frame} model references` );
		assert.equal( shared.index.size, published.index.size );
		if ( portraits.length ) {
			const portraitRows = createActorSnapshots().updateFromTable( reader, 1 );
			assert.ok( sameValue( json( portraitRows ), json( portraits ) ) );
		}
	}
	assert.ok( compared > 4000 && reused > 500, `compared ${compared}, reused ${reused}` );
});

test("the writer refuses what a publication's admission refuses", () => {
	const random = createRandom( 0xbad );
	const { writer } = table();
	const base = () => randomActor( random, 1 );
	/** @type {[ ( actor: any ) => any, RegExp ][]} */
	const refusals = [
		[ actor => ({ ...actor, opacity: -1 }), /opacity/ ],
		[ actor => ({ ...actor, animationLod: { fraction: 2, crowded: false } }), /animation LOD/ ],
		[ actor => ({ ...actor, deferredParticle: { offset: 300 } }), /deferred particle/ ],
		[ actor => ({ ...actor, materialTint: [ 2, 0, 0 ] }), /material tint/ ],
		[ actor => ({ ...actor, modifierId: .5 }), /modifier owner/ ],
		[ actor => ({ ...actor, emissionEnd: -1 }), /emission end/ ],
		[ actor => ({ ...actor, bodyVolume: { index: 9, female: true } }), /volume/ ],
		[
			actor => ({
				...actor,
				attachment: { gid: 2, bone: "", offset: [ 0, 0, 0 ], rotation: new Float32Array( 3 ) }
			}),
			/attachment rotation/
		]
	];
	for ( const [change, expected] of refusals ) {
		const actor = change( base() );
		assert.throws( () => createActorSnapshots().update( [ actor ] ), expected );
		assert.throws( () => writer.write( [ actor ], [] ), expected );
	}
	assert.throws( () => writer.write( [ base(), base() ], [] ), /identity/ );
});
