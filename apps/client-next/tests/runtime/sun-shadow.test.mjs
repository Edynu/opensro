/*
===========================================================================

sun-shadow.test.mjs - the cascade caster's texture addressing contract

Observe the sampler actually bound to a caster through an injected GPU.
No shader-source assertions: a wrapping alpha-cutout must keep its address
mode when it moves from the visible pass to the caster pass.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

const { createSunShadow } = await import( "../../src/engine/runtime/renderer/device/sun-shadow.ts" );

test("casters bind wrapping alpha sampling and allocate nothing while disabled", t => {
	const constants = {
		GPUBufferUsage: { UNIFORM: 1, COPY_DST: 2 },
		GPUTextureUsage: { TEXTURE_BINDING: 1, COPY_DST: 2, RENDER_ATTACHMENT: 4 }
	};
	for ( const [name, value] of Object.entries( constants ) ) {
		const previous = Object.getOwnPropertyDescriptor( globalThis, name );
		Object.defineProperty( globalThis, name, { configurable: true, value } );
		t.after( () => {
			if ( previous ) Object.defineProperty( globalThis, name, previous );
			else Reflect.deleteProperty( globalThis, name );
		} );
	}
	const samplers = [], bound = [], draws = [];
	let allocations = 0, passes = 0;
	/*
	================
	resource
	================
	*/
	function resource() {
		allocations++;
		return { createView: () => ({}), destroy() {} };
	}
	/** @type {any} */
	const device = {
		createShaderModule: resource,
		createRenderPipeline: () => ({ getBindGroupLayout: () => ({}) }),
		createBuffer: resource,
		createTexture: resource,
		/*
		================
		createSampler
		================
		*/
		createSampler( descriptor ) {
			const sampler = { descriptor };
			samplers.push( sampler );
			return sampler;
		},
		createBindGroup: descriptor => descriptor,
		queue: { writeTexture() {}, writeBuffer() {} }
	};
	/** @type {any} */
	const encoder = {
		/*
		================
		beginRenderPass
		================
		*/
		beginRenderPass() {
			passes++;
			return {
				setPipeline() {},
				setBindGroup: ( index, binding ) => bound.push( binding ),
				setVertexBuffer() {},
				setIndexBuffer() {},
				drawIndexed: ( count, instances ) => draws.push( [ count, instances ] ),
				end() {}
			};
		}
	};
	/** @type {any} */
	const source = { instances: {}, material: {}, skin: {}, bones: {}, image: undefined };
	/** @type {any} */
	const environment = {};
	/** @type {any} */
	const draw = { vertices: {}, indices: {}, indexCount: 6, instanceCount: 1 };
	const owner = createSunShadow( device, environment, 384, () => source );

	owner.prepare( false, [ 0, 0, 0 ], [ 0, 1, 0 ] );
	owner.encode( encoder, [ draw ] );
	assert.equal( allocations, 0 );
	assert.equal( passes, 0 );
	assert.equal( samplers.length, 0 );

	owner.prepare( true, [ 0, 0, 0 ], [ 0, 1, 0 ] );
	owner.encode( encoder, [ draw ] );
	const sampler = bound[0].entries.find( entry => entry.binding === 3 ).resource;
	assert.equal( sampler, samplers[0], "the inspected sampler is the one the caster uses" );
	assert.equal( sampler.descriptor.addressModeU, "repeat", "alpha cutouts repeat across U > 1 and U < 0" );
	assert.equal( sampler.descriptor.addressModeV, "repeat", "alpha cutouts repeat across V > 1 and V < 0" );
	assert.deepEqual( draws, [ [ 6, 1 ] ] );
	owner.dispose();
});
