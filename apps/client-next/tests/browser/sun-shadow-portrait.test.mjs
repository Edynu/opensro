/*
===========================================================================

sun-shadow-portrait.test.mjs - local portraits cannot receive world shadows

Render identical world and portrait-local geometry through the production
geometry owner and shader. A real cascade occluder must darken the world
receiver while leaving every portrait pixel unchanged.

===========================================================================
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { launchProbeBrowser } from "../../../../scripts/lib/probeBrowser.mjs";
import { CLIENT_NEXT_BASE_URL } from "../../../../scripts/lib/probeEndpoints.mjs";

/*
================
capturePortraitReceiver

Serialized unchanged into Chrome; no production-source rewriting and no
asset dependencies. The local receiver uses the same world=false upload
contract as player/party portraits and the inventory doll.
================
*/
async function capturePortraitReceiver() {
	const { createGeometryResources } = await import( "/src/engine/runtime/renderer/device/geometry.ts" );
	const { createPipelines } = await import( "/src/engine/runtime/renderer/device/pipelines.ts" );
	const { viewProjection } = await import( "/src/engine/foundation/rendering/world-math.ts" );
	const { ENVIRONMENT_UNIFORM_BYTES } = await import( "/src/engine/runtime/renderer/device/environment-block.ts" );
	const adapter = await navigator.gpu.requestAdapter();
	if ( !adapter ) throw Error( "No WebGPU adapter" );
	const device = await adapter.requestDevice();
	const errors = [];
	device.addEventListener( "uncapturederror", event => errors.push( event.error.message ) );
	const size = 64, bytesPerRow = size * 4;
	const format = "rgba8unorm";
	const environment = device.createBuffer( {
		size: ENVIRONMENT_UNIFORM_BYTES,
		usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
	} );
	const color = device.createTexture( {
		size: [ size, size ],
		format,
		usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
	} );
	const depth = device.createTexture( {
		size: [ size, size ],
		format: "depth24plus",
		usage: GPUTextureUsage.RENDER_ATTACHMENT
	} );
	const readback = device.createBuffer( {
		size: bytesPerRow * size,
		usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
	} );
	const pipelines = createPipelines( device, format );
	const geometry = createGeometryResources(
		device,
		() => device,
		error => errors.push( String( error ) ),
		pipelines.geometry,
		{
			texture() {
				throw Error( "Textureless witness requested an image" );
			},
			acquire() {},
			drop() {}
		},
		pipelines.worldSampler,
		pipelines.lightmapSampler,
		environment
	);
	try {
		await Promise.all( [ pipelines.ready, geometry.ready ] );
		const transform = viewProjection( {
			eye: [ 0, 60, -60 ],
			target: [ 0, 0, 0 ],
			fov: 1,
			near: 1,
			far: 500
		}, 1 );
		geometry.worldView( transform );
		geometry.refreshShadowBindings( true );
		const material = {
			color: [ 0.8, 0.8, 0.8, 1 ],
			unlit: false,
			objectLight: 1,
			fogDisabled: true,
			doubleSided: true,
			blend: false
		};
		/*
		================
		quad
		================
		*/
		function quad( world, x, y, radius ) {
			return geometry.commands.upload( {
				world,
				transform,
				material,
				positions: Float32Array.of(
					x - radius,
					y,
					-radius,
					x + radius,
					y,
					-radius,
					x + radius,
					y,
					radius,
					x - radius,
					y,
					radius
				),
				normals: Float32Array.of( 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0 ),
				indices: Uint32Array.of( 0, 1, 2, 0, 2, 3 )
			} );
		}
		const world = quad( true, 0, 0, 20 ), portrait = quad( false, 0, 0, 20 );
		// The diagonal sunlight projects this elevated quad onto the middle
		// of both receivers' numerically identical positions.
		const caster = quad( true, 20, 20, 10 );
		const cascade = geometry.sunShadow();
		const env = new Float32Array( ENVIRONMENT_UNIFORM_BYTES / 4 );
		env.set( [ 0.8, 0.8, 0.8, 1 ], 8 );
		env.set( [ 0.15, 0.15, 0.15, 1 ], 12 );
		env[32] = 10000;
		const captures = {};
		for ( const enabled of [ false, true ] ) {
			for ( const occluded of [ false, true ] ) {
				for ( const [name, receiver] of [ [ "world", world ], [ "portrait", portrait ] ] ) {
					env[93] = enabled ? 1 : 0;
					device.queue.writeBuffer( environment, 0, env );
					cascade.prepare( true, [ 0, 0, 0 ], [ 0.70710678, 0.70710678, 0 ] );
					const encoder = device.createCommandEncoder();
					cascade.encode( encoder, occluded ? [ caster ] : [] );
					const pass = encoder.beginRenderPass( {
						colorAttachments: [ {
							view: color.createView(),
							clearValue: [ 0, 0, 0, 1 ],
							loadOp: "clear",
							storeOp: "store"
						} ],
						depthStencilAttachment: {
							view: depth.createView(),
							depthClearValue: 1,
							depthLoadOp: "clear",
							depthStoreOp: "discard"
						}
					} );
					pass.setPipeline( receiver.pipeline );
					pass.setBindGroup( 0, receiver.binding );
					pass.setVertexBuffer( 0, receiver.vertices );
					pass.setIndexBuffer( receiver.indices, "uint32" );
					pass.drawIndexed( receiver.indexCount, receiver.instanceCount );
					pass.end();
					encoder.copyTextureToBuffer(
						{ texture: color },
						{ buffer: readback, bytesPerRow },
						[ size, size ]
					);
					device.queue.submit( [ encoder.finish() ] );
					await readback.mapAsync( GPUMapMode.READ );
					captures[`${name}-${enabled}-${occluded}`] = Array.from(
						new Uint8Array( readback.getMappedRange() )
					);
					readback.unmap();
				}
			}
		}
		return { captures, errors };
	} finally {
		geometry.dispose();
		for ( const resource of [ environment, color, depth, readback ] ) resource.destroy();
		device.destroy();
	}
}

test( "world occluders shade world geometry but never portrait-local pixels", { timeout: 120000 }, async () => {
	const { browser, page } = await launchProbeBrowser();
	try {
		await page.route( CLIENT_NEXT_BASE_URL + "/", route =>
			route.fulfill( {
				contentType: "text/html",
				body: "<!doctype html><body></body>"
			} ) );
		await page.goto( CLIENT_NEXT_BASE_URL );
		const { captures, errors } = await page.evaluate( capturePortraitReceiver );
		assert.deepEqual( errors, [] );
		const lit = captures["world-true-false"], shadowed = captures["world-true-true"];
		const bright = lit.filter( ( value, index ) => index % 4 === 0 && value > 80 ).length;
		const darker = lit.filter( ( value, index ) => index % 4 === 0 && shadowed[index] < value - 20 ).length;
		assert.ok( bright > 100, "witness contains visible lit receiver pixels" );
		assert.ok( darker > 20, "the real caster must shade the world receiver" );
		for ( const enabled of [ false, true ] ) {
			for ( const occluded of [ false, true ] ) {
				assert.deepEqual(
					captures[`portrait-${enabled}-${occluded}`],
					lit,
					"portraits ignore world shadow state"
				);
			}
		}
		assert.deepEqual( captures["world-false-true"], lit, "disabled Experimental stage does not shade world draws" );
	} finally {
		await browser.close();
	}
} );
