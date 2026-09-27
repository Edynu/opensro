import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchProbeBrowser} from '../../../../scripts/lib/probeBrowser.mjs';
import {CLIENT_NEXT_BASE_URL} from '../../../../scripts/lib/probeEndpoints.mjs';

test('native terrain fog composes two passes and distant fill matches object fog',{timeout:45000},async()=>{
 const {browser,page}=await launchProbeBrowser();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(CLIENT_NEXT_BASE_URL);
  const rows=await page.evaluate(async()=>{
   const {createRenderer}=await import('/src/engine/runtime/renderer/renderer.ts');
   const canvas=document.createElement('canvas');document.body.append(canvas);const renderer=createRenderer(canvas);
   const identity=()=>new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
   const output=document.createElement('canvas');output.width=output.height=64;const ctx=output.getContext('2d');
   const rows=[];
   try{
    const deadline=performance.now()+15000;while(renderer.phase()==='starting'&&performance.now()<deadline)await new Promise(requestAnimationFrame);
    for(const height of [0,2000])for(const distance of [750,1500,3000])for(const kind of ['terrain','lightmapped','object']){
     const z=160+distance;
     const quad=id=>({id,center:[160,height,z],radius:220,material:{color:[.8,.4,.2,1],unlit:true,alphaCutoff:0,blend:false,doubleSided:true,terrain:kind!=='object'},geometry:{world:true,positions:new Float32Array([10,height-150,z,310,height-150,z,310,height+150,z,10,height+150,z]),normals:new Float32Array(12).fill(1),uvs:new Float32Array([0,0,1,0,1,1,0,1]),indices:new Uint32Array([0,1,2,0,2,3]),instances:identity(),transform:identity()}});
     const groups=[quad('base')];if(kind==='lightmapped'){const light=quad('light');light.material={...light.material,terrain:false,lightmap:true,blend:true,texture:'light'};groups.push(light);}
     renderer.setWorldCamera({eye:[160,height,160],target:[160,height,z],fov:Math.PI/3,near:1,far:5000});
     renderer.setWorld({id:`fog:${height}:${distance}:${kind}`,originRegion:0,warnings:[],groups,environment:{startTimeOfDay:.5,ratePerSecond:0,tracks:{color0x2b4:[{t:0,r:.25,g:.36,b:.64}],scalar0x2e8:[{t:0,value:.2}],scalar0x314:[{t:0,value:.4}]}}});
     if(kind==='lightmapped')renderer.setWorldTexture('light',await createImageBitmap(new ImageData(Uint8ClampedArray.of(128,128,128,255),1,1)));
     renderer.frame({width:64,height:64},0);await new Promise(requestAnimationFrame);renderer.frame({width:64,height:64},0);
     if(renderer.phase()!=='running')throw new Error(renderer.error());
     const image=await createImageBitmap(canvas);ctx.drawImage(image,0,0);image.close();rows.push({height,distance,kind,pixel:[...ctx.getImageData(32,32,1,1).data]});
    }
    return rows;
   }finally{renderer.dispose();canvas.remove();}
  });
  await mkdir('temp/artifacts/bugs',{recursive:true});await writeFile('temp/artifacts/bugs/terrain-fog.json',JSON.stringify({rows,errors},null,2));
  const fog=[.25,.36,.64],linear=fog.map(v=>Math.floor(v*255)/255),terrainFog=fog.map(v=>Math.floor(Math.fround(Math.sqrt(Math.fround(v)))*255)/255);
  for(const row of rows){
   const f=Math.min(1,Math.max(0,(row.distance-500)/500)),far=row.distance===3000&&row.kind!=='object';
   const expected=far?linear:row.kind==='object'?[.8,.4,.2].map((v,i)=>v*(1-f)+linear[i]*f):[.8,.4,.2].map((v,i)=>(v*(1-f)+terrainFog[i]*f)*(row.kind==='lightmapped'?(128/255*(1-f)+terrainFog[i]*f):1));
   assert.ok(row.pixel.slice(0,3).every((v,i)=>Math.abs(v-Math.round(expected[i]*255))<=2),JSON.stringify({row,expected:expected.map(v=>Math.round(v*255))}));
  }
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
