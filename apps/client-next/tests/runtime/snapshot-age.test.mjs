import {test} from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';
async function load(path){const r=await build({entryPoints:['src/engine/'+path],bundle:true,platform:'node',format:'esm',write:false,define:{'import.meta.url':JSON.stringify('file:///fixture/host.ts')}});return import('data:text/javascript;base64,'+Buffer.from(r.outputFiles[0].contents).toString('base64'));}
const {createSimulationHost}=await load('runtime/simulation/host.ts'),{writeSnapshot}=await load('contracts/simulation.ts');
test('publication, actual receipt and delayed application remain separate across snapshot replacement',t=>{
 let now=0,worker;const sent=[];
 const old=Object.getOwnPropertyDescriptor(globalThis,'Worker');t.after(()=>{if(old)Object.defineProperty(globalThis,'Worker',old);else delete globalThis.Worker;});
 t.mock.method(performance,'now',()=>now);
 globalThis.Worker=class{constructor(){worker=this;}postMessage(message){sent.push(message);}terminate(){}};
 const host=createSimulationHost(),origin=performance.timeOrigin;
 const deliver=(sequence,published)=>{const buffer=new ArrayBuffer(32);writeSnapshot(buffer,sequence,sequence*16,published);worker.onmessage({data:{kind:'snapshot',buffer}});return buffer;};
 now=10;const first=deliver(1,origin+5);now=20;deliver(2,origin+15);
 assert.ok(sent.some(message=>message.kind==='recycle'&&message.buffer===first));
 now=35;const observation=host.poll();assert.equal(observation.publishedAtMs,origin+15);assert.equal(observation.receivedAtMs,origin+20);assert.equal(observation.appliedAtMs,origin+35);assert.equal(host.poll(),null);host.dispose();
});
