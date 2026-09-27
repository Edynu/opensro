import {test} from 'node:test';
import assert from 'node:assert/strict';
import {launchProbeBrowser} from '../../../../scripts/lib/probeBrowser.mjs';
import {CLIENT_NEXT_BASE_URL} from '../../../../scripts/lib/probeEndpoints.mjs';
test('follow collision puts an obstructing wall behind the camera on the GPU',{timeout:45000},async()=>{
 const {browser,page}=await launchProbeBrowser();
 try{
  await page.goto(CLIENT_NEXT_BASE_URL);
  const result=await page.evaluate(async()=>{
   const {createRenderer}=await import('/src/engine/runtime/renderer/renderer.ts');
   const canvas=document.createElement('canvas');document.body.append(canvas);const renderer=createRenderer(canvas);
   const identity=()=>new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
   const quad=(id,z,color)=>({id,center:[0,15,z],radius:150,material:{color,alphaCutoff:0,blend:false,doubleSided:true,unlit:true},geometry:{positions:new Float32Array([-100,-100,z,100,-100,z,100,100,z,-100,100,z]),normals:new Float32Array(12),uvs:new Float32Array(8),indices:new Uint32Array([0,1,2,0,2,3]),instances:identity(),transform:identity()}});
   const output=document.createElement('canvas');output.width=output.height=64;const ctx=output.getContext('2d');
   try{
    const deadline=performance.now()+15000;while(renderer.phase()==='starting'&&performance.now()<deadline)await new Promise(requestAnimationFrame);
    renderer.setWorld({id:'camera-wall',originRegion:0,warnings:[],groups:[quad('wall',30,[1,0,0,1]),quad('target',0,[0,1,0,1])]});
    async function sample(camera){renderer.setWorldCamera(camera);for(let i=0;i<3;i++){renderer.frame({width:64,height:64},i/60);await new Promise(requestAnimationFrame);}
     renderer.frame({width:64,height:64},.1);const image=await createImageBitmap(canvas);ctx.drawImage(image,0,0);image.close();return [...ctx.getImageData(32,32,1,1).data];}
    const base={eye:[0,15,80],target:[0,15,0],fov:1,near:1,far:3500};
    const blocked=await sample(base),corrected=await sample({...base,target:[0,0,0],follow:{yaw:0,pitch:0,distance:80}});
    const decoration=quad('decoration',30,[1,0,0,1]);decoration.collision=[];
    renderer.setWorld({id:'camera-decoration',originRegion:0,warnings:[],groups:[decoration,quad('target',0,[0,1,0,1])]});
    const decorative=await sample({...base,target:[0,0,0],follow:{yaw:0,pitch:0,distance:80}});
    return {blocked,corrected,decorative,error:renderer.error()};
   }finally{renderer.dispose();canvas.remove();}
  });
  assert.equal(result.error,null);assert.deepEqual(result.blocked,[255,0,0,255]);assert.deepEqual(result.corrected,[0,255,0,255]);assert.deepEqual(result.decorative,[255,0,0,255],'non-colliding decoration remains drawn without shortening the camera');
 }finally{await browser.close();}
});
