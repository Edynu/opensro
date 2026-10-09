/*
===========================================================================

render-scale.test.mjs - the scene renders small, presents big, HUD full

Loads the Constantinople dock fixture through the real renderer, once at
the native 100% and once at Experimental 50% render scale. The scaled frame must present through the upscale
onto the same full-size canvas with no device error, keep draining the
world the same way, and produce a recognisably softer but structurally
similar image - while the canvas itself never shrinks.
===========================================================================
*/
import { CLIENT_PUBLIC_ROOT } from "../../../../scripts/lib/generatedRoot.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
	readPublishedAssetJsonSync as read,
	readPublishedAssetBytesSync as bytes
} from "../../../../scripts/lib/publishedAsset.mjs";
import { launchProbeBrowser } from "../../../../scripts/lib/probeBrowser.mjs";
import { CLIENT_NEXT_BASE_URL } from "../../../../scripts/lib/probeEndpoints.mjs";
import { captureRenderScale } from "../helpers/render-scale-gpu.mjs";

test(
	"scaled scene keeps sharp labels, occlusion and HUD through effects, resize and recovery",
	{ timeout: 120000 },
	async () => {
		const { browser, page } = await launchProbeBrowser();
		const errors = [];
		page.on( "pageerror", error => errors.push( error.message ) );
		try {
			await page.goto( new URL( "/tests/browser/fixtures/ui-bridge.html", CLIENT_NEXT_BASE_URL ).href );
			const rows = await page.evaluate( captureRenderScale, { recover: true } );
			const pixel = ( row, x, y ) => row.rgba.slice( (y * row.width + x) * 4, (y * row.width + x) * 4 + 4 );
			const native = rows[0];
			for ( const row of rows ) {
				assert.deepEqual( [ row.width, row.height ], row.mode === "resize" ? [ 173, 111 ] : [ 129, 97 ] );
				assert.deepEqual(
					pixel( row, 13, 14 ),
					[ 255, 0, 255, 255 ],
					row.mode + " retains visible world labels"
				);
				assert.notDeepEqual(
					pixel( row, 63, 48 ),
					[ 0, 255, 255, 255 ],
					row.mode + " occludes labels behind geometry"
				);
				for ( let x = 100; x <= 108; x++ ) {
					assert.deepEqual(
						pixel( row, x, 14 ),
						pixel( native, x, 14 ),
						row.mode + " preserves one-pixel HUD detail"
					);
				}
			}
			assert.notDeepEqual(
				rows.find( row => row.mode === "plain-50" ).rgba,
				native.rgba,
				"scale changes scene pixels"
			);
			assert.deepEqual( rows.at( -1 ).rgba, native.rgba, "100 restores every native pixel after resize" );
			assert.deepEqual(
				rows.find( row => row.mode === "recovered" ).rgba,
				rows.find( row => row.mode === "before-recovery" ).rgba
			);
			assert.deepEqual( errors, [] );
		} finally {
			await browser.close();
		}
	}
);

test(
	"a 50% render scale presents an upscaled scene on the full-size canvas",
	{ timeout: 300000 },
	async () => {
		const publicRoot = CLIENT_PUBLIC_ROOT + "/";
		const bundle = read( "/assets/world/constantinople/region-694e.json", publicRoot );
		const resources = bundle.objects.resources;
		const refs = resources.bsr.filter( r => r.objectId === 1630 );
		bundle.objects.placements = bundle.objects.placements.filter( p => p.objectId === 1630 );
		resources.bsr = refs;
		resources.meshes = resources.meshes.filter( m => refs.some( r => r.meshPaths.includes( m.sourcePath ) ) );
		resources.materialSets = resources.materialSets.filter( m =>
			refs.some( r => r.materialPaths.includes( m.sourcePath ) )
		);
		for ( const sector of bundle.terrain.sectors ?? [] ) {
			sector.blocks = sector.blocks.filter( b => {
				const x = (sector.sectorX - bundle.source.sectorX) * 6 + b.blockX,
					z = (sector.sectorY - bundle.source.sectorY) * 6 + b.blockZ;
				return x >= 12 && x <= 19 && z >= -1 && z <= 5;
			} );
		}
		const camera = read( "/assets/title/constantinople/manifest.json", publicRoot ).camera;
		const { browser, page } = await launchProbeBrowser();
		const consoles = [];
		page.on( "console", m => consoles.push( m.type() + ": " + m.text() ) );
		page.on( "pageerror", e => consoles.push( "pageerror: " + e.message ) );
		try {
			await page.route( "**/assets/**", route => {
				const path = new URL( route.request().url() ).pathname;
				if ( !path.startsWith( "/assets/" ) ) return route.continue();
				try {
					return route.fulfill( { body: Buffer.from( bytes( path, publicRoot ) ) } );
				} catch {
					return route.abort();
				}
			} );
			await page.goto( new URL( "/tests/browser/fixtures/ui-bridge.html", CLIENT_NEXT_BASE_URL ).href );
			const result = await page.evaluate( async ( { bundle, camera } ) => {
				const { decodeDxt1 } = await import( "/src/engine/foundation/assets/dds.ts" );
				const { decodeNativeTexture } = await import(
					"/src/engine/foundation/assets/native-texture.ts"
				);
				const { createRenderer } = await import( "/src/engine/runtime/renderer/renderer.ts" );
				const { createWorldDecoder } = await import( "/src/engine/runtime/assets/worker/world/world.ts" );
				const { sampleFrontendCamera, frontendCameraView } = await import(
					"/src/engine/foundation/rendering/frontend-camera.ts"
				);
				const { experimentalOptions, experimentalVideo } = await import(
					"/src/engine/foundation/ui/experimental-options.ts"
				);
				const canvas = document.createElement( "canvas" ),
					r = createRenderer(
						canvas,
						(await import( "/src/engine/runtime/random/random.ts" )).createPresentationRandom( 1 )
					);
				const scene = { ...createWorldDecoder().decode( bundle, true ), terrainDetail: "full" };
				const textures = new Map();
				const deadline = performance.now() + 15000;
				while ( r.phase() === "starting" && performance.now() < deadline ) {
					await new Promise( requestAnimationFrame );
				}
				if ( r.phase() !== "running" ) throw Error( r.error() ?? "GPU startup deadline" );
				const stats = async () => {
					const probe = document.createElement( "canvas" );
					probe.width = 1823;
					probe.height = 845;
					const ctx = probe.getContext( "2d" );
					if ( !ctx ) throw Error( "2d context unavailable" );
					const image = await createImageBitmap( canvas );
					ctx.drawImage( image, 0, 0 );
					image.close();
					let lit = 0;
					const data = ctx.getImageData( 0, 0, 1823, 845 ).data;
					for ( let i = 0; i < data.length; i += 40 ) {
						if ( data[i] > 24 || data[i + 1] > 24 || data[i + 2] > 24 ) lit++;
					}
					return lit;
				};
				const capture = async id => {
					r.setWorld( { ...scene, id } );
					r.setWorldCamera( frontendCameraView( sampleFrontendCamera( camera, 0.7 ) ) );
					for ( const path of r.neededWorldTextures() ) {
						if ( !textures.has( path ) ) {
							const response = await fetch( path );
							if ( !response.ok ) throw Error( `Texture HTTP ${response.status}: ${path}` );
							const blob = await response.blob();
							if ( path.endsWith( ".texture" ) ) {
								textures.set( path, decodeNativeTexture( new Uint8Array( await blob.arrayBuffer() ) ) );
							} else if ( path.endsWith( ".dds" ) ) {
								const image = decodeDxt1( new Uint8Array( await blob.arrayBuffer() ) );
								textures.set(
									path,
									await createImageBitmap( new ImageData( image.pixels, image.width, image.height ) )
								);
							} else textures.set( path, await createImageBitmap( blob ) );
						}
						const texture = textures.get( path );
						r.setWorldTexture(
							path,
							"kind" in texture ? structuredClone( texture ) : await createImageBitmap( texture )
						);
					}

					let k = 0;
					do {
						await r.frame( { width: 1823, height: 845 }, k++ * .016 );
						await new Promise( requestAnimationFrame );
						if ( r.error() || k > 1000 ) {
							throw Error(
								JSON.stringify( {
									error: r.error(),
									stats: r.worldStats(),
									missing: r.neededWorldTextures()
								} )
							);
						}
					} while ( k < 10 || r.worldStats().pendingGroups || r.worldStats().pendingTextures );
					return await stats();
				};
				// Direct, exactly the environment-stages pattern that works here.
				const direct = await capture( "direct" );
				// Retain at native size: postProcessing on, nothing else.
				const experimental = experimentalVideo( experimentalOptions( { postProcessing: true } ) );
				r.experimentalVideo( experimental );
				const retained = await capture( "retained" );
				r.experimentalVideo( { ...experimental, postProcessing: false } );
				// Reduced resolution is explicitly selected under Experimental.
				r.experimentalVideo( experimentalVideo( experimentalOptions( { renderScale: 50 } ) ) );
				const half = await capture( "half" );
				const halfCanvas = [ canvas.width, canvas.height ];
				r.experimentalVideo( experimentalVideo( experimentalOptions() ) );
				const directAgain = await capture( "direct-again" );
				r.dispose();
				return { direct, retained, half, halfCanvas, directAgain, error: r.error() };
			}, { bundle, camera } );
			assert.equal( result.error, null );
			assert.ok( result.direct > 5000, JSON.stringify( result ) );
			assert.ok(
				result.retained > 5000,
				"retained frame must present: " + JSON.stringify( result ) +
					" console: " + consoles.slice( -12 ).join( " | " )
			);
			// The canvas never shrinks: the scale touches only the scene.
			assert.deepEqual( result.halfCanvas, [ 1823, 845 ] );
			assert.ok( result.half > 5000, "scaled frame must present: " + JSON.stringify( result ) );
			assert.ok( result.directAgain > 5000, JSON.stringify( result ) );
		} finally {
			await browser.close();
		}
	}
);
