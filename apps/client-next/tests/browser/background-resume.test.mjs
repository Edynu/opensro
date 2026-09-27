import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchProbeBrowser} from '../../../../scripts/lib/probeBrowser.mjs';
import {CLIENT_NEXT_BASE_URL} from '../../../../scripts/lib/probeEndpoints.mjs';
import {holdProbeRuntime} from './helpers/hold-runtime.mjs';

test('worker resumes after an hour without a historical tick replay storm',{timeout:30000},async()=>{
 const {browser,page}=await launchProbeBrowser();try{
  await holdProbeRuntime(page);await page.goto(CLIENT_NEXT_BASE_URL);
  const observed=await page.evaluate(async()=>{
   const source=`import {createClock} from ${JSON.stringify(location.origin+'/src/engine/runtime/simulation/worker/clock/clock.ts')};
    let now=0,job,delay,steps=0,elapsed=0;performance.now=()=>now;
    self.setTimeout=(fn,ms)=>{job=fn;delay=ms;return 1};self.clearTimeout=()=>{};
    const clock=createClock(skipped=>{steps++;elapsed+=16+(skipped??0)},error=>{throw error});clock.start();
    now=3600000;const begin=Date.now();let wakes=0;do{job();wakes++}while(delay===0&&wakes<64);
    const result={steps,elapsed,wakes,delay,sample:clock.sample(),wallMs:Date.now()-begin};clock.dispose();postMessage(result);`;
   const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'})),worker=new Worker(url,{type:'module'});
   try{return await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('worker probe deadline')),10000);worker.onmessage=e=>{clearTimeout(timer);resolve(e.data)};worker.onerror=e=>{clearTimeout(timer);reject(Error(e.message))}})}finally{worker.terminate();URL.revokeObjectURL(url)};
  });
  await mkdir('temp/artifacts/background-resume',{recursive:true});await writeFile('temp/artifacts/background-resume/worker.json',JSON.stringify(observed,null,2));
  assert.ok(observed.delay>0,JSON.stringify(observed));assert.ok(observed.steps<=4);assert.equal(observed.elapsed,3600000);assert.equal(observed.sample.debtMs,0);
 }finally{await browser.close();}
});
