import {test} from 'node:test';
import assert from 'node:assert/strict';
import {launchProbeBrowser} from '../../../../scripts/lib/probeBrowser.mjs';
import {CLIENT_NEXT_BASE_URL} from '../../../../scripts/lib/probeEndpoints.mjs';

test('entity material clock changes GPU pixels across a clip switch and retiring-holder transfer',{timeout:45000},async()=>{
 const {browser,page}=await launchProbeBrowser();
 try{
  await page.goto(CLIENT_NEXT_BASE_URL);
  const result=await page.evaluate(async()=>{
   const {createRenderer}=await import('/src/engine/runtime/renderer/renderer.ts');
   const canvas=document.createElement('canvas');document.body.append(canvas);const renderer=createRenderer(canvas),I=()=>Float32Array.of(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1);
   const material={color:[1,1,1,1],alphaCutoff:0,blend:false,doubleSided:true,unlit:true,colorTimeline:{duration:1000,mode:0,flags:2,colors:[{time:0,value:[1,0,0,1]},{time:1000,value:[0,1,0,1]}]}};
   const model={nodes:[{name:'root',parent:-1,translation:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]}],images:[],clips:['stand','run'].map(name=>({name,duration:1,channels:[]})),primitives:[{name:'mesh',node:0,joints:[0],inverseBind:I(),image:-1,geometry:{positions:Float32Array.of(-20,-20,0,20,-20,0,20,20,0,-20,20,0),indices:Uint32Array.of(0,1,2,0,2,3),joints:new Uint32Array(16),weights:Float32Array.of(1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0),transform:I(),material}}]};
   const output=document.createElement('canvas');output.width=output.height=64;const ctx=output.getContext('2d');
   const actor={gid:1,modifierId:-10,model:'timed',pose:{regionId:257,x:0,y:0,z:0,yaw:0},clip:'stand',time:0,loop:true,scale:1};
   async function sample(time,change={}){renderer.setCharacterActors([{...actor,...change}]);renderer.frame({width:64,height:64},time);await new Promise(requestAnimationFrame);renderer.frame({width:64,height:64},time);if(renderer.error())throw Error(renderer.error());const image=await createImageBitmap(canvas);ctx.drawImage(image,0,0);image.close();return [...ctx.getImageData(32,32,1,1).data];}
   try{
    const deadline=performance.now()+15000;while(renderer.phase()==='starting'){if(performance.now()>deadline)throw Error('GPU deadline');await new Promise(requestAnimationFrame);}
    renderer.setWorld({id:'entity-material',originRegion:257,warnings:[],groups:[]});renderer.setWorldCamera({originRegion:257,eye:[0,0,30],target:[0,0,0],fov:1,near:1,far:100});renderer.setCharacterModel('timed',model,[]);
    return [await sample(10),await sample(10.5,{clip:'run',time:0}),await sample(10.75,{gid:9,clip:'run',time:0})];
   }finally{renderer.dispose();canvas.remove();}
  });
  for(const [i,want] of [[0,[255,0,0]],[1,[128,128,0]],[2,[64,191,0]]])assert.ok(want.every((value,c)=>Math.abs(result[i][c]-value)<=1),JSON.stringify(result));
 }finally{await browser.close();}
});
