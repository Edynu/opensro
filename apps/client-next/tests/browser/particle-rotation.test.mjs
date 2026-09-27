import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchProbeBrowser} from '../../../../scripts/lib/probeBrowser.mjs';
import {CLIENT_NEXT_BASE_URL} from '../../../../scripts/lib/probeEndpoints.mjs';
import {holdProbeRuntime} from './helpers/hold-runtime.mjs';

test('shape rotation and spin reach GPU geometry beneath the outer skill roll',{timeout:60000},async()=>{
 const {browser,page}=await launchProbeBrowser();
 try{await holdProbeRuntime(page);await page.goto(CLIENT_NEXT_BASE_URL);
  const result=await page.evaluate(async()=>{
   const {createRenderer}=await import('/src/engine/runtime/renderer/renderer.ts'),{particleProgram}=await import('/src/engine/foundation/animation/particle-program.ts');
   const canvas=document.createElement('canvas'),renderer=createRenderer(canvas),output=document.createElement('canvas');output.width=output.height=128;const ctx=output.getContext('2d');
   const I=()=>Float32Array.of(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1),points=[-10,-10,0,10,-10,0,10,10,0,-10,10,0];
   const model=positions=>({nodes:[{name:'root',parent:-1,translation:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]}],images:[],clips:[],primitives:[{name:'slab',node:0,image:-1,joints:[0],inverseBind:I(),geometry:{positions:Float32Array.from(positions),normals:Float32Array.from(Array(4).fill([0,0,-1]).flat()),joints:new Uint32Array(16),weights:Float32Array.from(Array(4).fill([1,0,0,0]).flat()),indices:Uint32Array.of(0,1,2,0,2,3),transform:I(),material:{color:[.8,.4,.1,1],alphaCutoff:0,blend:false,doubleSided:true,unlit:true,fogDisabled:true}}}]});
   const commands=[['SetShapeRotVel',-35],['SetShapeRot',15]].map(([name,angle])=>({name,frames:[0,1],program:particleProgram([{name,parameter:{kind:'AxisVector4',left:[1,0,0,angle],right:Array.from(I())}}])}));
   const effect=model(points);effect.particleGraph=[{parent:-1,parents:[0],births:[0],frames:10,commands,shapeMotion:true,positionDepth:0,matrixDepth:0,velocityDepth:0,followDepth:0,scales:[],positions:[],rotations:[]}];effect.primitives[0].particleEmitter=0;effect.primitives[0].emission={births:[0],lifetime:.5,follow:false};
   const outer=Math.fround(315*3.1415927410125732/180),base={gid:1,model:'effect',clip:'',loop:false,scale:1,pose:{regionId:257,x:0,y:0,z:0,yaw:0}};
   async function pixels(actor){renderer.setCharacterActors(actor?[actor]:[]);renderer.frame({width:128,height:128},0);if(renderer.error())throw Error(renderer.error());const image=await createImageBitmap(canvas);ctx.drawImage(image,0,0);image.close();return ctx.getImageData(0,0,128,128).data;}
   try{const start=performance.now();while(renderer.phase()==='starting'&&performance.now()-start<15000)await new Promise(requestAnimationFrame);if(renderer.phase()!=='running')throw Error(renderer.error());
    renderer.setWorld({id:'rotation oracle',originRegion:257,groups:[],warnings:[]});renderer.setWorldCamera({eye:[0,0,-60],target:[0,0,0],originRegion:257,fov:1,near:1,far:1000});renderer.setCharacterModel('effect',effect,[]);
    const results=[];
    for(const [time,degrees]of [[0,15],[.05,15],[.1,-20]]){
     // Independent vertex-space reference: X shape first, Z skill roll second.
     const a=degrees*Math.PI/180,co=Math.cos(outer),si=Math.sin(outer),vertices=[];
     for(let i=0;i<points.length;i+=3){const x=points[i],y=points[i+1]*Math.cos(a),z=points[i+1]*Math.sin(a);vertices.push(co*x-si*y,si*x+co*y,z);}
     renderer.setCharacterModel('reference'+time,model(vertices),[]);
     const actual=await pixels({...base,time,effectRotation:{axis:'z',angle:outer}}),expected=await pixels({...base,model:'reference'+time,time:0});let max=0,different=0;
     for(let i=0;i<actual.length;i++){max=Math.max(max,Math.abs(actual[i]-expected[i]));if(actual[i]!==expected[i])different++;}results.push({time,max,different,lit:actual.filter((v,i)=>i%4===0&&v>100).length});
    }return results;
   }finally{renderer.dispose();}
  });
  await mkdir('temp/artifacts/particle-rotation',{recursive:true});await writeFile('temp/artifacts/particle-rotation/gpu.json',JSON.stringify(result,null,2));
  for(const row of result){assert.ok(row.lit>100);assert.ok(row.max<=1,JSON.stringify(row));}
 }finally{await browser.close();}
});
