import {test} from 'node:test';
import assert from 'node:assert/strict';
import {launchProbeBrowser} from '../../../../scripts/lib/probeBrowser.mjs';
test('scenery texture alpha survives settled object fades and UV uniforms animate on the GPU',{timeout:45000},async()=>{
 const {browser,page}=await launchProbeBrowser();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{await page.goto('http://127.0.0.1:5180/');const result=await page.evaluate(async()=>{
  const {createRenderer}=await import('/src/engine/runtime/renderer/renderer.ts');
  const canvas=document.createElement('canvas');document.body.append(canvas);const renderer=createRenderer(canvas);
  const identity=()=>new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
  const group=(id,z,material)=>({id,center:[0,0,z],radius:20,material,geometry:{world:true,positions:new Float32Array([-20,-20,z,20,-20,z,20,20,z,-20,20,z]),normals:new Float32Array(12).fill(1),uvs:new Float32Array([.25,.5,.25,.5,.25,.5,.25,.5]),indices:new Uint32Array([0,1,2,0,2,3]),instances:identity(),transform:identity()}});
  const base={color:[1,1,1,1],alphaCutoff:0,blend:false,doubleSided:true,unlit:true};
  const back=group('background',-1,{...base,color:[0,0,1,1],terrain:true});
  const moving=group('waterfall',0,{...base,texture:'test-alpha',objectFade:true,surfaceAlpha:true,blend:true,depthWrite:false,uvVelocity:[0,0,0,0,.5,0]});
  const output=document.createElement('canvas');output.width=output.height=64;const ctx=output.getContext('2d');
  async function sample(t){renderer.frame({width:64,height:64},t);await new Promise(requestAnimationFrame);renderer.frame({width:64,height:64},t);if(renderer.error())throw Error(renderer.error());const image=await createImageBitmap(canvas);ctx.drawImage(image,0,0);image.close();return [...ctx.getImageData(32,32,1,1).data];}
  try{
   renderer.setWorldCamera({eye:[0,0,10],target:[0,0,0],fov:Math.PI/3,near:1,far:100});
   const deadline=performance.now()+15000;while(renderer.phase()==='starting'&&performance.now()<deadline)await new Promise(requestAnimationFrame);
   renderer.setWorld({id:'scenery',originRegion:0,warnings:[],groups:[back,moving]});
   renderer.setWorldTexture('test-alpha',await createImageBitmap(new ImageData(Uint8ClampedArray.of(255,0,0,128,0,255,0,128),2,1),{premultiplyAlpha:'none'}));
   const before=await sample(0),after=await sample(1);
   const timed=group('timed',0,{...base,colorTimeline:{duration:1000,mode:2,flags:2,colors:[{time:0,value:[1,0,0,1]},{time:1000,value:[0,1,0,1]}]}});
   renderer.setWorld({id:'timeline',originRegion:0,warnings:[],groups:[timed]});
   const colorStart=await sample(2),colorEnd=await sample(3);return {before,after,colorStart,colorEnd};
  }finally{renderer.dispose();canvas.remove();}
 });
 for(const [name,want] of [['before',[128,0,127,255]],['after',[0,128,127,255]],['colorStart',[255,0,0,255]],['colorEnd',[0,255,0,255]]])assert.ok(result[name].every((v,i)=>Math.abs(v-want[i])<=3),JSON.stringify(result));
 assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});

