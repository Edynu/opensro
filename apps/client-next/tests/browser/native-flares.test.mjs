import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {launchProbeBrowser} from '../../../../scripts/lib/probeBrowser.mjs';
import {CLIENT_NEXT_BASE_URL} from '../../../../scripts/lib/probeEndpoints.mjs';
for(const filtered of [false,true])test(`flare chain: strict RGB and coverage parity against D3D9 HAL (${filtered?'retail lenses':'constant textures'})`,{timeout:90000},async()=>{
 const stem=filtered?'native-filtered-flare':'native-flare';
 const sha=b=>createHash('sha256').update(b).digest('hex');
 const policy=JSON.parse(await readFile(filtered?'tests/fixtures/native/filtered-flare-pixel-policy.json':'tests/fixtures/native/flare-pixel-policy.json','utf8'));
 for(const [file,hash] of Object.entries(policy.sha256))assert.equal(sha(await readFile(file)),hash,'Frozen flare input changed: '+file);
 const receipt=JSON.parse((await readFile(`temp/artifacts/${stem}-reference.json`,'utf8')).replace(/^\uFEFF/,''));
 for(const file of ['tools/native-flare-reference.cpp','temp/artifacts/native-flare-reference.exe',`temp/artifacts/${stem}.bgra`])assert.equal(sha(await readFile(file)),receipt.sha256[file]);
 const native=await readFile(`temp/artifacts/${stem}.bgra`);assert.equal(native.length,512*384*4*4);
 const {browser,page}=await launchProbeBrowser();try{
  await page.goto(CLIENT_NEXT_BASE_URL);
  const actual=await page.evaluate(async(filtered)=>{
   const {createDevice}=await import('/src/engine/runtime/renderer/device/device.ts');const result=[];
   for(let scenario=0;scenario<4;scenario++){
    const renderer=createDevice(),canvas=document.createElement('canvas');canvas.width=512;canvas.height=384;document.body.append(canvas);
    try{
     for(let n=0;n<300&&renderer.phase()==='starting';n++)await new Promise(requestAnimationFrame);if(renderer.phase()!=='running')throw Error(renderer.error()??'Device startup timeout');
     const context=canvas.getContext('webgpu');renderer.surfaceCommands().configure(context,renderer.format());const depth=renderer.surfaceCommands().createDepth(512,384),textures=[];
     for(let i=0;i<8;i++){
      if(filtered){const {decodeNativeTexture}=await import('/src/engine/foundation/assets/native-texture.ts');const response=await fetch(`/assets/images/Map_extracted/sun/lens${i+1}.texture`);if(!response.ok)throw Error('Missing native texture');textures.push(renderer.images().upload(decodeNativeTexture(new Uint8Array(await response.arrayBuffer()))));}
      else{const bitmap=await createImageBitmap(new ImageData(Uint8ClampedArray.of(23+i*27,211-i*19,37+i*13,32+i*29),1,1),{premultiplyAlpha:'none',colorSpaceConversion:'none'});textures.push(renderer.images().upload(bitmap));bitmap.close();}
     }
     const visibility=[1,.3,.175,.65][scenario],samples=scenario===0?[true,true,true,true,true]:scenario===1?[true,false,false,false,false]:scenario===2?[false,true,false,false,false]:[true,true,true,false,false];
     const uniforms=new Float32Array(28);for(let i=0;i<5;i++)uniforms.set([-.8+i*.4,0,samples[i]?.5:2,1],i*4);uniforms.set([173.25+scenario*.25,137.5-scenario*.25,512,384,.1,1],20);
     const flare=renderer.flares({uniforms,textures},depth.view),encoder=renderer.commands().createEncoder(),view=context.getCurrentTexture().createView();
     const clear=encoder.beginRenderPass({colorAttachments:[{view,loadOp:'clear',storeOp:'store',clearValue:[23/255,43/255,67/255,1]}],depthStencilAttachment:{view:depth.view,depthLoadOp:'clear',depthStoreOp:'store',depthClearValue:1}});clear.end();
     const compute=encoder.beginComputePass();compute.setPipeline(flare.compute);compute.setBindGroup(0,flare.binding);compute.dispatchWorkgroups(1);compute.end();
     const pass=encoder.beginRenderPass({colorAttachments:[{view,loadOp:'load',storeOp:'store'}]});for(const draw of flare.entries){pass.setPipeline(draw.pipeline);pass.setBindGroup(0,draw.binding);pass.draw(draw.count,1,0,draw.index);}pass.end();renderer.commands().submit(encoder.finish());
     const bitmap=await createImageBitmap(canvas),copy=document.createElement('canvas');copy.width=512;copy.height=384;const ctx=copy.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();result.push({pixels:[...ctx.getImageData(0,0,512,384).data],error:renderer.error(),visibility});
    }finally{renderer.dispose();canvas.remove();}
   }return result;
  },filtered);
  const scenarios=actual.map((a,i)=>{let pixels=0,channels=0,maxError=0;for(let p=0;p<512*384;p++){let different=false;for(let c=0;c<3;c++){const error=Math.abs(a.pixels[p*4+c]-native[(i*512*384+p)*4+2-c]);channels+=Number(error!==0);maxError=Math.max(maxError,error);different||=error!==0;}pixels+=Number(different);}return {scenario:i,pixels,channels,maxError,error:a.error};});
  await mkdir(`temp/artifacts/${stem}-comparison`,{recursive:true});await writeFile(`temp/artifacts/${stem}-comparison/result.json`,JSON.stringify({policy,receipt,browser:browser.version(),scenarios},null,2));
  for(let i=0;i<actual.length;i++)await writeFile(`temp/artifacts/${stem}-comparison/scenario-${i}.rgba`,Buffer.from(actual[i].pixels));
  console.log(JSON.stringify(scenarios));assert.ok(scenarios.every(row=>!row.pixels&&row.error===null));
 }finally{await browser.close();}
});
