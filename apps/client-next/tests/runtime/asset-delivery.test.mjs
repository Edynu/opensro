/*
===========================================================================

asset-delivery.test.mjs - tests for packs.ts

Loads the TypeScript sources directly through the shared native loader
(tests/helpers/native-source-loader.mjs), so the tests exercise the same
modules the client ships, not a per-test bundle.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { pathToFileURL as sourceFileUrl } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { prepareAssetDelivery, validateAssetDelivery } from "../../../../scripts/build/assetDelivery.mjs";
import { buildAssetPacks } from "../../../../scripts/build/assetPacks.mjs";
import { createPublishedDelivery } from "../../tools/published-delivery.mjs";
import { defined } from "../helpers/defined.mjs";
const sha = b => createHash( "sha256" ).update( b ).digest( "hex" );

const { createPacks } = await import( sourceFileUrl( "src/engine/runtime/assets/worker/packs/packs.ts" ).href );
async function fixture( t ) {
	const root = await mkdtemp( path.join( os.tmpdir(), "sro-delivery-" ) );
	t.after( () => rm( root, { recursive: true, force: true } ) );
	const values = [ [ "/assets/future/new-feature.glb", Buffer.alloc( 128 << 10, 37 ) ], [
		"/assets/world/unlisted-region/animated-objects.json",
		Buffer.from(
			JSON.stringify( { objects: { "native/future.bsr": { glbPublicPath: "/assets/future/new-feature.glb" } } } )
		)
	] ];
	const entries = [];
	let offset = 0;
	for ( const [file, bytes] of values ) {
		await mkdir( path.dirname( path.join( root, file ) ), { recursive: true } );
		await writeFile( path.join( root, file ), bytes );
		entries.push( {
			path: file,
			offset,
			length: bytes.length,
			mime: "application/octet-stream",
			sha256: sha( bytes ),
			group: "test"
		} );
		offset += bytes.length;
	}
	const header = Buffer.from( JSON.stringify( { format: "sro-asset-pack", version: 1, files: entries } ) ),
		prefix = Buffer.alloc( 12 );
	prefix.write( "SROPACK1" );
	prefix.writeUInt32LE( header.length, 8 );
	const bytes = Buffer.concat( [ prefix, header, ...values.map( e => e[1] ) ] ),
		pack = {
			path: "/assets/packs/generated.bin",
			bytes: bytes.length,
			sha256: sha( bytes ),
			assetCount: entries.length
		};
	for ( const e of entries ) e.packPath = pack.path;
	await mkdir( path.join( root, "assets/packs" ), { recursive: true } );
	await writeFile( path.join( root, pack.path ), bytes );
	const index = {
		version: 1,
		groups: [ { name: "test", assetCount: entries.length, packs: [ pack ] } ],
		assets: entries
	};
	return { root, index, values, bytes };
}
test("publication discovers new content, builds lossless transport and source index, and is repeatable", async t => {
	const f = await fixture( t ), report = await prepareAssetDelivery( f.index, f.root ), entry = f.index.assets[0];
	assert.equal( report.compressedMembers, 1 );
	assert.ok( report.compressedBytes < report.identityBytes / 10 );
	assert.deepEqual( gunzipSync( await readFile( path.join( f.root, entry.transport.path ) ) ), f.values[0][1] );
	assert.deepEqual( f.index.assets[1].animationSources, [ "native/future.bsr" ] );
	const first = JSON.stringify( f.index );
	await prepareAssetDelivery( f.index, f.root );
	assert.equal( JSON.stringify( f.index ), first );
	const requests = [],
		packs = createPacks( async ( url, limit, signal, range ) => {
			requests.push( { url, range } );
			if ( url.endsWith( "manifest.json" ) ) return new TextEncoder().encode( JSON.stringify( f.index ) );
			return new Uint8Array(
				await readFile( path.join( f.root, decodeURIComponent( new URL( url ).pathname ) ) )
			);
		} );
	const data = await packs.read(
		new URL( "http://localhost" + entry.path ),
		entry.length,
		new AbortController().signal
	);
	assert.deepEqual( Buffer.from( data ), f.values[0][1] );
	assert.equal( requests.length, 2 );
	assert.ok( requests[1].url.endsWith( ".gz" ) );
	assert.equal( requests[1].range, undefined );
	assert.equal( packs.stats().rangeBytes, 0 );
	packs.dispose();
});
test("compression metadata survives compact deployment with no loose sources", async t => {
	const f = await fixture( t );
	for ( const [name] of f.values ) await rm( path.join( f.root, name ) );
	await prepareAssetDelivery( f.index, f.root );
	assert.ok( f.index.assets[0].transport );
	assert.equal(
		JSON.parse( await readFile( path.join( f.root, "assets/packs/delivery.json" ), "utf8" ) ).assets[0].sourceStat,
		undefined
	);
});
test("admission rejects corrupt compressed bytes, wrong decoded digest, and output beyond declared bounds", async t => {
	for ( const failure of [ "wire", "decoded", "oversized" ] ) {
		const f = await fixture( t );
		await prepareAssetDelivery( f.index, f.root );
		const entry = f.index.assets[0];
		let encoded = await readFile( path.join( f.root, entry.transport.path ) );
		if ( failure === "wire" ) encoded[0] ^= 1;
		else {
			encoded = gzipSync( Buffer.alloc( entry.length + (failure === "oversized" ? 1 : 0), 38 ) );
			entry.transport = {
				encoding: "gzip",
				sha256: sha( encoded ),
				length: encoded.length,
				path: "/assets/packs/transport/" + sha( encoded ) + ".gz"
			};
		}
		const packs = createPacks( async url =>
			url.endsWith( "manifest.json" ) ?
				new TextEncoder().encode( JSON.stringify( f.index ) ) :
				new Uint8Array( encoded )
		);
		await assert.rejects(
			packs.read( new URL( "http://localhost" + entry.path ), entry.length, new AbortController().signal ),
			/SHA-256|budget|byte limit/
		);
		packs.dispose();
	}
});
test("concurrent compressed demand shares work; cancellation does not cancel another consumer", async t => {
	const f = await fixture( t );
	await prepareAssetDelivery( f.index, f.root );
	const entry = f.index.assets[0],
		encoded = new Uint8Array( await readFile( path.join( f.root, entry.transport.path ) ) );
	let release, started, calls = 0;
	const gate = new Promise( r => release = r ), begin = new Promise( r => started = r );
	const packs = createPacks( async ( url, limit, signal ) => {
		if ( url.endsWith( "manifest.json" ) ) return new TextEncoder().encode( JSON.stringify( f.index ) );
		calls++;
		started();
		await gate;
		assert.equal( signal.aborted, false );
		return encoded;
	} );
	const first = new AbortController(),
		second = new AbortController(),
		url = new URL( "http://localhost" + entry.path );
	const a = packs.read( url, entry.length, first.signal ), b = packs.read( url, entry.length, second.signal );
	await begin;
	first.abort();
	defined( release )();
	const result = await Promise.allSettled( [ a, b ] );
	assert.equal( result[0].status, "rejected" );
	assert.equal( result[1].status, "fulfilled" );
	assert.equal( calls, 1 );
	packs.dispose();
});
test("server selects precompressed bytes only for the exact current loose source", async t => {
	const f = await fixture( t );
	await prepareAssetDelivery( f.index, f.root );
	await writeFile( path.join( f.root, "assets/packs/manifest.json" ), JSON.stringify( f.index ) );
	const { stat } = await import( "node:fs/promises" ),
		owner = createPublishedDelivery( f.root ),
		entry = f.index.assets[0],
		filename = path.join( f.root, entry.path );
	assert.ok( await owner.gzip( entry.path, await stat( filename ) ) );
	await writeFile( filename, Buffer.alloc( entry.length, 66 ) );
	assert.equal( await owner.gzip( entry.path, await stat( filename ) ), null );
});
test("standard pack build automatically generates delivery metadata for arbitrary new files", async t => {
	const f = await fixture( t );
	await rm( path.join( f.root, "assets/packs/generated.bin" ) );
	await buildAssetPacks( {
		publicRoot: f.root,
		outputRoot: path.join( f.root, "assets/packs" ),
		hashCachePath: path.join( f.root, "hashes.json" ),
		groups: [ { name: "future", load: "test", files: f.values.map( e => e[0] ) } ]
	} );
	const index = JSON.parse( await readFile( path.join( f.root, "assets/packs/manifest.json" ), "utf8" ) );
	assert.ok( index.assets.find( e => e.path.endsWith( ".glb" ) ).transport );
	assert.deepEqual( index.assets.find( e => e.path.endsWith( ".json" ) ).animationSources, [ "native/future.bsr" ] );
});

test("publication coverage gate rejects newly added assets and stale metadata automatically", async t => {
	const f = await fixture( t );
	await prepareAssetDelivery( f.index, f.root );
	const metadata = JSON.parse( await readFile( path.join( f.root, "assets/packs/delivery.json" ), "utf8" ) );
	validateAssetDelivery( f.index, metadata );
	f.index.assets.push( { ...f.index.assets[0], path: "/assets/a-future-junior-added-this.glb" } );
	assert.throws( () => validateAssetDelivery( f.index, metadata ), /missing generated delivery/ );
	f.index.assets.pop();
	f.index.assets[0].sha256 = "0".repeat( 64 );
	assert.throws( () => validateAssetDelivery( f.index, metadata ), /Stale/ );
});
