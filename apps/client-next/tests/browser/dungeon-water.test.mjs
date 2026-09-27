import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CLIENT_NEXT_BASE_URL} from '../../../../scripts/lib/probeEndpoints.mjs';
import {launchProbeBrowser} from '../../../../scripts/lib/probeBrowser.mjs';

test('dungeon water draws with factor alpha, switches rooms, and survives resize',{timeout:45000},async()=>{
 const {browser,page}=await launchProbeBrowser();
 try{
  await page.goto(CLIENT_NEXT_BASE_URL);
  const result=await page.evaluate(async()=>{
   const {createRenderer}=await import('/src/engine/runtime/renderer/renderer.ts');
   const {dungeonWaterGroup}=await import('/src/engine/foundation/rendering/dungeon-water.ts');
   const canvas=document.createElement('canvas');document.body.append(canvas);const renderer=createRenderer(canvas);
   const paths=Array.from({length:30},(_,i)=>'/assets/water-fixture/'+i);
   const group=dungeonWaterGroup({blockIndex:0,vertices:[-100,0,-100,-100,0,100,100,0,100,100,0,-100],color:0xff80ffff,fog:{color:0x203040,nearPlane:50,farPlane:500,intensity:.001}},paths);
   const scene={id:'dungeon-water-test',originRegion:0x8001,dungeonVisibility:[[0],[1]],warnings:[],groups:[group]};
   const camera={eye:[0,100,0],target:[0,0,0],up:[0,0,1],fov:Math.PI/2,near:1,far:500,dungeonBlock:0};
   let seconds=0;
   async function render(width=96){for(let i=0;i<2;i++){renderer.frame({width,height:96},seconds+=.1);await new Promise(requestAnimationFrame);}renderer.frame({width,height:96},seconds+=.1);if(renderer.error())throw Error(renderer.error());const image=await createImageBitmap(canvas),copy=document.createElement('canvas');copy.width=width;copy.height=96;const ctx=copy.getContext('2d');ctx.drawImage(image,0,0);image.close();return [...ctx.getImageData(width/2,48,1,1).data];}
   try{
    renderer.setWorldCamera(camera);renderer.setWorld(scene);
    for(const path of paths)renderer.setWorldTexture(path,await createImageBitmap(new ImageData(Uint8ClampedArray.of(200,100,50,0),1,1),{premultiplyAlpha:'none'}));
    for(let i=0;i<300&&renderer.phase()==='starting';i++)await new Promise(requestAnimationFrame);
    const transparentTexel=await render();
    // Distinct frame paths force complete readmission of the second array.
    const opaquePaths=paths.map(path=>path+'-opaque');
    renderer.setWorld({...scene,id:'opaque-alpha',groups:[{...group,material:{...group.material,texture:opaquePaths[0],frames:opaquePaths}}]});
    for(const path of opaquePaths)renderer.setWorldTexture(path,await createImageBitmap(new ImageData(Uint8ClampedArray.of(200,100,50,255),1,1),{premultiplyAlpha:'none'}));
    const opaqueTexel=await render(),resized=await render(128);
    renderer.setWorldCamera({...camera,dungeonBlock:1});const otherRoom=await render(128);
    renderer.setWorldCamera(camera);const returned=await render(128);
    renderer.setWorld(null);const cleared=await render(128);
    return {transparentTexel,opaqueTexel,resized,otherRoom,returned,cleared,error:renderer.error()};
   }finally{renderer.dispose();canvas.remove();}
  });
  assert.equal(result.error,null);assert.deepEqual(result.transparentTexel,result.opaqueTexel);
  assert.deepEqual(result.opaqueTexel,result.resized);assert.deepEqual(result.resized,result.returned);
  assert.notDeepEqual(result.resized,result.otherRoom);assert.deepEqual(result.otherRoom,result.cleared);
 }finally{await browser.close();}
});
