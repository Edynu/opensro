/*
===========================================================================

packGroupRefresh.test.mjs - first focused publication into canonical groups

An isolated child runs the real pack refresh and manifest publication. Missing
groups require full-build migration; existing empty groups retain their policy
when their first member arrives. No shared generated assets or hash cache writes.

===========================================================================
*/
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify( execFile );
const CHILD_FLAG = "--refresh-fixture";
const CHILD_TIMEOUT_MS = 60000;
const TARGET_GROUP = "particle-textures";
const NEW_IMAGE = "/assets/images/Particles_extracted/textures/first.texture";
const SENTINEL = "/assets/images/unchanged.png";
const TARGET_BYTES = 4096;

/*
================
refreshFixture

The zero-byte new member tests publication, not image decoding, and avoids
the sparse builder's shared member-compression cache. Initial nonempty bytes
use an explicitly isolated compression cache.
================
*/
async function refreshFixture( scenario ) {
	const { CLIENT_PUBLIC_ROOT, GENERATED_ROOT } = await import( "../../lib/generatedRoot.mjs" );
	const { buildAssetPacks } = await import( "../../build/assetPacks.mjs" );
	const { PACK_INDEX_PATH, refreshPackGroups } = await import( "../../build/shared/packGroupRefresh.mjs" );
	const { readPackedAssetBytesSync } = await import( "../../lib/publishedAsset.mjs" );
	const load = scenario === "startup-mismatch" ? "manual" : "startup";
	const sentinelBytes = Buffer.from( "unrelated packed bytes" );
	await mkdir( path.join( CLIENT_PUBLIC_ROOT, "assets/images" ), { recursive: true } );
	await writeFile( path.join( CLIENT_PUBLIC_ROOT, SENTINEL.slice( 1 ) ), sentinelBytes );
	const groups = [ { name: "game-images", load: "startup", files: [ SENTINEL ] } ];
	if ( scenario !== "missing" ) {
		groups.push( { name: TARGET_GROUP, load, targetBytes: TARGET_BYTES, files: [] } );
	}
	await buildAssetPacks( {
		publicRoot: CLIENT_PUBLIC_ROOT,
		outputRoot: path.dirname( PACK_INDEX_PATH ),
		hashCachePath: path.join( GENERATED_ROOT, "hash-cache.json" ),
		memberCacheRoot: path.join( GENERATED_ROOT, "member-cache" ),
		groups
	} );
	const beforeBytes = await readFile( PACK_INDEX_PATH );
	const before = JSON.parse( beforeBytes );
	// Compacted unrelated members must survive without a loose source.
	await rm( path.join( CLIENT_PUBLIC_ROOT, SENTINEL.slice( 1 ) ) );
	const imageFile = path.join( CLIENT_PUBLIC_ROOT, NEW_IMAGE.slice( 1 ) );
	await mkdir( path.dirname( imageFile ), { recursive: true } );
	await writeFile( imageFile, Buffer.alloc( 0 ) );
	const delta = {
		groupName: TARGET_GROUP,
		startup: true,
		files: scenario === "empty-request" ? [] : [ NEW_IMAGE ],
		sameMembership: scenario === "same-membership"
	};
	const request = { name: "first-image", deltas: [ delta ] };
	const expectedErrors = {
		missing: /no particle-textures group.*pnpm assets build full.*before a focused refresh/,
		"empty-request": /no populated particle-textures group/,
		"same-membership": /no populated particle-textures group/,
		"startup-mismatch": /particle-textures must be startup-resident/
	};
	if ( scenario !== "append" ) {
		await assert.rejects( refreshPackGroups( request ), expectedErrors[scenario] );
		assert.deepEqual( await readFile( PACK_INDEX_PATH ), beforeBytes, "refusal preserves the published index" );
		return;
	}
	await refreshPackGroups( request );
	const after = JSON.parse( await readFile( PACK_INDEX_PATH, "utf8" ) );
	const group = after.groups.find( row => row.name === TARGET_GROUP );
	assert.equal( group.load, "startup" );
	assert.equal( group.targetBytes, TARGET_BYTES );
	assert.equal( group.assetCount, 1 );
	assert.equal( group.packs.length, 1 );
	assert.deepEqual( after.assets.filter( row => row.path === NEW_IMAGE ).map( row => row.group ), [ TARGET_GROUP ] );
	assert.deepEqual( readPackedAssetBytesSync( NEW_IMAGE, CLIENT_PUBLIC_ROOT ), Buffer.alloc( 0 ) );
	assert.deepEqual( readPackedAssetBytesSync( SENTINEL, CLIENT_PUBLIC_ROOT ), sentinelBytes );
	assert.deepEqual(
		after.groups.find( row => row.name === "game-images" ),
		before.groups.find( row => row.name === "game-images" )
	);
	assert.deepEqual(
		after.assets.find( row => row.path === SENTINEL ),
		before.assets.find( row => row.path === SENTINEL )
	);
	await refreshPackGroups( request );
	assert.deepEqual( JSON.parse( await readFile( PACK_INDEX_PATH, "utf8" ) ), after, "repeat refresh is idempotent" );
}

if ( process.argv[2] === CHILD_FLAG ) {
	await refreshFixture( process.argv[3] );
} else {
	for ( const scenario of [ "append", "missing", "empty-request", "same-membership", "startup-mismatch" ] ) {
		test(`focused pack refresh: ${scenario}`, async t => {
			const temporary = await mkdtemp( path.join( os.tmpdir(), "sro-pack-refresh-" ) );
			t.after( async () => {
				assert.equal( path.dirname( temporary ), path.resolve( os.tmpdir() ) );
				await rm( temporary, { recursive: true, force: true } );
			} );
			await run( process.execPath, [ fileURLToPath( import.meta.url ), CHILD_FLAG, scenario ], {
				env: {
					...process.env,
					SRO_GENERATED_ROOT: temporary,
					SRO_BUILD_HASH_CACHE: "0",
					SRO_ASSET_PACK_BASELINE: "",
					SRO_BUILD_JOBS: "1"
				},
				timeout: CHILD_TIMEOUT_MS,
				windowsHide: true
			} );
		});
	}
}
