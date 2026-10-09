/*
===========================================================================

hdr.ts - the experimental HDR intermediate and its tone map

Port-only, not native. Experimental > Image > HDR tone map renders the
scene into an rgba16float intermediate instead of the 8-bit frame: the
only values above 1.0 are the stages that lift them there (the sun disc
gain in pipelines.ts), and one fullscreen pass resolves the intermediate
through a filmic curve into the presented frame. The UI never touches the
intermediate: it composes into the 8-bit frame after this pass, exactly
where the shipped frame already composes it.

The curve is Narkowicz's fitted ACES (2015). The 2005 frame is authored
display-referred LDR, so there is no linear-to-sRGB re-encode on output;
the curve's job is the highlight roll-off and the filmic mid lift, and the
exposure constant is the whole compensation surface.

===========================================================================
*/
import type { HdrDraw } from "../internal/gpu-contract";
import { destroyNow, type Retire } from "./retirement";

// The shared tone map constants: bloom.ts's float composite carries the
// same curve so the glow chain and the standalone pass agree.
export const TONEMAP_EXPOSURE = 1.0; // pre-curve gain; 1 leaves the authored palette in place
export const TONEMAP_WGSL =
	`fn tonemapColor(c:vec3f)->vec3f{let v=c*${TONEMAP_EXPOSURE};return clamp((v*(v*2.51+0.03))/(v*(v*2.43+0.59)+0.14),vec3f(0),vec3f(1));}`;

/*
================
createHdr

Owns the float scene intermediate and the tone-map pass. prepare() with the
stage off owns nothing; the frame then renders straight into the 8-bit
frame, byte-identical to the native path.
================
*/
export function createHdr( device: GPUDevice, format: GPUTextureFormat, retire: Retire = destroyNow ) {
	// Compilation and validation failures use the device's existing terminal
	// error path; a device that never enables this stage never compiles it.
	let pipeline: GPURenderPipeline | null = null, previewPipeline: GPURenderPipeline | null = null;
	let shader: GPUShaderModule | null = null;
	/*
	================
	ensure
	================
	*/
	const ensure = () => {
		if ( pipeline ) return;
		const module = device.createShaderModule( {
			label: "hdr-tonemap",
			code: `
 @group(0) @binding(0) var source:texture_2d<f32>;
 @group(0) @binding(1) var linear:sampler;
 struct V {@builtin(position) position:vec4f,@location(0) uv:vec2f};
 @vertex fn vs(@builtin(vertex_index) i:u32)->V{
  let p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3))[i];
  return V(vec4f(p,0,1),vec2f(p.x*.5+.5,.5-p.y*.5));
 }
 ${TONEMAP_WGSL}
 @fragment fn fs(v:V)->@location(0) vec4f{return vec4f(tonemapColor(textureSampleLevel(source,linear,v.uv,0).rgb),1);}
 // Preview input is coverage-premultiplied, unlike the native D3D alpha
 // accumulation. Unassociate before the nonlinear curve, then reassociate
 // for ONE / ONE_MINUS_SRC_ALPHA. Empty texels preserve the background.
 @fragment fn preview(v:V)->@location(0) vec4f {
  let c=textureSampleLevel(source,linear,v.uv,0);
  let a=clamp(c.a,0.0,1.0);
  if(a==0.0){return vec4f(tonemapColor(c.rgb),0);}
  return vec4f(tonemapColor(c.rgb/a)*a,a);
 }
 `
		} );
		pipeline = device.createRenderPipeline( {
			label: "hdr-tonemap",
			layout: "auto",
			vertex: { module, entryPoint: "vs" },
			fragment: { module, entryPoint: "fs", targets: [ { format } ] },
			primitive: { topology: "triangle-list" }
		} );
		shader = module;
	};
	const sampler = device.createSampler( {
		minFilter: "linear",
		magFilter: "linear",
		addressModeU: "clamp-to-edge",
		addressModeV: "clamp-to-edge"
	} );
	let target: GPUTexture | null = null,
		view: GPUTextureView | null = null,
		binding: GPUBindGroup | null = null,
		previewBinding: GPUBindGroup | null = null,
		width = 0,
		height = 0,
		disposed = false;
	/*
	================
	clear
	================
	*/
	function clear() {
		if ( target ) retire( target );
		target = null;
		view = null;
		binding = null;
		previewBinding = null;
		width = height = 0;
	}
	return {
		/*
		================
		prepare

		The float intermediate for a w x h frame, (re)created when the size
		changed; undefined (and no target) while the stage is off.
		================
		*/
		prepare( w: number, h: number, enabled: boolean ): HdrDraw | undefined {
			if ( disposed ) throw Error( "HDR owner disposed" );
			if ( !enabled ) {
				clear();
				return;
			}
			ensure();
			if ( width !== w || height !== h ) {
				clear();
				width = w;
				height = h;
				target = device.createTexture( {
					label: "hdr-scene-color",
					size: [ w, h ],
					format: "rgba16float",
					usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
				} );
				view = target.createView();
				binding = device.createBindGroup( {
					layout: pipeline!.getBindGroupLayout( 0 ),
					entries: [ { binding: 0, resource: view }, { binding: 1, resource: sampler } ]
				} );
			}
			const epoch = target;
			return {
				view: view!,
				/*
				================
				encode
				================
				*/
				encode( encoder, output: GPUTextureView ) {
					if ( disposed || epoch !== target || !pipeline || !binding ) throw Error( "Stale HDR target" );
					const pass = encoder.beginRenderPass( {
						label: "hdr-tonemap",
						colorAttachments: [ { view: output, loadOp: "clear", storeOp: "store" } ]
					} );
					pass.setPipeline( pipeline );
					pass.setBindGroup( 0, binding );
					pass.draw( 3 );
					pass.end();
				},
				/*
				================
				encodePreview

				Port-only, not native. The frame has reused the float target for
				preview geometry after the scene resolve and its depth consumers.
				The canvas already contains the background UI; preserve it and
				its alpha while compositing the coverage-premultiplied preview.
				================
				*/
				encodePreview( encoder, output ) {
					if ( disposed || epoch !== target || !shader || !view ) throw Error( "Stale HDR target" );
					previewPipeline ??= device.createRenderPipeline( {
						label: "hdr-preview-tonemap",
						layout: "auto",
						vertex: { module: shader, entryPoint: "vs" },
						fragment: {
							module: shader,
							entryPoint: "preview",
							targets: [ {
								format,
								blend: {
									color: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
									alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" }
								}
							} ]
						},
						primitive: { topology: "triangle-list" }
					} );
					previewBinding ??= device.createBindGroup( {
						layout: previewPipeline.getBindGroupLayout( 0 ),
						entries: [ { binding: 0, resource: view }, { binding: 1, resource: sampler } ]
					} );
					const pass = encoder.beginRenderPass( {
						label: "hdr-preview-tonemap",
						colorAttachments: [ { view: output, loadOp: "load", storeOp: "store" } ]
					} );
					pass.setPipeline( previewPipeline );
					pass.setBindGroup( 0, previewBinding );
					pass.draw( 3 );
					pass.end();
				}
			};
		},
		/*
		================
		dispose
		================
		*/
		dispose() {
			if ( disposed ) return;
			clear();
			disposed = true;
		}
	};
}
