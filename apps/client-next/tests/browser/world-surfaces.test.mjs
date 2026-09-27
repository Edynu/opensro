import {CLIENT_NEXT_BASE_URL} from '../../../../scripts/lib/probeEndpoints.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {launchProbeBrowser} from '../../../../scripts/lib/probeBrowser.mjs';
test('native lightmap multiply respects depth and source shadow lift on the GPU',{timeout:30000},async()=>{
 const {browser,page}=await launchProbeBrowser();const errors=[];page.on('pageerror',error=>errors.push(error.message));
 try{await page.goto(CLIENT_NEXT_BASE_URL);const result=await page.evaluate(async()=>{
  const {createRenderer}=await import('/src/engine/runtime/renderer/renderer.ts'),canvas=document.createElement('canvas');document.body.append(canvas);const renderer=createRenderer(canvas),identity=()=>new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
  const material={color:[.8,.4,.2,1],alphaCutoff:0,blend:false,doubleSided:true,unlit:true};
  const group=(id,color,z=0)=>({id,center:[0,0,z],radius:10,material:{...material,color},geometry:{world:true,positions:new Float32Array([-2,-2,z,2,-2,z,2,2,z,-2,2,z]),normals:new Float32Array(12).fill(1),uvs:new Float32Array([0,0,1,0,1,1,0,1]),indices:new Uint32Array([0,1,2,0,2,3]),instances:identity(),transform:identity()}});
  const base=group('ground',material.color);base.material.terrain=true;const light=group('light',[1,1,1,1]);light.material={...light.material,blend:true,lightmap:true,texture:'light'};
  const environment={startTimeOfDay:.5,ratePerSecond:0,tracks:{color0x1c0:[{t:0,r:.1,g:.2,b:.3}],scalar0x2e8:[{t:0,value:1}],scalar0x314:[{t:0,value:1}]}};
  const show=async groups=>{renderer.setWorld({id:'test',originRegion:0,warnings:[],environment,groups});renderer.setWorldTexture('light',await createImageBitmap(new ImageData(Uint8ClampedArray.of(64,128,255,255),1,1)));renderer.frame({width:64,height:64},0);await new Promise(requestAnimationFrame);renderer.frame({width:64,height:64},0);if(renderer.phase()!=='running')throw new Error(renderer.error());const snapshot=await createImageBitmap(canvas),output=document.createElement('canvas');output.width=64;output.height=64;const c=output.getContext('2d');c.drawImage(snapshot,0,0);snapshot.close();return [...c.getImageData(32,32,1,1).data];};
  try{renderer.setWorldCamera({eye:[0,0,2],target:[0,0,0],fov:Math.PI/3,near:.1,far:100});const start=performance.now();while(renderer.phase()==='starting'&&performance.now()-start<15000)await new Promise(requestAnimationFrame);
   const multiply=await show([base,light]),occluded=await show([base,light,group('foreground',[0,0,1,1],.5)]);return {multiply,occluded};
  }finally{renderer.dispose();canvas.remove();}
 });
 for(const [i,expected] of [72,72,51,255].entries())assert.ok(Math.abs(result.multiply[i]-expected)<=2,JSON.stringify(result));assert.deepEqual(result.occluded,[0,0,255,255]);assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});


test('GPU star quads retain native two/one pixel sizes and byte-quantized alpha',{timeout:30000},async()=>{
 const {browser,page}=await launchProbeBrowser();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{await page.goto(CLIENT_NEXT_BASE_URL);const result=await page.evaluate(async()=>{
  const {createRenderer}=await import('/src/engine/runtime/renderer/renderer.ts'),{skyGroups}=await import('/src/engine/foundation/rendering/sky-geometry.ts');
  const canvas=document.createElement('canvas');document.body.append(canvas);
  const vertices=Array.from({length:3000},()=>({x:0,y:0,z:-100,colorArgb:0xffffffff}));vertices[0]={x:-20,y:0,z:100,colorArgb:0xffffffff};vertices[1000]={x:20,y:0,z:100,colorArgb:0xffffffff};
  const {advanceStarFlicker}=await import('/src/engine/foundation/rendering/star-flicker.ts');let random=1792;
  // This raster fixture supplies its field and recorded continuation explicitly.
  const renderer=createRenderer(canvas,{sky:()=>({vertices}),flicker(state,now,visible){const next=advanceStarFlicker({...state,random},now,visible);random=next.random;return next;}});
  const stars=skyGroups({starPrimitive:{vertices}}).filter(g=>g.material.sky===2);
  const black=[{t:0,r:0,g:0,b:0}];
  const show=async factor=>{
   // Native star storage starts at zero. Seed 1792 selects the first batch at
   // full intensity on the first 100 ms timer event; static stars stay at 255.
   renderer.setWorld({id:'stars:'+factor,originRegion:0,starRandomState:1792,warnings:[],groups:stars,environment:{startTimeOfDay:0,ratePerSecond:0,tracks:{zenith:black,horizon:black,starAlpha:[{t:0,value:factor}]}}});
   renderer.frame({width:64,height:64},0);await new Promise(requestAnimationFrame);renderer.frame({width:64,height:64},.1);
   if(renderer.phase()!=='running')throw new Error(renderer.error());
   const image=await createImageBitmap(canvas),out=document.createElement('canvas');out.width=out.height=64;const ctx=out.getContext('2d');ctx.drawImage(image,0,0);image.close();
   const pixels=ctx.getImageData(0,0,64,64).data;const left=[],right=[];for(let i=0;i<pixels.length;i+=4)if(pixels[i]>0)(i/4%64<32?left:right).push(pixels[i]);return {left,right};
  };
  try{renderer.setWorldCamera({eye:[0,0,0],target:[0,0,1],fov:Math.PI/2,near:1,far:1000});const start=performance.now();while(renderer.phase()==='starting'&&performance.now()-start<15000)await new Promise(requestAnimationFrame);return {full:await show(1),half:await show(.5)};}
  finally{renderer.dispose();canvas.remove();}
 });
 assert.equal(result.full.left.length,4);assert.equal(result.full.right.length,1);assert.ok(result.full.left.every(x=>x===255));assert.ok([...result.half.left,...result.half.right].every(x=>Math.abs(x-127)<=1));assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
