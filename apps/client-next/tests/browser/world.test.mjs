import {test} from 'node:test';
import assert from 'node:assert/strict';
import {launchProbeBrowser} from '../../../../scripts/lib/probeBrowser.mjs';

test('world texture arrays animate without rebuilding the retained command product',{timeout:30000},async()=>{
 const {browser,page}=await launchProbeBrowser();
 try{
  await page.goto('http://127.0.0.1:5180/');
  const result=await page.evaluate(async()=>{
   const {createRenderer}=await import('/src/engine/runtime/renderer/renderer.ts');
   const canvas=document.createElement('canvas');canvas.width=canvas.height=64;document.body.append(canvas);const renderer=createRenderer(canvas);
   const matrix=()=>new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
   try{
    renderer.setWorld({id:'water-fixture',originRegion:1,warnings:[],groups:[{id:'water',center:[0,0,0],radius:2,material:{texture:'red',frames:['red','green'],color:[1,1,1,1],blend:true,doubleSided:true,alphaCutoff:0,unlit:true},geometry:{positions:new Float32Array([-1,-1,0,1,-1,0,0,1,0]),normals:new Float32Array([0,0,1,0,0,1,0,0,1]),uvs:new Float32Array(6),indices:new Uint32Array([0,1,2]),instances:matrix(),transform:matrix()}}]});
    renderer.setWorldCamera({eye:[0,0,2],target:[0,0,0],fov:Math.PI/3,near:0.1,far:100});
    for(const [path,color] of [['red',[255,0,0,255]],['green',[0,255,0,255]]]){
     const pixels=new Uint8ClampedArray(4*4*4);for(let i=0;i<pixels.length;i+=4)pixels.set(color,i);
     renderer.setWorldTexture(path,await createImageBitmap(new ImageData(pixels,4,4)));
    }
    while(renderer.phase()==='starting')await new Promise(requestAnimationFrame);
    const readback=document.createElement('canvas');readback.width=readback.height=64;const context=readback.getContext('2d');
    async function sample(seconds){renderer.frame({width:64,height:64},seconds);await new Promise(requestAnimationFrame);renderer.frame({width:64,height:64},seconds);const image=await createImageBitmap(canvas);context.drawImage(image,0,0);image.close();return [...context.getImageData(32,32,1,1).data];}
    const red=await sample(0),first=renderer.worldStats().bundleRebuilds,green=await sample(0.1),second=renderer.worldStats().bundleRebuilds;
    return {red,green,first,second,error:renderer.error()};
   }finally{renderer.dispose();canvas.remove();}
  });
  assert.equal(result.error,null);assert.deepEqual(result.red,[255,0,0,255]);assert.deepEqual(result.green,[0,255,0,255]);assert.equal(result.first,result.second);
 }finally{await browser.close();}
});
