import type {ImageDraw} from '../internal/gpu-contract';
// 8CF470 uses SRCALPHA / SRCCOLOR, not ordinary source-over.
export function createThunder(device:GPUDevice,format:GPUTextureFormat){
 const uniform=device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
 const shader=device.createShaderModule({code:`@group(0) @binding(0) var<uniform> color:vec4f;
 @vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f {let p=array<vec2f,6>(vec2f(-1,1),vec2f(1,1),vec2f(1,-1),vec2f(-1,1),vec2f(1,-1),vec2f(-1,-1));return vec4f(p[i],0,1);}
 @fragment fn fs()->@location(0) vec4f {return color;}`});
 let draw:ImageDraw;
 const ready=device.createRenderPipelineAsync({layout:'auto',vertex:{module:shader,entryPoint:'vs'},fragment:{module:shader,entryPoint:'fs',targets:[{format,blend:{color:{srcFactor:'src-alpha',dstFactor:'src',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}}]}}).then(pipeline=>{draw={pipeline,binding:device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:uniform}}]})};});
 return {ready,prepare(color:readonly number[]){if(color.length!==4||!color.every(v=>Number.isFinite(v)&&v>=0&&v<=1))throw Error('Invalid thunder color');device.queue.writeBuffer(uniform,0,new Float32Array(color));return draw;},dispose(){uniform.destroy();}};
}
