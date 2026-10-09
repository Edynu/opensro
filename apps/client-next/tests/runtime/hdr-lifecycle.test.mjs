/*
===========================================================================

hdr-lifecycle.test.mjs - HDR scene and preview resolve target lifetime

Exercises the production owner against retained GPU resources. The preview
pipeline must use premultiplied source-over, load the background, and never
reuse a binding to a resized or retired scene target.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createStrictGpu, GPU_TEXTURE_USAGE } from "../helpers/strict-gpu.mjs";
const { createHdr } = await import( "../../src/engine/runtime/renderer/device/hdr.ts" );
globalThis.GPUTextureUsage = GPU_TEXTURE_USAGE;

test("preview resolve loads the background, uses premultiplied blending and rebuilds bindings after resize", () => {
	const gpu = createStrictGpu(), pipelines = [], passes = [];
	const device = {
		...gpu.device,
		createRenderPipeline( descriptor ) {
			pipelines.push( descriptor );
			return gpu.device.createRenderPipeline();
		}
	};
	const hdr = createHdr( /** @type {any} */ (device), "bgra8unorm" );
	const output = gpu.device.createTexture( { label: "canvas", size: [ 32, 32 ] } );
	/*
	================
	encode
	================
	*/
	function encode( draw, preview ) {
		const encoder = gpu.device.createCommandEncoder();
		const tracked = {
			...encoder,
			beginRenderPass( descriptor ) {
				passes.push( descriptor );
				return encoder.beginRenderPass( descriptor );
			}
		};
		if ( preview ) draw.encodePreview( tracked, output.createView() );
		else draw.encode( tracked, output.createView() );
		gpu.device.queue.submit( [ encoder.finish() ] );
	}
	try {
		assert.equal( hdr.prepare( 32, 32, false ), undefined );
		assert.equal( pipelines.length, 0, "disabled HDR compiles neither resolve" );
		const first = hdr.prepare( 32, 32, true );
		assert.equal( pipelines.length, 1 );
		encode( first, false );
		encode( first, true );
		assert.equal( pipelines.length, 2 );
		assert.equal( passes[0].colorAttachments[0].loadOp, "clear" );
		assert.equal( passes[1].colorAttachments[0].loadOp, "load" );
		assert.deepEqual( pipelines[1].fragment.targets[0].blend, {
			color: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
			alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" }
		} );
		const resized = hdr.prepare( 64, 64, true );
		assert.throws( () => encode( first, false ), /Stale HDR target/ );
		assert.throws( () => encode( first, true ), /Stale HDR target/ );
		encode( resized, true );
		assert.equal( pipelines.length, 2, "resize rebinds, without recompiling the preview" );
		hdr.prepare( 64, 64, false );
		assert.throws( () => encode( resized, true ), /Stale HDR target/ );
		encode( hdr.prepare( 32, 32, true ), true );
	} finally {
		hdr.dispose();
		output.destroy();
	}
	assert.equal( gpu.live(), 0 );
});
