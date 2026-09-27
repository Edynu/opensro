import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchProbeBrowser} from '../../../../scripts/lib/probeBrowser.mjs';
import {CLIENT_NEXT_BASE_URL} from '../../../../scripts/lib/probeEndpoints.mjs';

test('every published ambient drop model produces animated GPU pixels through its real attachment owner',{timeout:180000},async()=>{
 const {browser,page}=await launchProbeBrowser();
 try{
  await page.goto(CLIENT_NEXT_BASE_URL);
  const results=await page.evaluate(async()=>{
   const {createAssets}=await import('/src/engine/runtime/assets/assets.ts');
   const {createRenderer}=await import('/src/engine/runtime/renderer/renderer.ts');
   const {assetRequestBudget}=await import('/src/engine/foundation/assets/asset-budget.ts');
   const {modelAmbientParticles,createModelEmission}=await import('/src/engine/foundation/animation/model-emission.ts');
   const assets=createAssets(),canvas=document.createElement('canvas');document.body.append(canvas);
   const renderer=createRenderer(canvas),capture=document.createElement('canvas');capture.width=capture.height=192;
   const ctx=capture.getContext('2d'),results=[],loaded=new Set();let id=-1;
   async function load(path,decode){
    const request=assets.request(new URL(path,location.origin).href,assetRequestBudget(decode),decode),deadline=performance.now()+30000;let result;
    while(!(result=assets.take(request))){if(performance.now()>deadline)throw Error('Asset deadline '+path);await new Promise(requestAnimationFrame);}
    if(result.kind==='error')throw Error(result.error);return result;
   }
   async function admit(path,decode){if(loaded.has(path))return;const result=await load(path,decode);if(result.kind!=='character')throw Error('Expected model '+path);renderer.setCharacterModel(path,result.model,result.images);loaded.add(path);}
   async function sample(time,actors){
    renderer.setCharacterActors(actors);renderer.frame({width:192,height:192},time);await new Promise(requestAnimationFrame);renderer.frame({width:192,height:192},time);
    if(renderer.error())throw Error(renderer.error());const image=await createImageBitmap(canvas);ctx.drawImage(image,0,0);image.close();return {pixels:ctx.getImageData(0,0,192,192).data,png:capture.toDataURL()};
   }
   try{
    const deadline=performance.now()+20000;while(renderer.phase()==='starting'){if(performance.now()>deadline)throw Error('GPU initialization timeout');await new Promise(requestAnimationFrame);}
    renderer.setWorld({id:'drop-ambient',originRegion:257,warnings:[],groups:[]});renderer.setWorldCamera({originRegion:257,eye:[0,15,-100],target:[0,10,0],fov:1,near:.1,far:1000});
    const manifestResult=await load('/assets/itemdrop/manifest.json');if(manifestResult.kind!=='bytes')throw Error('Expected drop manifest');
    const manifest=JSON.parse(new TextDecoder().decode(manifestResult.buffer));
    for(const [path,row] of Object.entries(manifest.models)){
     const particles=modelAmbientParticles(row.particleModifiers);if(!particles.length)continue;
     await admit(row.glb,'character');for(const p of particles)await admit('/assets/effects/programs.json#'+encodeURIComponent(p.effectPath),'effect');
     const owner=createModelEmission(()=>id--),actor={gid:1,model:row.glb,pose:{regionId:257,x:0,y:0,z:0,yaw:0},clip:row.clips.includes('stand')?'stand':'',time:0,loop:row.clipLoop,scale:1};
     const diff=(a,b)=>a.pixels.reduce((n,v,i)=>n+Number(v!==b.pixels[i]),0);
     const base=await sample(0,[actor]);let previous=base,best=base,visible=0,animated=0;
     // Authored sparkles have quiet frames. Measure the complete window, not
     // a single timestamp that can coincide with the gap between emissions.
     for(let i=0;i<=40;i++){const t=i/20,frame=await sample(t,[actor,...owner.step([{actor,particles}],t,()=>true,128)]),changed=diff(frame,base);if(changed>visible){visible=changed;best=frame;}if(i>0)animated=Math.max(animated,diff(frame,previous));previous=frame;}
     results.push({path,emitters:particles.length,visible,animated,png:best.png});
     owner.reset();await sample(0,[]);
    }
    return results;
   }finally{renderer.dispose();assets.dispose();canvas.remove();}
  });
  const output='temp/artifacts/bugs/drop-ambient';await mkdir(output,{recursive:true});
  for(const row of results){await writeFile(output+'/'+row.path.split('/').at(-1)+'.png',Buffer.from(row.png.split(',')[1],'base64'));delete row.png;}
  await writeFile(output+'/result.json',JSON.stringify(results,null,2)+'\n');
  assert.ok(results.length>0);for(const row of results){assert.ok(row.visible>0,JSON.stringify(row));assert.ok(row.animated>0,JSON.stringify(row));}
 }finally{await browser.close();}
});
