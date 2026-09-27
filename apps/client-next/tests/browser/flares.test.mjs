import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CLIENT_NEXT_BASE_URL} from '../../../../scripts/lib/probeEndpoints.mjs';
import {launchProbeBrowser} from '../../../../scripts/lib/probeBrowser.mjs';

test('overlapping flare queries observe earlier depth writes without CPU readback',{timeout:45000},async()=>{
 const {browser,page}=await launchProbeBrowser();try{await page.goto(CLIENT_NEXT_BASE_URL);const result=await page.evaluate(async()=>{
  const {createDevice}=await import('/src/engine/runtime/renderer/device/device.ts');
  const renderer=createDevice(),canvas=document.createElement('canvas');canvas.width=canvas.height=128;document.body.append(canvas);
  try{
   for(let n=0;n<300&&renderer.phase()==='starting';n++)await new Promise(requestAnimationFrame);if(renderer.phase()!=='running')throw Error(renderer.error()??'Device startup timeout');
   const context=canvas.getContext('webgpu');renderer.surfaceCommands().configure(context,renderer.format());const depth=renderer.surfaceCommands().createDepth(128,128);
   const bitmap=await createImageBitmap(new ImageData(Uint8ClampedArray.of(255,255,255,255),1,1),{premultiplyAlpha:'none'}),texture=renderer.images().upload(bitmap);bitmap.close();
   const results=[];
   // Same screen pixel: farther points fail after the first depth write;
   // equal and nearer points pass LEQUAL. Distinct pixels remain independent.
   for(const samples of [[.2,2,2,2,2],[.2,.4,.4,.4,.4],[.2,.2,.2,.2,.2],[.8,.6,.4,.2,.1]]){
    const uniforms=new Float32Array(28);samples.forEach((z,i)=>uniforms.set([0,0,z,1],i*4));uniforms.set([64,64,128,128,.1,1],20);
    const flare=renderer.flares({uniforms,textures:Array(8).fill(texture)},depth.view),encoder=renderer.commands().createEncoder(),view=context.getCurrentTexture().createView();
    const clear=encoder.beginRenderPass({colorAttachments:[{view,loadOp:'clear',storeOp:'store',clearValue:[0,0,0,1]}],depthStencilAttachment:{view:depth.view,depthLoadOp:'clear',depthStoreOp:'store',depthClearValue:1}});clear.end();
    const compute=encoder.beginComputePass();compute.setPipeline(flare.compute);compute.setBindGroup(0,flare.binding);compute.dispatchWorkgroups(1);compute.end();
    const pass=encoder.beginRenderPass({colorAttachments:[{view,loadOp:'load',storeOp:'store'}]});for(const draw of flare.entries){pass.setPipeline(draw.pipeline);pass.setBindGroup(0,draw.binding);pass.draw(draw.count,1,0,draw.index);}pass.end();renderer.commands().submit(encoder.finish());
    const image=await createImageBitmap(canvas),copy=document.createElement('canvas');copy.width=copy.height=128;const ctx=copy.getContext('2d');ctx.drawImage(image,0,0);image.close();results.push([...ctx.getImageData(64,64,1,1).data]);
   }
   if(renderer.error())throw Error(renderer.error());return results;
  }finally{renderer.dispose();canvas.remove();}
 });assert.deepEqual(result[0],result[1]);assert.deepEqual(result[2],result[3]);assert.ok(result[0][0]<result[2][0],JSON.stringify(result));
 }finally{await browser.close();}
});

test('live flare chain uses scene depth, survives resize and releases textures on clear',{timeout:45000},async()=>{
 const {browser,page}=await launchProbeBrowser();const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')console.error(m.text());});
 try{await page.goto(CLIENT_NEXT_BASE_URL);const result=await page.evaluate(async()=>{
  const {createRenderer}=await import('/src/engine/runtime/renderer/renderer.ts');
  const {identity,cameraBasis}=await import('/src/engine/foundation/rendering/world-math.ts');
  const canvas=document.createElement('canvas');document.body.append(canvas);const renderer=createRenderer(canvas);
  const camera={eye:[0,0,0],target:[1,1,0],fov:Math.PI/2,near:1,far:5000},basis=cameraBasis(camera);
  const paths=Array.from({length:8},(_,i)=>'/assets/flare-test/'+i),black=[{t:0,r:0,g:0,b:0}];
  const environment={startTimeOfDay:.375,ratePerSecond:0,tracks:{zenith:black,horizon:black}};
  const scene={id:'flare-test',originRegion:1,warnings:[],environment,flareTextures:paths,groups:[]};
  let seconds=0;
  async function render(width=128){renderer.frame({width,height:128},seconds+=.1);await new Promise(requestAnimationFrame);renderer.frame({width,height:128},seconds+=.1);if(renderer.phase()!=='running')throw new Error(renderer.error());const bitmap=await createImageBitmap(canvas),out=document.createElement('canvas');out.width=width;out.height=128;const ctx=out.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();return [...ctx.getImageData(width/2,64,1,1).data];}
  try{
   renderer.setWorldCamera(camera);renderer.setWorld(scene);
   for(const path of paths)renderer.setWorldTexture(path,await createImageBitmap(new ImageData(new Uint8ClampedArray([255,255,255,255]),1,1)));
   const start=performance.now();while(renderer.phase()==='starting'&&performance.now()-start<15000)await new Promise(requestAnimationFrame);
   const visible=await render(),resized=await render(192);
   const positions=[];for(const [x,y] of [[-1,-1],[1,-1],[1,1],[-1,1]])for(let axis=0;axis<3;axis++)positions.push(basis.forward[axis]*100+basis.right[axis]*x*500+basis.up[axis]*y*500);
   renderer.setWorld({...scene,groups:[{id:'occluder',center:basis.forward.map(v=>v*100),radius:1000,material:{color:[0,0,0,1],alphaCutoff:0,blend:false,doubleSided:true,unlit:true},geometry:{world:true,positions:new Float32Array(positions),normals:new Float32Array(12),uvs:new Float32Array(8),indices:new Uint32Array([0,1,2,0,2,3]),instances:identity(),transform:identity()}}]});
   const occluded=await render();renderer.setWorld(null);const cleared=await render();
   renderer.setWorldCamera({...camera,target:[0,0,1]});const perpendicular=await render();
   return {visible,resized,occluded,cleared,perpendicular,phase:renderer.phase(),error:renderer.error()};
  }finally{renderer.dispose();canvas.remove();}
 });
 assert.equal(result.phase,'running',result.error);assert.ok(result.visible[0]>240,JSON.stringify(result));assert.ok(result.resized[0]>240,JSON.stringify(result));assert.ok(result.occluded[0]<10,JSON.stringify(result));assert.ok(result.cleared[0]<50,JSON.stringify(result));assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
