import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchProbeBrowser} from '../../../../scripts/lib/probeBrowser.mjs';
import {CLIENT_NEXT_BASE_URL} from '../../../../scripts/lib/probeEndpoints.mjs';

test('all native quest marker families publish visible GPU geometry and retire on removal',{timeout:90000},async()=>{
 const {browser,page}=await launchProbeBrowser();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(CLIENT_NEXT_BASE_URL);
  const result=await page.evaluate(async()=>{
   const {createAssets}=await import('/src/engine/runtime/assets/assets.ts');
   const {assetRequestBudget}=await import('/src/engine/foundation/assets/asset-budget.ts');
   const {createRenderer}=await import('/src/engine/runtime/renderer/renderer.ts');
   const {createCharacterEffects}=await import('/src/engine/runtime/characters/effects/effects.ts');
   const {createPresentationRandom}=await import('/src/engine/runtime/random/random.ts');
   const assets=createAssets(),canvas=document.createElement('canvas');document.body.append(canvas);const renderer=createRenderer(canvas);
   const effects=createCharacterEffects(assets,location.origin,()=>{},createPresentationRandom(1));
   const models=new Set(),jobs=new Map();
   const body={gid:101,height:20,model:'/assets/fixture-root',pose:{regionId:257,x:0,y:0,z:0,yaw:0},clip:'',time:0,loop:true,scale:1};
   let entities=[{gid:101,refObjId:1907,kind:'npc',regionId:257,x:0,y:0,z:0,heading:0}];let questMarkers=[];
   renderer.setCharacterModel(body.model,{nodes:[{name:'root',parent:-1,translation:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]}],primitives:[],clips:[],images:[]},[]);
   renderer.setWorld({id:'helper',originRegion:257,warnings:[],groups:[]});
   const output=document.createElement('canvas');output.width=output.height=192;const context=output.getContext('2d');
   function ready(path){if(models.has(path))return true;if(!jobs.has(path))jobs.set(path,assets.request(new URL(path,location.origin).href,assetRequestBudget(path.includes('#')?'effect':'character'),path.includes('#')?'effect':'character'));return false;}
   function step(at){
    for(const [path,id] of jobs){const result=assets.take(id);if(!result)continue;if(result.kind!=='character')throw Error(result.error??'Unexpected model result');renderer.setCharacterModel(path,result.model,result.images);models.add(path);jobs.delete(path);}
    const actors=effects.step(entities,{casts:[],questMarkers},at,ready,()=>1.5,[],undefined,[body]);
    if(effects.error())throw Error(effects.error());return actors;
   }
   try{
    async function sample(at,eye=[0,27,-60]){
     const actors=step(at);renderer.setCharacterActors([body,...actors]);renderer.setWorldCamera({originRegion:257,eye,target:[0,27,0],fov:1,near:.1,far:500});
     for(let i=0;i<120;i++){renderer.frame({width:192,height:192},0);if(renderer.error())throw Error(renderer.error());if(renderer.phase()==='running')break;await new Promise(requestAnimationFrame);}
     await new Promise(requestAnimationFrame);renderer.frame({width:192,height:192},0);const bitmap=await createImageBitmap(canvas);context.drawImage(bitmap,0,0);bitmap.close();
     return {actors:actors.length,pixels:[...context.getImageData(0,0,192,192).data],png:output.toDataURL()};
    }
    const removed=await sample(0),images={removed:removed.png},samples=[];
    for(let state=1;state<=4;state++){
     questMarkers=[{refId:7,flags:2,valueA:state,optional:101}];
     const deadline=performance.now()+15000;let actors;
     do{actors=step(state);if(actors.length>=2)break;if(performance.now()>deadline)throw Error('Quest marker admission deadline '+state);await new Promise(requestAnimationFrame);}while(true);
     const frame=await sample(state+.2);images['state-'+state]=frame.png;
     samples.push({state,actors:frame.actors,changed:frame.pixels.reduce((n,v,i)=>n+Number(v!==removed.pixels[i]),0),models:actors.map(a=>a.model)});
    }
    questMarkers=[];const cleared=await sample(5);images.cleared=cleared.png;
    return {samples,clearedActors:cleared.actors,clearDifference:cleared.pixels.reduce((n,v,i)=>n+Number(v!==removed.pixels[i]),0),images};
   }finally{effects.dispose();renderer.dispose();assets.dispose();canvas.remove();}
  });
  const out='temp/artifacts/quest-marker-effects';await mkdir(out,{recursive:true});for(const [name,png]of Object.entries(result.images))await writeFile(`${out}/${name}.png`,Buffer.from(png.split(',')[1],'base64'));
  const {images,...report}=result;await writeFile(`${out}/browser.json`,JSON.stringify({...report,errors},null,2)+'\n');
  assert.deepEqual(errors,[]);for(const sample of result.samples){assert.ok(sample.actors>=2);assert.ok(sample.changed>100,JSON.stringify(sample));}assert.equal(result.clearedActors,0);assert.equal(result.clearDifference,0);
 }finally{await browser.close();}
});
