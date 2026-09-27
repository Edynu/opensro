/*
===========================================================================

native-unavailable-effects.test.mjs - tests for effects.ts, resources.ts

Loads the TypeScript sources directly through the shared native loader
(tests/helpers/native-source-loader.mjs), so the tests exercise the same
modules the client ships, not a per-test bundle.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { pathToFileURL as sourceFileUrl } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const { createEffectDecoder } = await import(
	sourceFileUrl( "src/engine/runtime/assets/worker/effects/effects.ts" ).href
);

const { createCharacterResources } = await import(
	sourceFileUrl( "src/engine/runtime/characters/resources/resources.ts" ).href
);
const evidence = JSON.parse( fs.readFileSync( "../../scripts/build/reference/particle-archive.json", "utf8" ) );
const bytes = value => Buffer.from( JSON.stringify( value ) );
const catalog = () => ({
	framesPerSecond: 20,
	effects: {},
	meshes: {},
	textures: {},
	nativeUnavailable: { archiveSha256: evidence.sha256, effects: evidence.absent }
});
test("archive-proven absent EFPs reproduce the retained empty native resource on repeated loads", () => {
	const decoder = createEffectDecoder(), data = bytes( catalog() );
	for ( let repeat = 0; repeat < 2; repeat++ ) {
		for ( const path of evidence.absent ) {
			const result = decoder.model( data, path.toUpperCase().replaceAll( "/", "\\" ) );
			assert.deepEqual( result, { model: { nodes: [], clips: [], images: [], primitives: [] }, imagePaths: [] } );
		}
	}
	assert.throws( () => decoder.model( data, "system/accidentally_missing.efp" ), /Missing effect program/ );
	decoder.dispose();
});
test("missing archive evidence and malformed or contradictory certificates fail closed", () => {
	for (
		const mutate of [
			c => delete c.nativeUnavailable,
			c => c.nativeUnavailable.archiveSha256 = "unverified",
			c => c.nativeUnavailable.effects = [ "../escape.efp" ],
			c => c.effects[evidence.absent[0]] = { scale: 1 }
		]
	) {
		const c = catalog();
		mutate( c );
		const decoder = createEffectDecoder();
		assert.throws(
			() => decoder.model( bytes( c ), evidence.absent[0] ),
			/Missing effect program|Invalid native unavailable/
		);
		decoder.dispose();
	}
});

test("native-empty effects become resident once instead of entering the failed-resource retry loop", () => {
	const decoder = createEffectDecoder(),
		data = bytes( catalog() ),
		path = "/assets/effects/programs.json#" + encodeURIComponent( evidence.absent[0] );
	let requests = 0, loaded = 0;
	const pending = new Map();
	const assets = {
		available: () => 4,
		request( url ) {
			const result = decoder.model( data, decodeURIComponent( new URL( url ).hash.slice( 1 ) ) );
			pending.set( ++requests, { kind: "character", model: result.model, images: [] } );
			return requests;
		},
		take( id ) {
			const value = pending.get( id );
			pending.delete( id );
			return value;
		},
		cancel( id ) {
			pending.delete( id );
		}
	};
	const owner = createCharacterResources( assets, {
		setCharacterModel( url, model ) {
			assert.equal( url, path );
			assert.equal( model.primitives.length, 0 );
			loaded++;
		},
		retainCharacterModels() {}
	}, "http://fixture.invalid" );
	for ( let time = 0; time < 10; time++ ) {
		owner.begin( time );
		owner.poll();
		owner.ready( path );
		owner.retainWanted( [ path ] );
	}
	assert.equal( requests, 1 );
	assert.equal( loaded, 1 );
	assert.equal( owner.ready( path ), true );
	owner.dispose();
	decoder.dispose();
});
