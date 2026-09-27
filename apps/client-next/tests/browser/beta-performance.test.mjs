import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {launchProbeBrowser} from '../../../../scripts/lib/probeBrowser.mjs';
import {serveBeta} from '../../tools/beta/serve.mjs';
// Browser-level frame scheduling and main-thread CPU only. This deliberately
// does not claim GPU execution timing or combat/region-streaming coverage.
test('paired beta versus same-source baseline title workload',{timeout:360000,skip:!process.env.SRO_BETA_PACKAGE||!process.env.SRO_BETA_BASELINE_PACKAGE},async()=>{
 const roots={baseline:process.env.SRO_BETA_BASELINE_PACKAGE,beta:process.env.SRO_BETA_PACKAGE};if(!roots.baseline||!roots.beta)throw Error('Set SRO_BETA_PACKAGE and SRO_BETA_BASELINE_PACKAGE');
 const directory='temp/artifacts/beta-performance';await mkdir(directory,{recursive:true});const services={},browsers={},pages={},sessions={},samples=[];
 try{
  // No authentication needed: deterministic animated title workload, same assets,
  // viewport and browser launcher. Only one page is foreground during each sample.
  for(const name of ['baseline','beta']){services[name]=await serveBeta({root:roots[name]});const b=await launchProbeBrowser({viewport:{width:1024,height:768}});browsers[name]=b.browser;pages[name]=b.page;sessions[name]=await b.page.context().newCDPSession(b.page);await sessions[name].send('Performance.enable');await b.page.goto(services[name].url);await b.page.locator('[data-ui-id="frontend:reveal"]').waitFor({timeout:60000});await sessions[name].send('Page.setWebLifecycleState',{state:'frozen'});}
  assert.equal(services.beta.manifest.sourceHash,services.baseline.manifest.sourceHash);
  for(let pair=0;pair<5;pair++)for(const name of pair%2?['beta','baseline']:['baseline','beta']){
   const page=pages[name],cdp=sessions[name];await cdp.send('Page.setWebLifecycleState',{state:'active'});await page.bringToFront();await page.waitForTimeout(1500);
   const before=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
   const frames=await page.evaluate(()=>new Promise(resolve=>{const deltas=[];let first,last;const tick=now=>{first??=now;if(last!==undefined)deltas.push(now-last);last=now;if(now-first>=10000)resolve(deltas);else requestAnimationFrame(tick);};requestAnimationFrame(tick);}));
   const after=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));frames.sort((a,b)=>a-b);await cdp.send('Page.setWebLifecycleState',{state:'frozen'});
   samples.push({pair,variant:name,frames:frames.length,medianMs:frames[Math.floor(frames.length*.5)],p95Ms:frames[Math.floor(frames.length*.95)],p99Ms:frames[Math.floor(frames.length*.99)],taskSeconds:after.TaskDuration-before.TaskDuration,scriptSeconds:after.ScriptDuration-before.ScriptDuration,heapBytes:after.JSHeapUsedSize});
   await writeFile(directory+'/result.json',JSON.stringify({sourceHash:services.beta.manifest.sourceHash,scope:'Animated title; rAF scheduling and main-thread CPU, not GPU time or full gameplay',samples},null,2));console.log('[beta-perf]',name,pair);
  }
  for(const name of ['baseline','beta']){await sessions[name].send('Page.setWebLifecycleState',{state:'active'});await pages[name].screenshot({path:directory+'/'+name+'.png'});await sessions[name].send('Page.setWebLifecycleState',{state:'frozen'});}
 }finally{for(const b of Object.values(browsers))await b.close();for(const s of Object.values(services))await s.close();}
});
