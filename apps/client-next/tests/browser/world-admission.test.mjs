import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchProbeBrowser} from '../../../../scripts/lib/probeBrowser.mjs';
import {CLIENT_NEXT_BASE_URL} from '../../../../scripts/lib/probeEndpoints.mjs';

test('transferred admission matches copying admission pixels through repeated replace and clear cycles',{timeout:60000},async()=>{
 const {browser,page}=await launchProbeBrowser(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(CLIENT_NEXT_BASE_URL);
  const result=await page.evaluate(async()=>{
   const {createRenderer}=await import('/src/engine/runtime/renderer/renderer.ts');
   const {prepareWorldScene,worldSceneTransfers}=await import('/src/engine/foundation/rendering/world-scene.ts');
   const {createWorldLease}=await import('/src/engine/runtime/assets/world-lease.ts');
   const canvases=[document.createElement('canvas'),document.createElement('canvas')],renderers=canvases.map(c=>createRenderer(c));
   const identity=()=>new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
   const output=document.createElement('canvas');output.width=output.height=64;const ctx=output.getContext('2d'),rows=[];
   async function read(index){renderers[index].frame({width:64,height:64},1);const image=await createImageBitmap(canvases[index]);ctx.drawImage(image,0,0);image.close();return {pixels:[...ctx.getImageData(0,0,64,64).data],png:output.toDataURL().split(',')[1]};}
   try{
    const start=performance.now();while(renderers.some(r=>r.phase()==='starting')){if(performance.now()-start>15000)throw Error('GPU startup timeout');await new Promise(requestAnimationFrame);}
    for(let cycle=0;cycle<3;cycle++){
     const scene={id:`cycle-${cycle}`,originRegion:1,warnings:[],groups:[{id:'triangle',center:[0,0,0],radius:2,
      material:{color:[cycle===1?.2:1,cycle===2?1:.2,.3,1],unlit:true,alphaCutoff:0,blend:false,doubleSided:true},
      geometry:{positions:new Float32Array([-1,-1,0,1,-1,0,0,1,0]),normals:new Float32Array([0,0,1,0,0,1,0,0,1]),uvs:new Float32Array(6),indices:new Uint32Array([0,1,2]),instances:identity(),transform:identity()}}]};
     renderers[0].setWorld(scene);
     const prepared=prepareWorldScene(scene),buffers=worldSceneTransfers(prepared.scene),received=structuredClone(prepared,{transfer:buffers});
     if(buffers.some(b=>b.byteLength!==0))throw Error('Sender still owns a buffer');
     renderers[1].adoptWorld(createWorldLease(received));
     for(const cameraX of [0,.5,0]){
      for(const r of renderers)r.setWorldCamera({eye:[cameraX,0,3],target:[0,0,0],near:.1,far:100,fov:Math.PI/3});
      const a=await read(0),b=await read(1);rows.push({cycle,cameraX,a,b,stats:renderers.map(r=>r.worldStats())});
     }
     for(const r of renderers)r.setWorld(null);
     rows.push({cycle,clear:true,a:await read(0),b:await read(1),stats:renderers.map(r=>r.worldStats())});
    }
    return {rows,errors:renderers.map(r=>r.error())};
   }finally{renderers.forEach(r=>r.dispose());}
  });
  assert.deepEqual(errors,[]);assert.deepEqual(result.errors,[null,null]);
  for(const row of result.rows){assert.deepEqual(row.a.pixels,row.b.pixels,JSON.stringify({cycle:row.cycle,cameraX:row.cameraX,clear:row.clear}));assert.deepEqual(row.stats[0],row.stats[1]);}
  const first=result.rows[0];assert.ok(first.a.pixels[(32*64+32)*4]>150,'oracle must contain the visible triangle');
  assert.notDeepEqual(result.rows[3].a.pixels,first.a.pixels,'clear must change pixels');
  await mkdir('temp/artifacts/admission-raster',{recursive:true});
  for(const [name,row] of [['first',first],['restored',result.rows.at(-2)]])await writeFile(`temp/artifacts/admission-raster/${name}.png`,Buffer.from(row.b.png,'base64'));
  await writeFile('temp/artifacts/admission-raster/report.json',JSON.stringify({cycles:3,comparisons:result.rows.length,errors:result.errors,verdict:'PASS'},null,2));
 }finally{await browser.close();}
});
