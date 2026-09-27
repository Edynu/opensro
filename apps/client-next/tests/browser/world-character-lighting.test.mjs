import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchProbeBrowser} from '../../../../scripts/lib/probeBrowser.mjs';
import {CLIENT_NEXT_BASE_URL} from '../../../../scripts/lib/probeEndpoints.mjs';
import {holdProbeRuntime} from './helpers/hold-runtime.mjs';
test('published world character responds to ambient and directional lighting through character draws',{timeout:60000},async()=>{
 const {browser,page}=await launchProbeBrowser();try{await holdProbeRuntime(page);await page.goto(CLIENT_NEXT_BASE_URL);
 const result=await page.evaluate(async()=>{
  const {createAssets}=await import('/src/engine/runtime/assets/assets.ts'),{createRenderer}=await import('/src/engine/runtime/renderer/renderer.ts');const assets=createAssets(),canvas=document.createElement('canvas'),renderer=createRenderer(canvas),copy=document.createElement('canvas');copy.width=copy.height=256;const ctx=copy.getContext('2d');
  const path='/assets/char/china/chinaman_adventurer.glb',id=assets.request(new URL(path,location.origin).href,16<<20,'character');let loaded;const end=performance.now()+20000;
  try{while(!(loaded=assets.take(id))){if(performance.now()>end)throw Error('Model loading deadline');await new Promise(requestAnimationFrame);}if(loaded.kind!=='character')throw Error(loaded.error??'Wrong asset');renderer.setCharacterModel(path,loaded.model,loaded.images);
   let serial=0;async function sample(ambient,diffuse,yaw){renderer.setWorld(null);const rgb=n=>[{t:0,r:n,g:n,b:n}];renderer.setWorld({id:'character-light:'+serial++,originRegion:257,groups:[],warnings:[],environment:{startTimeOfDay:.5,ratePerSecond:0,tracks:{color0xf0:rgb(diffuse),color0x124:rgb(ambient),scalar0x2e8:[{t:0,value:1}],scalar0x314:[{t:0,value:1}]}}});renderer.setWorldCamera({eye:[0,10,-35],target:[0,10,0],originRegion:257,fov:1,near:1,far:500});renderer.setCharacterActors([{gid:1,model:path,pose:{regionId:257,x:0,y:0,z:0,yaw},clip:'stand',time:0,loop:true,scale:1}]);
    for(let i=0;i<10;i++){renderer.frame({width:256,height:256},0);if(renderer.error())throw Error(renderer.error());await new Promise(requestAnimationFrame);}const bitmap=await createImageBitmap(canvas);ctx.drawImage(bitmap,0,0);bitmap.close();const pixels=ctx.getImageData(64,32,128,208).data;return {sum:pixels.reduce((s,n,i)=>s+(i%4===3?0:n),0),png:copy.toDataURL()};}
   return {dark:await sample(0,0,0),ambient:await sample(.5,0,0),directional:await sample(0,1,0),reverse:await sample(0,1,Math.PI)};
  }finally{renderer.dispose();assets.dispose();}
 });await mkdir('temp/artifacts/character-lighting/world',{recursive:true});for(const [key,value] of Object.entries(result))await writeFile('temp/artifacts/character-lighting/world/'+key+'.png',Buffer.from(value.png.split(',')[1],'base64'));await writeFile('temp/artifacts/character-lighting/world/lighting.json',JSON.stringify(Object.fromEntries(Object.entries(result).map(([k,v])=>[k,v.sum])),null,2));assert.ok(result.ambient.sum>result.dark.sum+10000);assert.ok(result.directional.sum>result.dark.sum+10000);assert.ok(Math.abs(result.directional.sum-result.reverse.sum)>10000);
 }finally{await browser.close();}
});
