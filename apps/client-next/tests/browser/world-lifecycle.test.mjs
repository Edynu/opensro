import {test} from 'node:test';
import assert from 'node:assert/strict';
import {launchProbeBrowser} from '../../../../scripts/lib/probeBrowser.mjs';

test('world clear removes visible geometry without submitting retired GPU handles',{timeout:30000},async t=>{
 const {browser,page}=await launchProbeBrowser();
 try{
  await page.goto('http://127.0.0.1:5180/');
  const result=await page.evaluate(async()=>{
   const {createRenderer}=await import('/src/engine/runtime/renderer/renderer.ts');
   const canvas=document.createElement('canvas');document.body.append(canvas);const renderer=createRenderer(canvas);
   const identity=()=>new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
   const read=async()=>{renderer.frame({width:64,height:64});const bitmap=await createImageBitmap(canvas),output=document.createElement('canvas');output.width=64;output.height=64;const context=output.getContext('2d');context.drawImage(bitmap,0,0);bitmap.close();return [...context.getImageData(32,32,1,1).data];};
   try{
    renderer.setWorldCamera({eye:[0,0,5],target:[0,0,0],near:1,far:100,fov:Math.PI/3});
    renderer.setWorld({id:'fixture',originRegion:1,warnings:[],groups:[{id:'triangle',center:[0,0,0],radius:2,material:{color:[1,0,0,1],alphaCutoff:0,blend:false,doubleSided:true,unlit:true},geometry:{positions:new Float32Array([-1,-1,0,1,-1,0,0,1,0]),normals:new Float32Array([0,0,1,0,0,1,0,0,1]),uvs:new Float32Array(6),indices:new Uint32Array([0,1,2]),instances:identity(),transform:identity()}}]});
    const start=performance.now();while(renderer.phase()==='starting'&&performance.now()-start<10000)await new Promise(resolve=>requestAnimationFrame(resolve));
    const before=await read();renderer.setWorld(null);const after=await read();await read();
    return {before,after,phase:renderer.phase(),error:renderer.error(),groups:renderer.worldStats().visibleGroups};
   }finally{renderer.dispose();canvas.remove();}
  });
  t.diagnostic(JSON.stringify(result));
  assert.equal(result.phase,'running',result.error);assert.equal(result.groups,0);assert.ok(result.before[0]>150);assert.notDeepEqual(result.after,result.before);
 }finally{await browser.close();}
});
