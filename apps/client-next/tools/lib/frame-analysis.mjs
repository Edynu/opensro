export function distribution(values){
 if(!values.length)return null;
 if(values.some(value=>!Number.isFinite(value)||value<0))throw Error('Invalid timing sample');
 const sorted=[...values].sort((a,b)=>a-b),q=f=>sorted[Math.min(sorted.length-1,Math.floor(sorted.length*f))];
 return {count:values.length,mean:values.reduce((a,b)=>a+b,0)/values.length,p50:q(.5),p95:q(.95),p99:q(.99),max:sorted.at(-1)};
}
export function analyzeFrames(capture,window){
 const budgetMs=1000/240,columns=capture.columns,index=name=>{const i=columns.indexOf(name);if(i<0)throw Error('Missing timing column '+name);return i;};
 const id=index('frameId'),cpu=index('cpuMs'),runtime=['input-state-frontend','character-presentation','world-stream','ui','render-preparation-submit','hover','audio'];
 const renderer=['renderer-setup','world-prepare','character-prepare','labels-portraits','submit'];
 const inner=['actor-motion','actor-sounds','actor-record','presentation-selection','presentation-events','presentation-state','presentation-actors','presentation-finalize','world-instance-setup','world-instance-loop','world-instance-upload','world-camera','world-environment','world-selection','world-finalize','character-plan','character-poses','character-upload','terrain-candidates','terrain-indices','terrain-seams','terrain-index-upload','terrain-position-upload','ui-assembly','ui-finalize','ui-compare','ui-publish'].filter(name=>columns.includes(name));
 const rows=capture.rows;if(!rows.length)throw Error('No CPU frames recorded; instrumentation or workload did not run');
 if(rows.some(row=>row.length!==columns.length||row.some(value=>!Number.isFinite(value)||value<0)))throw Error('Invalid CPU frame record');
 if(new Set(rows.map(row=>row[id])).size!==rows.length)throw Error('Duplicate CPU frame identity');
 if(rows.some((row,i)=>i&&row[index('startMs')]<rows[i-1][index('startMs')]))throw Error('Nonmonotonic CPU frame clock');
 const slow=rows.filter(row=>row[cpu]>budgetMs),stages={};
 for(const name of [...runtime,...renderer,...inner]){const at=index(name);const sampled=(name.startsWith('world-instance-')||name.startsWith('actor-'))?rows.filter(row=>row[index('world-detail-sampled')]===1):rows;stages[name]={all:distribution(sampled.map(row=>row[at])),overBudget:distribution(sampled.filter(row=>row[cpu]>budgetMs).map(row=>row[at])),nested:!runtime.includes(name),...((name.startsWith('world-instance-')||name.startsWith('actor-'))?{sampling:'one frame in 32; sampled-frame values only, includes timing overhead'}:{})};}
 const gpu=new Map();for(const publication of [...(window.telemetry??[]).map(row=>row.sample.gpu),window.gpu])for(const sample of publication?.samples??[])if(sample.frameId!==undefined)gpu.set(sample.frameId,sample);
 const matched=rows.filter(row=>gpu.has(row[id])),gpuTotals=matched.map(row=>gpu.get(row[id]).passes.reduce((sum,pass)=>sum+pass.ms,0));
 const outer=runtime.map(index),unclassified=rows.map(row=>Math.max(0,row[cpu]-outer.reduce((sum,i)=>sum+row[i],0)));
 const ranking=runtime.map(name=>({name,meanMs:stages[name].overBudget?.mean??0})).sort((a,b)=>b.meanMs-a.meanMs);
 const durationMs=window.intervals?.reduce((sum,value)=>sum+value,0)??0;
 const moving=window.motion?.samples,issues=[];
 if(capture.dropped)issues.push('Recorder capacity exceeded; timing population is incomplete');
 if(durationMs<10000)issues.push('Less than ten seconds measured; insufficient sustained-performance evidence');
 if(matched.length<rows.length*.95)issues.push('GPU coverage below 95%; GPU headroom is unverified');
 if(moving?.length&&moving.filter(row=>row.moving).length<moving.length*.9)issues.push('Movement active in less than 90% of observations');
 const gaps=rows.slice(1).map((row,i)=>Math.max(0,row[index('startMs')]-rows[i][index('startMs')]-rows[i][cpu]));
 const seconds=[],start=index('startMs'),firstStart=rows[0][start];
 for(const row of rows){const second=Math.floor((row[start]-firstStart)/1000);(seconds[second]??=[]).push(row);}
 return {
  targetFps:240,budgetMs,frameCount:rows.length,dropped:capture.dropped,cpu:distribution(rows.map(row=>row[cpu])),
  callbackBudgetExceeded:slow.length,callbackBudgetExceededPercent:rows.length?100*slow.length/rows.length:null,
  stages,slowFrameRanking:ranking,callbackRemainder:distribution(unclassified),
  counts:Object.fromEntries(['pose-created','pose-retired','pose-evaluations'].filter(name=>columns.includes(name)).map(name=>{const values=rows.map(row=>row[index(name)]);return [name,{total:values.reduce((a,b)=>a+b,0),perFrame:distribution(values)}];})),
  gpu:{matchedFrames:matched.length,coverage:rows.length?matched.length/rows.length:0,passSumMs:distribution(gpuTotals),qualification:'Sum of timed passes; gaps between passes and untimed work are excluded.'},
  browserRaf:distribution(window.intervals??[]),betweenCallbacksMs:distribution(gaps),evidenceIssues:issues,
  seconds:seconds.map((samples,second)=>({second,frames:samples.length,cpu:distribution(samples.map(row=>row[cpu])),stages:Object.fromEntries([...runtime,...renderer,...inner].map(name=>[name,distribution(samples.map(row=>row[index(name)]))]))})),
  drawWork: capture.drawSamples?.length?{
   samples:capture.drawSamples.length,
   mainTriangles:distribution(capture.drawSamples.map(s=>s.main.triangles)),
   mainDraws:distribution(capture.drawSamples.map(s=>s.main.draws)),
   portraitTriangles:distribution(capture.drawSamples.map(s=>s.portraits.triangles)),
   uiQuads:distribution(capture.drawSamples.map(s=>s.uiQuads)),
   duplicateReferences:capture.drawSamples.reduce((n,s)=>n+s.main.duplicateReferences+s.preview.duplicateReferences+s.portraits.duplicateReferences,0),
   zeroDraws:capture.drawSamples.reduce((n,s)=>n+s.main.zeroDraws+s.preview.zeroDraws+s.portraits.zeroDraws,0),
   qualification:'500 ms submission census, not a per-frame census or pixel-overdraw measurement. A repeated reference is not automatically an erroneous draw.'
  }:null,
  counters:window.state?.characters,layoutRetention:window.state?.ui?.layoutRetention,
  worstFrames:[...rows].sort((a,b)=>b[cpu]-a[cpu]).slice(0,10).map(row=>({frameId:row[id],cpuMs:row[cpu],stages:Object.fromEntries([...runtime,...renderer,...inner].map(name=>[name,row[index(name)]])),gpu:gpu.get(row[id])??null})),
  qualification:'Instrumented diagnostic workload. Renderer stages are children of render-preparation-submit and must not be added to it. RAF cadence is not optical presentation. No 240 FPS acceptance follows from averages.'
 };
}
