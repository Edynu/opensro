/*
===========================================================================

skyImagePublication.test.mjs - the sky publisher ships only consumed formats

The flares bind their native containers (flareTexturePublicPaths) and the
sun disc its PNG, so the flare-only lens PNGs have no consumer: publishing
them packed them into the game-images startup group for nothing (issue
#273, delivery duplicates). Synthetic sources inside the test's own
generated root prove the split; the lens build is injected as a no-op.

===========================================================================
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const generatedRoot = await mkdtemp( path.join( os.tmpdir(), "sro-sky-published-" ) );
process.env.SRO_GENERATED_ROOT = generatedRoot;

const { copyReferencedSkyImages, resolveSkyTextures } = await import( "../../build/world/assets/copySkyImages.mjs" );
const { imageSourceRoot, imagePublicRoot } = await import( "../../build/world/paths.mjs" );
const { exists } = await import( "../../build/world/io.mjs" );

test.after( () => rm( generatedRoot, { recursive: true, force: true } ) );

const FLARE_ONLY = [ "lens1", "lens3", "lens4", "lens5", "lens6", "lens7", "lens8" ],
	SUN = "lens2",
	SKY = [
		{ role: "sun", sourcePath: "sun/lens2.ddj" },
		...FLARE_ONLY.map( name => ({ role: "flare", sourcePath: `sun/${name}.ddj` }) ),
		{ role: "weather", sourcePath: "weather/rain1.ddj" },
		{ role: "glow", sourcePath: "skybox/glow.ddj" },
		{ role: "cloud", sourcePath: "skybox/cloud1.ddj" },
		{ role: "shadowSphere", sourcePath: "skybox/shadowsphere.ddj" },
		{ role: "moon", sourcePath: "sun/moon01.ddj" }
	];

/*
================
seed
================
*/
async function seed( relative, bytes = "fixture" ) {
	const source = path.join( imageSourceRoot, "Map_extracted", ...relative.split( "/" ) );
	await mkdir( path.dirname( source ), { recursive: true } );
	await writeFile( source, bytes );
	return source;
}

/*
================
published
================
*/
function published( relative ) {
	return exists( path.join( imagePublicRoot, "Map_extracted", ...relative.split( "/" ) ) );
}

test("a missing native lens container still fails the publication", async () => {
	// The PNG conversions exist, but this run seeds no containers at all:
	// the copy must refuse to publish flares without their native resource.
	for ( const texture of SKY ) {
		await seed( texture.sourcePath.replace( /\.ddj$/, ".png" ) );
	}
	await assert.rejects(
		() => copyReferencedSkyImages( { textures: SKY }, async () => {} ),
		/Native lens generation did not publish/
	);
});

test("the sky publisher ships every consumed format and no flare-only PNG", async () => {
	// Every source the copy loop may reach: the PNG conversions of all sky
	// textures and the native containers of the eight lenses.
	for ( const texture of SKY ) {
		await seed( texture.sourcePath.replace( /\.ddj$/, ".png" ) );
	}
	for ( const name of [ SUN, ...FLARE_ONLY ] ) {
		await seed( `sun/${name}.texture`, "ntx-fixture" );
	}
	await copyReferencedSkyImages( { textures: SKY }, async () => {} );

	// The flares bind their containers: those always ship.
	for ( const name of [ SUN, ...FLARE_ONLY ] ) {
		assert.ok( await published( `sun/${name}.texture` ), `${name}.texture must publish` );
	}
	// The sun disc (lens2) keeps its PNG: the renderer binds it directly.
	assert.ok( await published( "sun/lens2.png" ), "the sun disc's PNG must publish" );
	// The flare-only lenses have no PNG consumer: the duplicate never ships.
	for ( const name of FLARE_ONLY ) {
		assert.equal( await published( `sun/${name}.png` ), false, `${name}.png must not publish` );
	}
	// Every other sky texture keeps its authored PNG delivery.
	for (
		const relative of [
			"weather/rain1.png",
			"skybox/glow.png",
			"skybox/cloud1.png",
			"skybox/shadowsphere.png",
			"sun/moon01.png"
		]
	) {
		assert.ok( await published( relative ), `${relative} must publish` );
	}
});

test("every published sky texture row names a file the publisher ships", () => {
	// A row is data the client and audits read: it must never name the PNG a
	// flare no longer publishes.
	for ( const row of resolveSkyTextures().textures ) {
		if ( row.role === "flare" ) assert.match( row.publicPath, /\/sun\/lens\d\.texture$/, row.sourcePath );
		else assert.match( row.publicPath, /\.png$/, row.sourcePath );
	}
});
