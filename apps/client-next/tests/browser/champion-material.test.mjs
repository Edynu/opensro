import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchProbeBrowser} from '../../../../scripts/lib/probeBrowser.mjs';
import {CLIENT_NEXT_BASE_URL} from '../../../../scripts/lib/probeEndpoints.mjs';
import {holdProbeRuntime} from './helpers/hold-runtime.mjs';
test('published champion material changes rendered pixels with identical pose and lighting',{timeout:60000},async()=>{
 const {browser,page}=await launchProbeBrowser();try{await holdProbeRuntime(page);await page.goto(CLIENT_NEXT_BASE_URL);
 const result=await page.evaluate(async()=>{
  const {createAssets}=await import('/src/engine/runtime/assets/assets.ts'),{createRenderer}=await import('/src/engine/runtime/renderer/renderer.ts');const assets=createAssets(),canvas=document.createElement('canvas'),renderer=createRenderer(canvas),copy=document.createElement('canvas');copy.width=copy.height=256;const ctx=copy.getContext('2d');
  const path='/assets/npc/mob/china/chakji.glb',id=assets.request(new URL(path,location.origin).href,16<<20,'character');let loaded;const end=performance.now()+20000;
  try{while(!(loaded=assets.take(id))){if(performance.now()>end)throw Error('Model loading deadline');await new Promise(requestAnimationFrame);}if(loaded.kind!=='character')throw Error(loaded.error??'Wrong asset');renderer.setCharacterModel(path,loaded.model,loaded.images);
   let serial=0,modelPath=path;async function sample(ambient,diffuse,yaw){if(serial===1){const variant=path.replace('.glb','.material-2.glb'),job=assets.request(new URL(variant,location.origin).href,16<<20,'character');let next;const deadline=performance.now()+20000;while(!(next=assets.take(job))){if(performance.now()>deadline)throw Error('Champion loading deadline');await new Promise(requestAnimationFrame);}if(next.kind!=='character')throw Error(next.error??'Wrong champion asset');modelPath=variant;renderer.setCharacterModel(variant,next.model,next.images);}renderer.setWorld(null);const rgb=n=>[{t:0,r:n,g:n,b:n}];renderer.setWorld({id:'character-light:'+serial++,originRegion:257,groups:[],warnings:[],environment:{startTimeOfDay:.5,ratePerSecond:0,tracks:{color0xf0:rgb(diffuse),color0x124:rgb(ambient),scalar0x2e8:[{t:0,value:1}],scalar0x314:[{t:0,value:1}]}}});renderer.setWorldCamera({eye:[0,10,-35],target:[0,10,0],originRegion:257,fov:1,near:1,far:500});renderer.setCharacterActors([{gid:1,model:modelPath,pose:{regionId:257,x:0,y:0,z:0,yaw},clip:'stand',time:0,loop:true,scale:1}]);
    for(let i=0;i<10;i++){renderer.frame({width:256,height:256},0);if(renderer.error())throw Error(renderer.error());await new Promise(requestAnimationFrame);}const bitmap=await createImageBitmap(canvas);ctx.drawImage(bitmap,0,0);bitmap.close();const pixels=ctx.getImageData(64,32,128,208).data;return {sum:pixels.reduce((s,n,i)=>s+(i%4===3?0:n),0),png:copy.toDataURL()};}
   return {normal:await sample(.5,.5,0),champion:await sample(.5,.5,0)};
  }finally{renderer.dispose();assets.dispose();}
 });await mkdir('temp/artifacts/combat-followup/materials',{recursive:true});for(const [key,value] of Object.entries(result))await writeFile('temp/artifacts/combat-followup/materials/'+key+'.png',Buffer.from(value.png.split(',')[1],'base64'));await writeFile('temp/artifacts/combat-followup/materials/lighting.json',JSON.stringify(Object.fromEntries(Object.entries(result).map(([k,v])=>[k,v.sum])),null,2));assert.ok(result.normal.sum>10000);assert.ok(Math.abs(result.normal.sum-result.champion.sum)>10000);
 }finally{await browser.close();}
});
