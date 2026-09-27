import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchProbeBrowser} from '../../../../scripts/lib/probeBrowser.mjs';
import {CLIENT_NEXT_BASE_URL} from '../../../../scripts/lib/probeEndpoints.mjs';
import {holdProbeRuntime} from './helpers/hold-runtime.mjs';

test('both published SCT_MOVER models render distinct hover, flight and attack poses and release cleanly',{timeout:60000},async()=>{
 const {browser,page}=await launchProbeBrowser();
 try{
  await holdProbeRuntime(page);await page.goto(CLIENT_NEXT_BASE_URL);
  const result=await page.evaluate(async()=>{
   const {createRenderer}=await import('/src/engine/runtime/renderer/renderer.ts');
   const {createAssets}=await import('/src/engine/runtime/assets/assets.ts');
   const {createCharacterResources}=await import('/src/engine/runtime/characters/resources/resources.ts');
   const canvas=document.createElement('canvas'),renderer=createRenderer(canvas),assets=createAssets(),resources=createCharacterResources(assets,renderer,location.origin);
   const readback=document.createElement('canvas');readback.width=readback.height=256;const context=readback.getContext('2d');
   const manifest=await (await fetch('/assets/skillfx/manifest.json')).json(),models=['blackhawk','lighthawk'].map(name=>manifest.models[`res/npc/animal/${name}.bsr`]);
   const hash=async()=>{const bitmap=await createImageBitmap(canvas);context.drawImage(bitmap,0,0);bitmap.close();return [...new Uint8Array(await crypto.subtle.digest('SHA-256',context.getImageData(0,0,256,256).data))].map(n=>n.toString(16).padStart(2,'0')).join('');};
   let frame=0;
   const draw=async actors=>{renderer.setCharacterActors(actors);renderer.frame({width:256,height:256},frame++/60);if(renderer.error())throw Error(renderer.error());return hash();};
   try{
    const deadline=performance.now()+20000;
    while(renderer.phase()==='starting'&&performance.now()<deadline)await new Promise(requestAnimationFrame);
    renderer.setWorld({id:'hawk-resource-check',originRegion:257,groups:[],warnings:[]});renderer.setWorldCamera({eye:[35,35,-75],target:[0,21,0],originRegion:257,fov:1,near:1,far:1000});
    let admitted=false;
    while(performance.now()<deadline){resources.begin(0);resources.poll();admitted=models.map(model=>resources.ready(model.glb)).every(Boolean);if(resources.error())throw Error(resources.error());if(admitted)break;await new Promise(requestAnimationFrame);}
    if(!admitted)throw Error('Hawk resource admission deadline');
    const empty=await draw([]),samples=[];
    for(const model of models){const poses=[];for(const state of [0,7,2])for(const time of [0,.35,.7])poses.push({state,time,hash:await draw([{gid:-1,model:model.glb,pose:{regionId:257,x:0,y:21,z:0,yaw:Math.PI},clip:model.states[state].clip,time,loop:model.states[state].loop,scale:1,pickable:false}])});samples.push({model:model.glb,poses});}
    const reset=await draw([]);return {scope:'Published model/animation WebGPU integration; not an authenticated session or a matched retail scene',empty,samples,reset,error:renderer.error()};
   }finally{resources.dispose();assets.dispose();renderer.dispose();}
  });
  await mkdir('temp/artifacts/hawk',{recursive:true});await writeFile('temp/artifacts/hawk/gpu.json',JSON.stringify(result,null,2)+'\n');
  for(const row of result.samples){assert.ok(row.poses.every(p=>p.hash!==result.empty));assert.ok(new Set(row.poses.map(p=>p.hash)).size>3);assert.equal(new Set(row.poses.filter(p=>p.time===.35).map(p=>p.hash)).size,3);}
  assert.equal(result.reset,result.empty);assert.equal(result.error,null);
 }finally{await browser.close();}
});
