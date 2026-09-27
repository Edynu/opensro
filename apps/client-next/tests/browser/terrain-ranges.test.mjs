import {test} from 'node:test';
import assert from 'node:assert/strict';
import {launchProbeBrowser} from '../../../../scripts/lib/probeBrowser.mjs';
import {holdProbeRuntime} from './helpers/hold-runtime.mjs';
import {CLIENT_NEXT_BASE_URL} from '../../../../scripts/lib/probeEndpoints.mjs';

test('sparse terrain seam writes match full GPU uploads through LOD changes and readmission',{timeout:60000},async()=>{
 const {browser,page}=await launchProbeBrowser();try{
  await holdProbeRuntime(page);
  await page.route('**/runtime/renderer/device/geometry.ts*',async route=>{
   const response=await route.fetch(),source=await response.text(),needle='const gpu = current(), meta = metadata.get(draw), count = positions.length / 3;';
   assert.ok(source.includes(needle),'instrument the compiled position-update entry');
   await route.fulfill({response,body:source.replace(needle,'if (globalThis.__fullPositionWrites) ranges = undefined; '+needle)});
  });
  await page.goto(CLIENT_NEXT_BASE_URL);
  const result=await page.evaluate(async()=>{
   const {createRenderer}=await import('/src/engine/runtime/renderer/renderer.ts');
   const {createWorldDecoder}=await import('/src/engine/runtime/assets/worker/world/world.ts');
   const heights=Array.from({length:289},(_,i)=>Math.sin(i%17)*40+Math.cos(Math.floor(i/17))*30);
   const bundle={source:{sectorX:1,sectorY:1},terrain:{blocks:[{blockX:0,blockZ:0,heights,textureData:Array(289).fill(0)}]},terrainTextures:{tileCatalog:{referencedTiles:[{textureId:0,imagePublicPath:'tile'}]}},objects:{placements:[],resources:{meshes:[],bsr:[],materialSets:[]}}};
   const scene=createWorldDecoder().decode(new TextEncoder().encode(JSON.stringify(bundle)));
   const canvases=[document.createElement('canvas'),document.createElement('canvas')],renderers=canvases.map(c=>createRenderer(c));
   const output=document.createElement('canvas');output.width=output.height=128;const ctx=output.getContext('2d'),rows=[];
   try{
    const start=performance.now();while(renderers.some(r=>r.phase()==='starting')){if(performance.now()-start>15000)throw Error('GPU startup timeout');await new Promise(requestAnimationFrame);}
    for(let cycle=0;cycle<2;cycle++){
     for(const r of renderers){r.setWorld(scene);r.setWorldTexture('tile',await createImageBitmap(new ImageData(new Uint8ClampedArray([240,50,70,255]),1,1)));}
     for(const x of [-1280,-960,-1600,-960,-1280]){
      const pixels=[];
      for(let i=0;i<2;i++){
       globalThis.__fullPositionWrites=Boolean(i);renderers[i].setWorldCamera({eye:[x,500,10],target:[160,0,160],fov:Math.PI/3,near:1,far:5000});renderers[i].frame({width:128,height:128},1);
       const image=await createImageBitmap(canvases[i]);ctx.drawImage(image,0,0);image.close();pixels.push([...ctx.getImageData(0,0,128,128).data]);
      }
      rows.push(pixels);
     }
     for(const r of renderers)r.setWorld(null);
    }
    return {rows,errors:renderers.map(r=>r.error())};
   }finally{globalThis.__fullPositionWrites=false;renderers.forEach(r=>r.dispose());}
  });
  assert.deepEqual(result.errors,[null,null]);for(const [i,row] of result.rows.entries()){assert.deepEqual(row[0],row[1],`terrain frame ${i}`);assert.ok(row[0].some((v,index)=>index%4===0&&v>100&&v>row[0][index+1]*1.5),'visible terrain oracle');}
 }finally{await browser.close();}
});
