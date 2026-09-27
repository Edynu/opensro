import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchProbeBrowser} from '../../../../scripts/lib/probeBrowser.mjs';
import {CLIENT_NEXT_BASE_URL} from '../../../../scripts/lib/probeEndpoints.mjs';
import {holdProbeRuntime} from './helpers/hold-runtime.mjs';

// Read-only scene replay through the production stream/worker/renderer owners.
// No session, character, or database mutation is needed to reproduce foliage.
test('Grassland scene at the reported coordinates admits foliage and ground shadows',{timeout:120000},async()=>{
 const {browser,page}=await launchProbeBrowser();try{
  await holdProbeRuntime(page);await page.goto(CLIENT_NEXT_BASE_URL);
  const result=await page.evaluate(async()=>{
   const {createAssets}=await import('/src/engine/runtime/assets/assets.ts'),{createRenderer}=await import('/src/engine/runtime/renderer/renderer.ts'),{createWorldStream}=await import('/src/engine/runtime/world/world.ts');
   const {createPresentationRandom}=await import('/src/engine/runtime/random/random.ts');
   const canvas=document.createElement('canvas'),assets=createAssets(),renderer=createRenderer(canvas,createPresentationRandom(1)),world=createWorldStream(assets,renderer,location.origin);
   const pose={regionId:0x60a8,x:950,y:-40,z:530,angle:0},camera={yaw:0,pitch:Math.PI/18,distance:40};
   const deadline=performance.now()+90000;
   try{
    do{world.step(pose,camera);renderer.frame({width:1008,height:766},performance.now()/1000);if(world.error()||renderer.error())throw Error(world.error()??renderer.error());if(performance.now()>deadline)throw Error('Scene admission deadline: '+JSON.stringify(renderer.worldStats()));await new Promise(requestAnimationFrame);}while(!world.ready());
    // Freeze the comparison lighting; sky time differs in the supplied images.
    renderer.setWorldClock({timeOfDay:.75,lunarDay:14});
    for(let i=0;i<120;i++){world.step(pose,camera);renderer.frame({width:1008,height:766},100+i/60);await new Promise(requestAnimationFrame);}
    const image=await createImageBitmap(canvas),copy=document.createElement('canvas');copy.width=1008;copy.height=766;copy.getContext('2d').drawImage(image,0,0);image.close();
    return {png:copy.toDataURL(),stats:renderer.worldStats(),camera,pose,error:renderer.error()};
   }finally{world.dispose();renderer.dispose();assets.dispose();}
  });
  await mkdir('temp/artifacts/tree-fidelity',{recursive:true});await writeFile('temp/artifacts/tree-fidelity/grassland.png',Buffer.from(result.png.split(',')[1],'base64'));delete result.png;await writeFile('temp/artifacts/tree-fidelity/grassland.json',JSON.stringify(result,null,2));
  assert.equal(result.error,null);assert.ok(result.stats.residentGroups>0);assert.equal(result.stats.pendingTextures,0);
 }finally{await browser.close();}
});
