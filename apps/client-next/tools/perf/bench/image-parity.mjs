/*
===========================================================================

image-parity.mjs - deterministic shipping-renderer image comparison

Usage: node tools/perf/bench/image-parity.mjs BASE_URL CANDIDATE_URL OUTPUT_DIR

Both URLs must serve the normal Vite modules. No served code is patched.
The fixed model grid exercises character animation and final rasterization;
it does NOT certify player assemblies, cloth, terrain shadows or live crowds.
Run outside performance measurement, under the shared benchmark lock.

===========================================================================
*/
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { launchProbeBrowser } from "../../../../../scripts/lib/probeBrowser.mjs";
import { compareImageTriplet } from "../core/image-parity.mjs";

const WIDTH = 768, HEIGHT = 512;
const MODEL_PATH = "/assets/npc/mob/china/mangnyang.glb";
const FRAME_TIMES = [ 0, .137, .433, 1.017 ];

/*
================
captureGrid

Page-side fixture with a fixed camera, clocks and asset bytes. Unlit material
isolates animation/rasterization from weather and time-dependent lighting.
================
*/
async function captureGrid( { bytes, width, height, times } ) {
	const { createModelDecoder } = await import( "/src/engine/runtime/assets/worker/model/model.ts" );
	const { createRenderer } = await import( "/src/engine/runtime/renderer/renderer.ts" );
	const decoder = createModelDecoder();
	const model = decoder.character( decoder.decode( Uint8Array.from( bytes ) ) );
	for ( const primitive of model.primitives ) {
		primitive.image = -1;
		primitive.geometry.material = {
			...primitive.geometry.material,
			color: [ 1, .4, .2, 1 ],
			unlit: true,
			doubleSided: true,
			blend: false,
			alphaCutoff: 0
		};
	}
	model.images = [];
	const canvas = document.createElement( "canvas" );
	canvas.width = width;
	canvas.height = height;
	document.body.append( canvas );
	const output = document.createElement( "canvas" );
	output.width = width;
	output.height = height;
	const context = output.getContext( "2d", { willReadFrequently: true } );
	if ( !context ) throw Error( "Missing 2D readback context" );
	const renderer = createRenderer( canvas );
	try {
		const deadline = performance.now() + 15000;
		while ( renderer.phase() === "starting" && performance.now() < deadline ) {
			await new Promise( requestAnimationFrame );
		}
		if ( renderer.phase() !== "running" ) throw Error( renderer.error() ?? "Renderer startup timeout" );
		if ( !model.clips.length ) throw Error( "Fixture has no animation clips" );
		// Separate model identities force multiple ordered draws and bundle runs.
		for ( let index = 0; index < 32; index++ ) renderer.setCharacterModel( `parity-model-${index}`, model, [] );
		const camera = { eye: [ 0, 42, -280 ], target: [ 0, 42, 0 ], near: 1, far: 1000, fov: .8 };
		// Exercise retained world bundles, not the direct preview draw lane.
		renderer.setWorld( { id: "image-parity", originRegion: 257, groups: [], warnings: [] } );
		renderer.setWorldCamera( { ...camera, originRegion: 257 } );
		const frames = [];
		for ( const time of times ) {
			const actors = Array.from( { length: 32 }, ( _, index ) => ({
				gid: index + 1,
				model: `parity-model-${index}`,
				clip: model.clips[index % model.clips.length].name,
				time,
				loop: true,
				scale: 1,
				pose: { regionId: 257, x: (index % 8 - 3.5) * 30, y: Math.floor( index / 8 ) * 25, z: 0, yaw: 0 }
			}) );
			renderer.setCharacterActors( actors );
			await renderer.frame( { width, height }, time );
			if ( renderer.error() ) throw Error( renderer.error() );
			const image = await createImageBitmap( canvas );
			context.drawImage( image, 0, 0 );
			image.close();
			const pixels = context.getImageData( 0, 0, width, height ).data;
			let visiblePixels = 0;
			for ( let offset = 0; offset < pixels.length; offset += 4 ) {
				// The native NOLIGHT material path draws white, independently of tint.
				if ( pixels[offset] > 180 ) visiblePixels++;
			}
			// Base64 avoids millions of JSON number entries at the browser boundary.
			const chunks = [], chunkSize = 32768;
			for ( let offset = 0; offset < pixels.length; offset += chunkSize ) {
				chunks.push( String.fromCharCode( ...pixels.subarray( offset, offset + chunkSize ) ) );
			}
			frames.push( {
				time,
				actors,
				visiblePixels,
				rgba: btoa( chunks.join( "" ) ),
				png: output.toDataURL( "image/png" )
			} );
		}
		return { camera, width, height, frames, stats: renderer.characterStats(), userAgent: navigator.userAgent };
	} finally {
		renderer.dispose();
	}
}

/*
================
savePng
================
*/
async function savePng( file, dataUrl ) {
	assert.ok( dataUrl.startsWith( "data:image/png;base64," ) );
	await writeFile( file, Buffer.from( dataUrl.slice( dataUrl.indexOf( "," ) + 1 ), "base64" ) );
}

/*
================
main
================
*/
async function main() {
	const [baselineUrl, candidateUrl, outputDirectory] = process.argv.slice( 2 );
	assert.ok( baselineUrl && candidateUrl && outputDirectory, "Expected BASE_URL CANDIDATE_URL OUTPUT_DIR" );
	const out = path.resolve( outputDirectory );
	await mkdir( out, { recursive: true } );
	const response = await fetch( new URL( MODEL_PATH, baselineUrl ) );
	assert.ok( response.ok, `Fixture asset HTTP ${response.status}` );
	const bytes = new Uint8Array( await response.arrayBuffer() );
	const assetSha256 = createHash( "sha256" ).update( bytes ).digest( "hex" );
	const { browser, page: initialPage } = await launchProbeBrowser( { deviceScaleFactor: 1 } );
	const captures = [];
	try {
		await initialPage.close();
		for (
			const [label, url] of [ [ "baseline", baselineUrl ], [ "repeat", baselineUrl ], [
				"candidate",
				candidateUrl
			] ]
		) {
			const page = await browser.newPage( { deviceScaleFactor: 1 } );
			try {
				// A static same-origin document avoids booting another game session.
				await page.goto( new URL( "/assets/skillfx/manifest.json", url ).href );
				const capture = await page.evaluate( captureGrid, {
					bytes: [ ...bytes ],
					width: WIDTH,
					height: HEIGHT,
					times: FRAME_TIMES
				} );
				assert.ok(
					capture.stats.actors >= 32 && capture.stats.draws >= 32,
					`Fixture must exercise 32 retained actor draws: ${JSON.stringify( capture.stats )}`
				);
				for ( const [index, frame] of capture.frames.entries() ) {
					frame.rgba = Buffer.from( frame.rgba, "base64" );
					await savePng( path.join( out, `${label}-${index}.png` ), frame.png );
					await writeFile( path.join( out, `${label}-${index}.rgba` ), Uint8Array.from( frame.rgba ) );
				}
				captures.push( capture );
			} finally {
				await page.close();
			}
		}
		const rows = [];
		const diffPage = await browser.newPage();
		try {
			for ( let index = 0; index < FRAME_TIMES.length; index++ ) {
				const frames = captures.map( capture => capture.frames[index] );
				assert.deepEqual( frames[0].actors, frames[1].actors );
				assert.deepEqual( frames[0].actors, frames[2].actors );
				const visible = frames.every( frame => frame.visiblePixels > 3200 );
				const result = compareImageTriplet( {
					baseline: frames[0].rgba,
					repeat: frames[1].rgba,
					candidate: frames[2].rgba,
					width: WIDTH,
					height: HEIGHT
				} );
				for ( const name of [ "noise", "change" ] ) {
					const png = await diffPage.evaluate( ( { pixels, width, height } ) => {
						const canvas = document.createElement( "canvas" );
						canvas.width = width;
						canvas.height = height;
						const rgba = Uint8ClampedArray.from( atob( pixels ), character => character.charCodeAt( 0 ) );
						canvas.getContext( "2d" ).putImageData(
							new ImageData( rgba, width, height ),
							0,
							0
						);
						return canvas.toDataURL( "image/png" );
					}, {
						pixels: Buffer.from( result[name].diff ).toString( "base64" ),
						width: WIDTH,
						height: HEIGHT
					} );
					await savePng( path.join( out, `${name}-${index}.png` ), png );
				}
				const { diff: noiseDiff, ...noise } = result.noise;
				const { diff: changeDiff, ...change } = result.change;
				rows.push( {
					time: FRAME_TIMES[index],
					accepted: result.accepted && visible,
					visible,
					visiblePixels: frames.map( f => f.visiblePixels ),
					noise,
					change
				} );
			}
		} finally {
			await diffPage.close();
		}
		const report = {
			scope: "Unlit 32-model animation grid; not live player, cloth, terrain or shadow acceptance",
			baselineUrl,
			candidateUrl,
			baselineRevision: process.env.SRO_PARITY_BASELINE_REVISION ?? "unspecified",
			candidateRevision: process.env.SRO_PARITY_CANDIDATE_REVISION ?? "unspecified",
			assetSha256,
			width: WIDTH,
			height: HEIGHT,
			camera: captures[0].camera,
			userAgent: captures[0].userAgent,
			renderStats: captures.map( capture => capture.stats ),
			rows,
			accepted: rows.every( row => row.accepted )
		};
		await writeFile( path.join( out, "comparison.json" ), JSON.stringify( report, null, 2 ) + "\n" );
		console.log( JSON.stringify( report ) );
		assert.ok( report.accepted, "Exact image parity failed; inspect comparison.json and lossless diffs" );
	} finally {
		await browser.close();
	}
}

await main();
