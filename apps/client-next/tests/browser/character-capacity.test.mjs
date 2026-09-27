import {test} from 'node:test';
import assert from 'node:assert/strict';
import {launchProbeBrowser} from '../../../../scripts/lib/probeBrowser.mjs';
import {holdProbeRuntime} from './helpers/hold-runtime.mjs';
import {CLIENT_NEXT_BASE_URL} from '../../../../scripts/lib/probeEndpoints.mjs';
test('retained character capacity matches independent single-actor GPU draws through roster changes',{timeout:60000},async()=>{
 const {browser,page}=await launchProbeBrowser();try{
  await holdProbeRuntime(page);await page.goto(CLIENT_NEXT_BASE_URL);
  const result=await page.evaluate(async()=>{
   const {createRenderer}=await import('/src/engine/runtime/renderer/renderer.ts');
   const I=()=>Float32Array.of(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1);
   const model={nodes:[{name:'root',parent:-1,translation:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]}],images:[],clips:[{name:'move',duration:1,channels:[{node:0,path:'translation',interpolation:'LINEAR',times:Float32Array.of(0,1),values:Float32Array.of(0,0,0,0,2,0)}]}],primitives:[{name:'body',node:0,image:-1,joints:[0],inverseBind:I(),geometry:{positions:Float32Array.of(-1,-1,0,1,-1,0,0,1,0),normals:new Float32Array(9),uvs:new Float32Array(6),indices:Uint32Array.of(0,1,2),joints:new Uint32Array(12),weights:Float32Array.of(1,0,0,0,1,0,0,0,1,0,0,0),transform:I(),material:{color:[1,.2,.3,1],unlit:true,doubleSided:true,blend:false,alphaCutoff:0}}}]};
   const canvases=[document.createElement('canvas'),document.createElement('canvas')],renderers=canvases.map((c,i)=>createRenderer(c,undefined,undefined,{gpuAnimation:i===0})),out=document.createElement('canvas');out.width=128;out.height=96;const ctx=out.getContext('2d'),rows=[];
   try{
    const start=performance.now();while(renderers.some(r=>r.phase()==='starting')){if(performance.now()-start>15000)throw Error('GPU startup timeout');await new Promise(requestAnimationFrame);}
    renderers[0].setCharacterModel('shared',model,[]);for(let gid=1;gid<=12;gid++)renderers[1].setCharacterModel(String(gid),model,[]);
    for(const r of renderers)r.setCharacterPreview({eye:[0,0,-38],target:[0,0,0],near:1,far:100,fov:1});
    for(let frame=0;frame<12;frame++){
     const ids=frame<6?[1,2,3,4,5,6,7,8].slice(frame%3):frame<9?[2,3,4,5,6,7,8,9,10]:[1,3,4,6,8,10,12];
     const pixels=[];
     for(let i=0;i<2;i++){
      renderers[i].setCharacterActors(ids.map(gid=>({gid,model:i?String(gid):'shared',clip:'move',time:frame/12+gid/100,loop:true,layers:gid===ids[frame%ids.length]?[{clip:'move',time:.2,weight:.4,loop:true,lane:'event'},{clip:'move',time:.6,weight:.6,loop:true,lane:'timed'}]:undefined,scale:1,pose:{regionId:0,x:(gid-6.5)*3,y:0,z:0,yaw:0}})));
      renderers[i].frame({width:128,height:96},frame/12);
      const image=await createImageBitmap(canvases[i]);ctx.drawImage(image,0,0);image.close();pixels.push([...ctx.getImageData(0,0,128,96).data]);
     }
     rows.push(pixels);
    }
    return {rows,errors:renderers.map(r=>r.error()),stats:renderers.map(r=>r.characterStats())};
   }finally{renderers.forEach(r=>r.dispose());}
  });
  assert.deepEqual(result.errors,[null,null]);assert.ok(result.stats[0].gpuAnimation.poses>0,'GPU renderer must dispatch poses');assert.equal(result.stats[1].gpuAnimation,undefined);for(const [i,row] of result.rows.entries()){assert.deepEqual(row[0],row[1],`frame ${i}`);assert.ok(row[0].some((v,index)=>index%4===0&&v>180),'nonempty actor oracle');}
 }finally{await browser.close();}
});
