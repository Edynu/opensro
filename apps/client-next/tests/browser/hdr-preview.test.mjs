/*
===========================================================================

hdr-preview.test.mjs - real GPU coverage and layering for HDR character preview

Production device geometry, UI, bloom and frame owners render a synthetic
preview over opaque background art and beneath foreground controls. Half
opacity and overlapping layers witness coverage rather than native alpha
squared, while native-off captures must survive the toggle round trip.
The same draws also traverse a portrait texture and ordinary UI sampling:
that consumer must retain authored alpha, including additive contributions.
Reduced-scale captures keep the preview's depth attachment compatible while
a one-pixel foreground stripe witnesses full-resolution HUD composition.

===========================================================================
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { launchProbeBrowser } from "../../../../scripts/lib/probeBrowser.mjs";
import { CLIENT_NEXT_BASE_URL } from "../../../../scripts/lib/probeEndpoints.mjs";

/*
================
capturePreview
================
*/
/** @param {{ portrait?: boolean, renderScale?: 50 | 75 | 100, scaleCoverage?: boolean }} options */
async function capturePreview( { portrait = false, renderScale = 100, scaleCoverage = false } = {} ) {
	const { createDevice } = await import( "/src/engine/runtime/renderer/device/device.ts" );
	const { createFrame } = await import( "/src/engine/runtime/renderer/frame/frame.ts" );
	const { createSurface } = await import( "/src/engine/runtime/renderer/surface/surface.ts" );
	const { experimentalOptions, experimentalVideo } = await import(
		"/src/engine/foundation/ui/experimental-options.ts"
	);
	const { D3DBLEND_SRCALPHA, D3DBLEND_ONE } = await import( "/src/engine/foundation/rendering/blend-state.ts" );
	const SIZE = 64, TIMEOUT_MS = 15000;
	const sceneSize = Math.max( 1, Math.round( SIZE * renderScale / 100 ) ), scaled = renderScale < 100;
	const canvas = document.createElement( "canvas" ), copy = document.createElement( "canvas" );
	copy.width = copy.height = SIZE;
	const context = copy.getContext( "2d", { willReadFrequently: true } );
	if ( !context ) throw Error( "No pixel capture context" );
	document.body.append( canvas );
	const device = createDevice();
	let surface;
	const identity = Float32Array.of( 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 );
	const draws = [];
	try {
		const deadline = performance.now() + TIMEOUT_MS;
		while ( device.phase() === "starting" && performance.now() < deadline ) {
			await new Promise( requestAnimationFrame );
		}
		if ( device.phase() !== "running" ) throw Error( device.error() ?? "Device startup timeout" );
		const commands = device.commands(), surfaceCommands = device.surfaceCommands(), geometry = device.geometry();
		if ( !commands || !surfaceCommands || !geometry ) throw Error( "Missing device capabilities" );
		surface = createSurface( canvas, surfaceCommands, device.format() );
		/*
		================
		quad
		================
		*/
		function quad( left, right, alpha, mode = "normal" ) {
			const draw = geometry.upload( {
				positions: Float32Array.of( left, -.5, .5, right, -.5, .5, right, .5, .5, left, .5, .5 ),
				indices: Uint32Array.of( 0, 1, 2, 0, 2, 3 ),
				transform: identity,
				material: {
					color: [ 1, 0, 0, alpha ],
					unlit: true,
					blend: alpha < 1 && mode !== "cutout",
					...(mode === "additive" ?
						{ blendPair: { source: D3DBLEND_SRCALPHA, destination: D3DBLEND_ONE } } :
						{}),
					doubleSided: true,
					fogDisabled: true,
					alphaCutoff: mode === "cutout" ? .25 : 0
				}
			} );
			draws.push( draw );
			return draw;
		}
		const opaque = quad( -.75, -.25, 1 ), translucent = quad( -.25, .75, .5 );
		const overlap = quad( .25, .75, .5 );
		const cutout = quad( .75, .95, .5, "cutout" ), additive = quad( -.95, -.75, .5, "additive" );
		const preview = [ opaque, translucent, overlap, cutout, additive ];
		const results = [];
		for ( const mode of [ "off", "hdr", "hdr-bloom", "hdr-float-bloom", "off" ] ) {
			const hdrOn = mode !== "off", bloomOn = mode.includes( "bloom" );
			device.experimentalVideo( experimentalVideo( experimentalOptions( {
				renderScale,
				hdrToneMap: hdrOn,
				floatBloom: mode === "hdr-float-bloom"
			} ) ) );
			device.beginFrame();
			try {
				const targetSurface = surface;
				const sceneView = surface.acquire( { width: SIZE, height: SIZE }, false, renderScale );
				const view = scaled ? surface.frameView() : sceneView;
				device.worldView( identity, new Float32Array( 88 ), false );
				const portraitTarget = portrait ? device.portraitTarget( "__portrait", SIZE, SIZE ) : undefined;
				const ui = device.ui( {
					revision: 1,
					width: SIZE,
					height: SIZE,
					quads: [
						{
							rect: [ 0, 0, SIZE, SIZE ],
							clip: [ 0, 0, SIZE, SIZE ],
							uv: [ 0, 0, 1, 1 ],
							texture: "",
							color: [ 0, 0, 1, 1 ],
							layer: "background"
						},
						...(portrait ?
							/** @type {import('../../src/engine/contracts/ui').UiQuad[]} */ ([ {
								rect: [ 0, 0, SIZE, SIZE ],
								clip: [ 0, 0, SIZE, SIZE ],
								uv: [ 0, 0, 1, 1 ],
								texture: "__portrait",
								color: [ 1, 1, 1, 1 ]
							} ]) :
							[]),
						{
							rect: [ 12, 28, 8, 8 ],
							clip: [ 0, 0, SIZE, SIZE ],
							uv: [ 0, 0, 1, 1 ],
							texture: "",
							color: [ 0, 1, 0, 1 ]
						},
						...(scaleCoverage ?
							/** @type {import('../../src/engine/contracts/ui').UiQuad[]} */ ([ {
								rect: [ 17, 28, 1, 8 ],
								clip: [ 0, 0, SIZE, SIZE ],
								uv: [ 0, 0, 1, 1 ],
								texture: "",
								color: [ 1, 1, 0, 1 ]
							} ]) :
							[])
					]
				} );
				await createFrame( commands ).draw(
					view,
					undefined,
					undefined,
					surface.depth(),
					[],
					ui,
					portrait ? [] : geometry.hdrPreview( preview ),
					undefined,
					undefined,
					portraitTarget ?
						{
							target: portraitTarget,
							depth: scaled ? surface.frameDepth() : surface.depth(),
							draws: preview
						} :
						undefined,
					undefined,
					[],
					undefined,
					undefined,
					device.bloom( sceneSize, sceneSize, bloomOn ),
					undefined,
					{
						hdr: device.hdr( sceneSize, sceneSize, hdrOn ),
						sceneScale: scaled ?
							{
								view: sceneView,
								frameDepth: surface.frameDepth(),
								resolve: ( encoder, target ) =>
									device.upscale().encodeUpscale( encoder, sceneView, target ),
								resolveDepth: encoder =>
									device.upscale().encodeDepthUpscale(
										encoder,
										targetSurface.depth(),
										targetSurface.frameDepth()
									)
							} :
							undefined
					},
					surface
				);
				const image = await createImageBitmap( canvas );
				context.drawImage( image, 0, 0 );
				image.close();
				if ( scaleCoverage ) await new Promise( requestAnimationFrame );
				if ( device.error() ) throw Error( `${mode}: ${device.error()}` );
				results.push( {
					mode,
					canvasSize: [ canvas.width, canvas.height ],
					hudStripe: [ ...context.getImageData( 16, 32, 3, 1 ).data ],
					hudLeft: [ ...context.getImageData( 12, 32, 1, 1 ).data ],
					hudRight: [ ...context.getImageData( 19, 32, 1, 1 ).data ],
					background: [ ...context.getImageData( 2, 2, 1, 1 ).data ],
					opaque: [ ...context.getImageData( 16, 20, 1, 1 ).data ],
					foreground: [ ...context.getImageData( 16, 32, 1, 1 ).data ],
					half: [ ...context.getImageData( 32, 32, 1, 1 ).data ],
					overlap: [ ...context.getImageData( 48, 32, 1, 1 ).data ],
					cutout: [ ...context.getImageData( 60, 32, 1, 1 ).data ],
					additive: [ ...context.getImageData( 4, 32, 1, 1 ).data ]
				} );
			} finally {
				device.endFrame();
			}
		}
		return results;
	} finally {
		for ( const draw of draws ) device.geometry()?.release( draw );
		surface?.dispose();
		device.dispose();
		canvas.remove();
	}
}

test( "HDR preview preserves UI layering, transparent margins and overlapping coverage with either bloom chain", {
	timeout: 60000
}, async () => {
	const { browser, page } = await launchProbeBrowser();
	const errors = [];
	page.on( "pageerror", error => errors.push( error.message ) );
	try {
		await page.route( CLIENT_NEXT_BASE_URL + "/", route =>
			route.fulfill( {
				contentType: "text/html",
				body: "<!doctype html><body></body>"
			} ) );
		await page.goto( CLIENT_NEXT_BASE_URL );
		const rows = await page.evaluate( capturePreview, {} );
		assert.deepEqual( rows.at( -1 ), rows[0], "native-off pixels survive the HDR toggle round trip" );
		for ( const row of rows ) {
			assert.deepEqual( row.background, [ 0, 0, 255, 255 ], row.mode + " transparent margin" );
			assert.deepEqual( row.foreground, [ 0, 255, 0, 255 ], row.mode + " foreground above preview" );
			const red = row.mode === "off" ? 255 : 205;
			const samples = /** @type {[string, number[]][]} */ ([
				[ "opaque", [ red, 0, 0, 255 ] ],
				[ "cutout", [ red, 0, 0, 255 ] ],
				[ "additive", [ row.mode === "off" ? 127.5 : 157, 0, 255, 255 ] ],
				[ "half", [ red * .5, 0, 127.5, 255 ] ],
				[ "overlap", [ red * .75, 0, 63.75, 255 ] ]
			]);
			for ( const [name, expected] of samples ) {
				for ( let channel = 0; channel < 4; channel++ ) {
					assert.ok(
						Math.abs( row[name][channel] - expected[channel] ) <= 2,
						`${row.mode} ${name}: ${row[name]} expected ${expected}`
					);
				}
			}
		}
		assert.deepEqual( errors, [] );
	} finally {
		await browser.close();
	}
} );

test( "HDR portrait additive pixels survive the ordinary UI texture consumer", { timeout: 60000 }, async () => {
	const { browser, page } = await launchProbeBrowser();
	const errors = [];
	page.on( "pageerror", error => errors.push( error.message ) );
	try {
		await page.route(
			CLIENT_NEXT_BASE_URL + "/",
			route => route.fulfill( { contentType: "text/html", body: "<!doctype html><body></body>" } )
		);
		await page.goto( CLIENT_NEXT_BASE_URL );
		const rows = await page.evaluate( capturePreview, { portrait: true } );
		assert.deepEqual( rows.at( -1 ), rows[0], "portrait native-off round trip" );
		for ( const row of rows ) {
			// SRCALPHA/ONE stores red .5 and alpha .25; the unchanged UI
			// consumer yields red .125 over blue .75. Coverage alpha zero
			// would silently erase the additive pixel at that second consumer.
			const expected = [ 31.875, 0, 191.25, 255 ];
			for ( let channel = 0; channel < 4; channel++ ) {
				assert.ok(
					Math.abs( row.additive[channel] - expected[channel] ) <= 2,
					`${row.mode} portrait additive: ${row.additive} expected ${expected}`
				);
			}
			for ( const sample of [ "background", "foreground", "opaque", "cutout", "half", "overlap" ] ) {
				for ( let channel = 0; channel < 4; channel++ ) {
					assert.ok(
						Math.abs( row[sample][channel] - rows[0][sample][channel] ) <= 2,
						`${row.mode} portrait ${sample}: ${row[sample]} expected native ${rows[0][sample]}`
					);
				}
			}
		}
		assert.deepEqual( errors, [] );
	} finally {
		await browser.close();
	}
} );

test( "scaled previews retain HDR coverage and full-resolution HUD layering at 50 and 75 percent", {
	timeout: 60000
}, async () => {
	const { browser, page } = await launchProbeBrowser();
	const errors = [];
	page.on( "pageerror", error => errors.push( error.message ) );
	try {
		await page.route(
			CLIENT_NEXT_BASE_URL + "/",
			route => route.fulfill( { contentType: "text/html", body: "<!doctype html><body></body>" } )
		);
		await page.goto( CLIENT_NEXT_BASE_URL );
		const nativeSize = await page.evaluate( capturePreview, { scaleCoverage: true } );
		const scales = /** @type {const} */ ([ 50, 75 ]);
		const GREEN = [ 0, 255, 0, 255 ], YELLOW = [ 255, 255, 0, 255 ];
		const COLOR_TOLERANCE = 2;
		for ( const renderScale of scales ) {
			const rows = await page.evaluate( capturePreview, { renderScale, scaleCoverage: true } );
			assert.deepEqual( rows.map( row => row.mode ), [ "off", "hdr", "hdr-bloom", "hdr-float-bloom", "off" ] );
			assert.deepEqual( rows.at( -1 ), rows[0], `${renderScale}% native preview survives HDR toggles` );
			for ( const [index, row] of rows.entries() ) {
				const label = `${renderScale}% ${row.mode}`;
				assert.deepEqual( row.canvasSize, [ 64, 64 ], label + " full-resolution canvas" );
				assert.deepEqual( row.background, [ 0, 0, 255, 255 ], label + " transparent preview margin" );
				assert.deepEqual( row.foreground, GREEN, label + " foreground above opaque preview" );
				assert.deepEqual( row.hudStripe, [ ...GREEN, ...YELLOW, ...GREEN ], label + " one-pixel HUD stripe" );
				assert.deepEqual( row.hudLeft, GREEN, label + " crisp HUD left edge" );
				assert.deepEqual( row.hudRight, GREEN, label + " crisp HUD right edge" );
				// These samples lie inside solid regions, away from the scaled
				// silhouette: only preview coverage and composition may affect them.
				const red = row.mode === "off" ? 255 : 205;
				const samples = /** @type {[string, number[]][]} */ ([
					[ "opaque", [ red, 0, 0, 255 ] ],
					[ "half", [ red * .5, 0, 127.5, 255 ] ],
					[ "overlap", [ red * .75, 0, 63.75, 255 ] ]
				]);
				for ( const [name, expected] of samples ) {
					for ( let channel = 0; channel < 4; channel++ ) {
						assert.ok(
							Math.abs( row[name][channel] - expected[channel] ) <= COLOR_TOLERANCE,
							`${label} ${name}: ${row[name]} expected ${expected}`
						);
						assert.ok(
							Math.abs( row[name][channel] - nativeSize[index][name][channel] ) <= COLOR_TOLERANCE,
							`${label} ${name} coverage differs from its full-resolution mode`
						);
					}
				}
			}
		}
		assert.deepEqual( errors, [] );
	} finally {
		await browser.close();
	}
} );
