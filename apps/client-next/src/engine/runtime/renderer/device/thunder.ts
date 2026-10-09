/*
===========================================================================

thunder.ts - the fullscreen lightning flash

8CF470 uses SRCALPHA / SRCCOLOR, not ordinary source-over. The HDR stage
renders the flash into the float scene intermediate, so a lazily compiled
sibling pipeline targets rgba16float; a native-only device never compiles it.

===========================================================================
*/
import type { ImageDraw } from "../internal/gpu-contract";

export function createThunder( device: GPUDevice, format: GPUTextureFormat ) {
	const uniform = device.createBuffer( { size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST } );
	const shader = device.createShaderModule( {
		code: `@group(0) @binding(0) var<uniform> color:vec4f;
 @vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f {let p=array<vec2f,6>(vec2f(-1,1),vec2f(1,1),vec2f(1,-1),vec2f(-1,1),vec2f(1,-1),vec2f(-1,-1));return vec4f(p[i],0,1);}
 @fragment fn fs()->@location(0) vec4f {return color;}`
	} );
	const descriptor = ( target: GPUTextureFormat ): GPURenderPipelineDescriptor => ({
		layout: "auto",
		vertex: { module: shader, entryPoint: "vs" },
		fragment: {
			module: shader,
			entryPoint: "fs",
			targets: [ {
				format: target,
				blend: {
					color: { srcFactor: "src-alpha", dstFactor: "src", operation: "add" },
					alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" }
				}
			} ]
		}
	});
	let draw: ImageDraw;
	let flashFloat: ImageDraw | undefined;
	const ready = device.createRenderPipelineAsync( descriptor( format ) ).then( pipeline => {
		draw = {
			pipeline,
			binding: device.createBindGroup( {
				layout: pipeline.getBindGroupLayout( 0 ),
				entries: [ { binding: 0, resource: { buffer: uniform } } ]
			} )
		};
	} );
	return {
		ready,
		prepare( color: readonly number[], sceneFloat = false ) {
			if ( color.length !== 4 || !color.every( v => Number.isFinite( v ) && v >= 0 && v <= 1 ) ) {
				throw Error( "Invalid thunder color" );
			}
			device.queue.writeBuffer( uniform, 0, new Float32Array( color ) );
			if ( !sceneFloat ) return draw;
			flashFloat ??= (() => {
				const pipeline = device.createRenderPipeline( descriptor( "rgba16float" ) );
				return {
					pipeline,
					binding: device.createBindGroup( {
						layout: pipeline.getBindGroupLayout( 0 ),
						entries: [ { binding: 0, resource: { buffer: uniform } } ]
					} )
				};
			})();
			return flashFloat;
		},
		dispose() {
			uniform.destroy();
		}
	};
}
