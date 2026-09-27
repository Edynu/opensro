import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchProbeBrowser} from '../../../../scripts/lib/probeBrowser.mjs';
import {CLIENT_NEXT_BASE_URL} from '../../../../scripts/lib/probeEndpoints.mjs';
import {holdProbeRuntime} from './helpers/hold-runtime.mjs';

test('live GPU tint matches lighting-input reference and restores original pixels',{timeout:60000},async()=>{
 const {browser,page}=await launchProbeBrowser();
 try{
  await holdProbeRuntime(page);await page.goto(CLIENT_NEXT_BASE_URL);
  const result=await page.evaluate(async()=>{
   const {createRenderer}=await import('/src/engine/runtime/renderer/renderer.ts');
   const canvas=document.createElement('canvas'),renderer=createRenderer(canvas),out=document.createElement('canvas');out.width=out.height=128;const context=out.getContext('2d');
   const I=()=>Float32Array.of(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1);
   const material={color:[.7,.2,.9,1],ambient:[.8,.4,.2],objectLight:1,alphaCutoff:0,blend:false,doubleSided:true,unlit:false,fogDisabled:true};
   const model=mat=>({nodes:[{name:'root',parent:-1,translation:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]}],images:[],clips:[],primitives:[{name:'body',node:0,image:-1,joints:[0],inverseBind:I(),geometry:{positions:Float32Array.of(-25,-25,0,25,-25,0,0,25,0),normals:Float32Array.of(0,0,-1,0,0,-1,0,0,-1),joints:new Uint32Array(12),weights:Float32Array.of(1,0,0,0,1,0,0,0,1,0,0,0),indices:Uint32Array.of(0,1,2),transform:I(),material:mat}}]});
   const actor={gid:1,model:'body',clip:'',time:0,loop:false,scale:1,pose:{regionId:257,x:0,y:0,z:0,yaw:0}},tint=[.1,.3,.6];
   async function sample(rows){renderer.setCharacterActors(rows);renderer.frame({width:128,height:128},0);if(renderer.error())throw Error(renderer.error());const image=await createImageBitmap(canvas);context.drawImage(image,0,0);image.close();return [...context.getImageData(64,64,1,1).data];}
   try{
    const start=performance.now();while(renderer.phase()==='starting'&&performance.now()-start<15000)await new Promise(requestAnimationFrame);
    if(renderer.phase()!=='running')throw Error(renderer.error()??renderer.phase());
    renderer.setWorld({id:'material-reference',originRegion:257,groups:[],warnings:[]});renderer.setWorldCamera({eye:[0,0,-80],target:[0,0,0],originRegion:257,fov:1,near:1,far:500});
    renderer.setCharacterModel('body',model(material),[]);renderer.setCharacterModel('reference',model({...material,color:[...tint,1],ambient:tint}),[]);
    const original=await sample([actor]),colored=await sample([{...actor,materialTint:tint}]),reference=await sample([{...actor,model:'reference'}]),restored=await sample([actor]);
    const peer=await sample([{...actor,gid:2},{...actor,materialTint:tint,pose:{...actor.pose,x:500}}]);return {original,colored,reference,restored,peer};
   }finally{renderer.dispose();}
  });
  await mkdir('temp/artifacts/effect-material',{recursive:true});await writeFile('temp/artifacts/effect-material/gpu.json',JSON.stringify(result,null,2)+'\n');
  assert.deepEqual(result.colored,result.reference);assert.deepEqual(result.restored,result.original);assert.deepEqual(result.peer,result.original);assert.notDeepEqual(result.colored,result.original);
 }finally{await browser.close();}
});
