import {test} from 'node:test';
import assert from 'node:assert/strict';
import {launchProbeBrowser} from '../../../../scripts/lib/probeBrowser.mjs';
import {CLIENT_NEXT_BASE_URL} from '../../../../scripts/lib/probeEndpoints.mjs';

test('all eight native alpha comparisons reach GPU coverage at below/equal/above boundaries',{timeout:45000},async()=>{
 const {browser,page}=await launchProbeBrowser();
 try{
  await page.goto(CLIENT_NEXT_BASE_URL);
  const pixels=await page.evaluate(async()=>{
   const {createDevice}=await import('/src/engine/runtime/renderer/device/device.ts');
   const device=createDevice(),canvas=document.createElement('canvas');canvas.width=24;canvas.height=8;document.body.append(canvas);
   const identity=()=>Float32Array.of(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1);
   try{
    const deadline=performance.now()+15000;while(device.phase()==='starting'){if(performance.now()>deadline)throw Error('Device timeout');await new Promise(requestAnimationFrame);}
    if(device.phase()!=='running')throw Error(device.error());
    const context=canvas.getContext('webgpu');device.surfaceCommands().configure(context,device.format());const depth=device.surfaceCommands().createDepth(24,8),draws=[];
    for(let row=0;row<8;row++)for(let column=0;column<3;column++){
     const left=-1+column*2/3,right=left+2/3,top=1-row/4,bottom=top-.25;
     draws.push(device.geometry().upload({positions:Float32Array.of(left,top,.5,right,top,.5,left,bottom,.5,right,bottom,.5),indices:Uint32Array.of(0,1,2,2,1,3),transform:identity(),material:{color:[1,0,0,(127+column)/255],alphaCutoff:128/255,alphaCompare:row+1,blend:false,doubleSided:true,unlit:true}}));
    }
    const encoder=device.commands().createEncoder(),pass=encoder.beginRenderPass({colorAttachments:[{view:context.getCurrentTexture().createView(),loadOp:'clear',storeOp:'store',clearValue:[0,0,1,1]}],depthStencilAttachment:{view:depth.view,depthLoadOp:'clear',depthStoreOp:'discard',depthClearValue:1}});
    for(const draw of draws){pass.setPipeline(draw.pipeline);pass.setBindGroup(0,draw.binding);pass.setVertexBuffer(0,draw.vertices);pass.setIndexBuffer(draw.indices,'uint32');pass.drawIndexed(draw.indexCount,draw.instanceCount);}pass.end();device.commands().submit(encoder.finish());
    const copy=document.createElement('canvas');copy.width=24;copy.height=8;const ctx=copy.getContext('2d'),image=await createImageBitmap(canvas);ctx.drawImage(image,0,0);image.close();const bytes=ctx.getImageData(0,0,24,8).data;
    return Array.from({length:8},(_,row)=>Array.from({length:3},(_,column)=>bytes[(row*24+column*8+4)*4]>0));
   }finally{device.dispose();canvas.remove();}
  });
  assert.deepEqual(pixels,[[false,false,false],[true,false,false],[false,true,false],[true,true,false],[false,false,true],[true,false,true],[false,true,true],[true,true,true]]);
 }finally{await browser.close();}
});
