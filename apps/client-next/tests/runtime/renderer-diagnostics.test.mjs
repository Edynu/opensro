import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const built=await build({entryPoints:['src/engine/runtime/renderer/renderer.ts'],bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'device-observation',setup(b){b.onLoad({filter:/renderer[\\/]device[\\/]device\.ts$/},()=>({contents:'export const createDevice=(enabled)=>globalThis.__diagnosticDevice(enabled);',loader:'ts'}));}}]});
const {createRenderer}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].contents).toString('base64'));
test('diagnostic selection reaches initial and replacement device owners',t=>{
 const original=Object.getOwnPropertyDescriptor(globalThis,'__diagnosticDevice');
 t.after(()=>{if(original)Object.defineProperty(globalThis,'__diagnosticDevice',original);else delete globalThis.__diagnosticDevice;});
 for(const enabled of [false,true]){
  const devices=[];
  globalThis.__diagnosticDevice=flag=>{
   const row={flag,phase:'starting',disposed:false};devices.push(row);
   return {phase:()=>row.phase,recoverable:()=>true,error:()=>null,textureOptions(){},gpuTiming:()=>null,geometry:()=>null,images:()=>null,dispose(){row.disposed=true;}};
  };
  const renderer=createRenderer({},undefined,undefined,{gpuTiming:enabled});
  assert.equal(renderer.gpuTiming().enabled,enabled);
  for(let i=0;i<3;i++){devices[i].phase='failed';renderer.frame({width:1024,height:768});assert.equal(devices[i].disposed,true);assert.equal(devices.length,i+2);}
  assert.deepEqual(devices.map(d=>d.flag),[enabled,enabled,enabled,enabled]);renderer.dispose();assert.ok(devices.every(d=>d.disposed));
 }
});
