import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {launchProbeBrowser} from '../../../../scripts/lib/probeBrowser.mjs';
import {CLIENT_NEXT_BASE_URL} from '../../../../scripts/lib/probeEndpoints.mjs';
for(const sweep of [false,true])test(`live WebGPU filtered alpha versus D3D9 fixed-function reference (${sweep?'sweep':'edge'})`,{timeout:120000},async()=>{
 const stem=sweep?'native-alpha-sweep':'native-alpha';
 const receipt=JSON.parse((await readFile(`temp/artifacts/${stem}-reference.json`,'utf8')).replace(/^\uFEFF/,''));
 const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
 for(const file of ['tools/native-alpha-reference.cpp','temp/artifacts/native-alpha-reference.exe',`temp/artifacts/${stem}.bgra`])assert.equal(sha(await readFile(file)),receipt.sha256[file],`Stale native alpha reference: ${file}; rerun tools/build-native-alpha-reference.ps1`);
 const native=await readFile(`temp/artifacts/${stem}.bgra`);assert.equal(native.length,receipt.width*receipt.height*4);
 const {browser,page}=await launchProbeBrowser();try{await page.goto(CLIENT_NEXT_BASE_URL);const result=await page.evaluate(async({sweep,width,height})=>{
  const {createDevice}=await import('/src/engine/runtime/renderer/device/device.ts');const canvas=document.createElement('canvas');document.body.append(canvas);const renderer=createDevice();
  const I=()=>Float32Array.of(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1);
  const quad=(left,right,top,bottom,z,color)=>({positions:Float32Array.of(left,top,z,right,top,z,left,bottom,z,right,bottom,z),indices:Uint32Array.of(0,1,2,2,1,3),normals:Float32Array.of(0,0,-1,0,0,-1,0,0,-1,0,0,-1),uvs:Float32Array.of(0,.5,1,.5,0,.5,1,.5),transform:I(),material:{color,alphaCutoff:128/255,blend:false,doubleSided:true,unlit:true}});
  try{for(let n=0;n<120&&renderer.phase()==='starting';n++)await new Promise(requestAnimationFrame);if(renderer.phase()!=='running')throw new Error(renderer.error()??'Device startup timeout');
   canvas.width=width;canvas.height=height;const context=canvas.getContext('webgpu');renderer.surfaceCommands().configure(context,renderer.format());const depth=renderer.surfaceCommands().createDepth(width,height);renderer.worldView(I(),new Float32Array(80));
   const sourceImage=await createImageBitmap(new ImageData(Uint8ClampedArray.of(255,0,0,0,255,0,0,255),2,1),{premultiplyAlpha:'none'});
   const texture=renderer.images().upload(sourceImage);sourceImage.close();
   const draws=[];for(let row=0;row<height;row++){const a=sweep?row%256:[255,254,128,127,64,1][row%6];const g=quad(-1,1,1-row*2/height,1-(row+1)*2/height,0,[1,1,1,1]);g.material.alphaCutoff=(sweep?[1,64,128,192,254,255][Math.floor(row/512)]:128)/255;g.material.fadeAlphaOnly=sweep?Math.floor(row/256)%2!==0:row>=6;g.material.instanceFade=a!==255;g.material.blend=a!==255;
    const draw=renderer.geometry().upload(g,texture);draws.push(renderer.geometry().updateInstances(draw,I(),Float32Array.of(a/255)));
   }const encoder=renderer.commands().createEncoder();const pass=encoder.beginRenderPass({colorAttachments:[{view:context.getCurrentTexture().createView(),loadOp:'clear',storeOp:'store',clearValue:[0,0,1,1]}],depthStencilAttachment:{view:depth.view,depthLoadOp:'clear',depthStoreOp:'store',depthClearValue:1}});
   for(const draw of draws){pass.setPipeline(draw.pipeline);pass.setBindGroup(0,draw.binding);pass.setVertexBuffer(0,draw.vertices);pass.setIndexBuffer(draw.indices,'uint32');pass.drawIndexed(draw.indexCount,draw.instanceCount,0,0,0);}pass.end();renderer.commands().submit(encoder.finish());
   const out=document.createElement('canvas');out.width=width;out.height=height;const ctx=out.getContext('2d');const image=await createImageBitmap(canvas);ctx.drawImage(image,0,0);image.close();return {pixels:[...ctx.getImageData(0,0,width,height).data],png:out.toDataURL(),error:renderer.error()};
  }finally{renderer.dispose();canvas.remove();}
 },{sweep,width:receipt.width,height:receipt.height});const rows=[];for(let y=0;y<receipt.height;y++){let differences=0,maxError=0,coverageDifferences=0;for(let x=0;x<512;x++){const p=(y*512+x)*4;for(let c=0;c<3;c++){const d=Math.abs(native[p+2-c]-result.pixels[p+c]);differences+=Number(d!==0);maxError=Math.max(maxError,d);}coverageDifferences+=Number((native[p+2]>0)!==(result.pixels[p]>0));}rows.push({row:y,differences,maxError,coverageDifferences});}
 const dir=`temp/artifacts/bugs/native-filtered-alpha${sweep?'-sweep':''}`;await mkdir(dir,{recursive:true});await writeFile(dir+'/webgpu.rgba',Buffer.from(result.pixels));await writeFile(dir+'/webgpu.png',Buffer.from(result.png.split(',')[1],'base64'));await writeFile(dir+'/result.json',JSON.stringify({native:receipt,browser:browser.version(),shaderSha256:sha(await readFile('src/engine/runtime/renderer/device/pipelines.ts')),rows,error:result.error,acceptance:'Zero RGB and coverage differences; canvas alpha excluded because the browser surface is opaque.'},null,2));console.log(JSON.stringify({sweep,pixels:receipt.width*receipt.height,failingRows:rows.filter(row=>row.differences)}));assert.equal(result.error,null);assert.equal(rows.reduce((n,r)=>n+r.coverageDifferences,0),0);assert.equal(rows.reduce((n,r)=>n+r.differences,0),0);
 }finally{await browser.close();}
});
