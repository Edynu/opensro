import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchProbeBrowser} from '../../../../scripts/lib/probeBrowser.mjs';
import {CLIENT_NEXT_BASE_URL} from '../../../../scripts/lib/probeEndpoints.mjs';
import {holdProbeRuntime} from './helpers/hold-runtime.mjs';

test('combat overlay survives nearer scene depth while sibling labels remain occluded',{timeout:45000},async()=>{
 const {browser,page}=await launchProbeBrowser();try{
  await holdProbeRuntime(page);await page.goto(CLIENT_NEXT_BASE_URL);
  const result=await page.evaluate(async()=>{
   const {createUiResources}=await import('/src/engine/runtime/renderer/device/ui.ts');
   const adapter=await navigator.gpu.requestAdapter(),device=await adapter.requestDevice(),ui=createUiResources(device,'rgba8unorm');
   const errors=[];device.addEventListener('uncapturederror',event=>errors.push(event.error.message));await ui.ready;
   const color=device.createTexture({size:[64,16],format:'rgba8unorm',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
   const depth=device.createTexture({size:[64,16],format:'depth24plus',usage:GPUTextureUsage.RENDER_ATTACHMENT});
   const buffer=device.createBuffer({size:256*16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
   const quad=(x,occlusion)=>({texture:'',depth:.75,occlusion,rect:[x,0,16,16],clip:[0,0,64,16],uv:[0,0,1,1],color:[1,1,1,1]});
   async function draw(quads){
    const draws=ui.prepare({revision:1,width:64,height:16,quads}),encoder=device.createCommandEncoder();
    // A nearer solid scene surface occupies every pixel in the depth buffer.
    const pass=encoder.beginRenderPass({colorAttachments:[{view:color.createView(),clearValue:[0,0,0,1],loadOp:'clear',storeOp:'store'}],depthStencilAttachment:{view:depth.createView(),depthClearValue:.2,depthLoadOp:'clear',depthStoreOp:'store'}});
    for(const d of draws){pass.setPipeline(d.pipeline);pass.setBindGroup(0,d.binding);pass.draw(6,d.count,0,d.first);}pass.end();
    encoder.copyTextureToBuffer({texture:color},{buffer,bytesPerRow:256},[64,16]);device.queue.submit([encoder.finish()]);await buffer.mapAsync(GPUMapMode.READ);
    const pixels=new Uint8Array(buffer.getMappedRange()).slice();buffer.unmap();return {draws,pixels:[pixels[8*4],pixels[24*4],pixels[40*4]]};
   }
   try{
    const mixed=await draw([quad(0,'scene'),quad(16,'none'),quad(32,'scene')]);
    const overlay=await draw([quad(0,'none')]),hidden=await draw([quad(0,'scene')]),restored=await draw([quad(0,'none')]);
    // HUD/window quads still follow the world overlay in submission order.
    const covered=await draw([quad(0,'none'),{...quad(0,'none'),depth:undefined,color:[0,1,0,1]}]);
    return {mixed:mixed.pixels,groups:mixed.draws.length,layers:mixed.draws.map(d=>d.layer),overlay:overlay.pixels,hidden:hidden.pixels,restored:restored.pixels,covered:covered.pixels,changed:hidden.draws!==overlay.draws,errors};
   }finally{ui.dispose();color.destroy();depth.destroy();buffer.destroy();device.destroy();}
  });
  await mkdir('temp/artifacts/damage-occlusion',{recursive:true});await writeFile('temp/artifacts/damage-occlusion/gpu.json',JSON.stringify(result,null,2));
  assert.deepEqual(result.errors,[]);assert.deepEqual(result.mixed,[0,255,0]);assert.equal(result.groups,3);assert.deepEqual(result.layers,['world','world','world']);
  assert.equal(result.overlay[0],255);assert.equal(result.hidden[0],0);assert.equal(result.restored[0],255);assert.equal(result.covered[0],0);assert.equal(result.changed,true);
 }finally{await browser.close();}
});
