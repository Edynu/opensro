import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchProbeBrowser} from '../../../../scripts/lib/probeBrowser.mjs';
import {CLIENT_NEXT_BASE_URL} from '../../../../scripts/lib/probeEndpoints.mjs';
import {holdProbeRuntime,enableNativeCharacterLighting} from './helpers/hold-runtime.mjs';

for(const enabled of [false,true])test(`lighting ${enabled ? 'enabled' : 'disabled'}: native point-light ambient is actor-local and GPU state clears after expiry`,{timeout:60000},async()=>{
 const {browser,page}=await launchProbeBrowser();
 try{
  await holdProbeRuntime(page);if(enabled)await enableNativeCharacterLighting(page);await page.goto(CLIENT_NEXT_BASE_URL);
  const result=await page.evaluate(async()=>{
   const {createRenderer}=await import('/src/engine/runtime/renderer/renderer.ts');
   const canvas=document.createElement('canvas'),renderer=createRenderer(canvas),out=document.createElement('canvas');out.width=out.height=128;const context=out.getContext('2d');
   const I=()=>Float32Array.of(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1);
   const material={color:[0,0,0,1],ambient:[0,0,0],objectLight:1,alphaCutoff:0,blend:false,doubleSided:true,unlit:false,fogDisabled:true};
   const model=mat=>({nodes:[{name:'root',parent:-1,translation:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]}],images:[],clips:[],primitives:[{name:'body',node:0,image:-1,joints:[0],inverseBind:I(),geometry:{positions:Float32Array.of(-25,-25,0,25,-25,0,0,25,0),normals:Float32Array.of(0,0,-1,0,0,-1,0,0,-1),joints:new Uint32Array(12),weights:Float32Array.of(1,0,0,0,1,0,0,0,1,0,0,0),indices:Uint32Array.of(0,1,2),transform:I(),material:mat}}]});
   const actor={gid:1,model:'body',clip:'',time:0,loop:false,scale:1,pose:{regionId:257,x:0,y:0,z:0,yaw:0}},tint=[.1,.3,.6];
   async function sample(rows){renderer.setCharacterActors(rows);renderer.frame({width:128,height:128},0);if(renderer.error())throw Error(renderer.error());const image=await createImageBitmap(canvas);context.drawImage(image,0,0);image.close();return [...context.getImageData(64,64,1,1).data];}
   try{
    const start=performance.now();while(renderer.phase()==='starting'&&performance.now()-start<15000)await new Promise(requestAnimationFrame);
    if(renderer.phase()!=='running')throw Error(renderer.error()??renderer.phase());
    renderer.setWorld({id:'material-reference',originRegion:257,groups:[],warnings:[]});renderer.setWorldCamera({eye:[0,0,-80],target:[0,0,0],originRegion:257,fov:1,near:1,far:500});
    renderer.setCharacterModel('body',model(material),[]);const referenceModel=model({...material,unlit:true});referenceModel.primitives[0].geometry.colors=Float32Array.of(...tint,1,...tint,1,...tint,1);renderer.setCharacterModel('reference',referenceModel,[]);
    const original=await sample([actor]),colored=await sample([{...actor,pointLight:{pose:actor.pose,ambient:tint,diffuse:[0,0,0],attenuation:.2,range:1000}}]),reference=await sample([{...actor,model:'reference'}]),restored=await sample([actor]);
    const peer=await sample([{...actor,gid:2},{...actor,pointLight:{pose:actor.pose,ambient:tint,diffuse:[0,0,0],attenuation:.2,range:1000},pose:{...actor.pose,x:500}}]);renderer.setCharacterModel('diffuse',model({...material,color:[.1,.1,.1,1]}),[]);
    const diffuseActor={...actor,model:'diffuse'},light={pose:{...actor.pose,z:-80},ambient:[0,0,0],diffuse:[2,2,2],attenuation:.2,range:1000};
    const unlitPoint=await sample([diffuseActor]),nearPoint=await sample([{...diffuseActor,pointLight:light}]),farPoint=await sample([{...diffuseActor,pointLight:{...light,pose:{...light.pose,z:-160}}}]);
    return {original,colored,reference,restored,peer,unlitPoint,nearPoint,farPoint};
   }finally{renderer.dispose();}
  });
  await mkdir('temp/artifacts/hit-light',{recursive:true});await writeFile(`temp/artifacts/hit-light/gpu-${enabled}.json`,JSON.stringify(result,null,2)+'\n');
  assert.deepEqual(result.restored,result.original);assert.deepEqual(result.peer,result.original);
  if(enabled){assert.deepEqual(result.colored,result.reference);assert.notDeepEqual(result.colored,result.original);assert.ok(result.nearPoint[0]>result.farPoint[0]);assert.ok(result.farPoint[0]>result.unlitPoint[0]);}
  else{assert.deepEqual(result.colored,result.original);assert.deepEqual(result.nearPoint,result.unlitPoint);assert.deepEqual(result.farPoint,result.unlitPoint);}
 }finally{await browser.close();}
});
