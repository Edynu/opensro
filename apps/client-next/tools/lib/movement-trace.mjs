// Correlate one bounded numeric frame recording with the Chrome trace of the
// same movement window. User Timing carries both clocks; never guess an offset.
export function analyzeMovementTrace(events,capture,window){
 const marker=suffix=>events.filter(e=>e.name===`world-profile:${window.name}:${suffix}`&&Number.isFinite(e.args?.data?.startTime));
 const starts=marker('start'),ends=marker('end');
 if(starts.length!==1||ends.length!==1)throw Error('Expected one correlated start/end marker');
 const a=starts[0],b=ends[0],clockStart=a.args.data.startTime,clockEnd=b.args.data.startTime;
 if(a.pid!==b.pid||a.tid!==b.tid||!(b.ts>a.ts&&clockEnd>clockStart))throw Error('Invalid movement trace clocks');
 const scale=(b.ts-a.ts)/(clockEnd-clockStart),toTrace=ms=>a.ts+(ms-clockStart)*scale;
 if(Math.abs(scale-1000)>1)throw Error('Movement trace clock drift exceeds 0.1%');
 const columns=capture.columns,at=name=>{const i=columns.indexOf(name);if(i<0)throw Error('Missing frame column '+name);return i;};
 const id=at('frameId'),start=at('startMs'),cpu=at('cpuMs'),rows=capture.rows;
 if(capture.dropped||!rows.length||rows.some((r,i)=>r.length!==columns.length||r.some(v=>!Number.isFinite(v)||v<0)||i&&r[start]<rows[i-1][start]))throw Error('Incomplete or invalid numeric frame recording');
 if(rows[0][start]<clockStart-1||rows.at(-1)[start]>clockEnd+1)throw Error('Frame recording lies outside trace window');
 const main=events.filter(e=>e.pid===a.pid&&e.tid===a.tid&&e.ph==='X'&&Number.isFinite(e.dur)&&e.dur>=0&&e.ts<b.ts&&e.ts+e.dur>a.ts);
 const overlap=(e,lo,hi)=>Math.max(0,Math.min(hi,e.ts+e.dur)-Math.max(lo,e.ts));
 // Only top-level GC events. Adding V8.GC_* children would count time twice.
 const gc=main.filter(e=>e.name==='MinorGC'||e.name==='MajorGC');
 const callbacks=main.filter(e=>e.name==='FireAnimationFrame');
 const samples=window.motion?.samples??[],budget=1000/240;
 const withGc=rows.map(row=>{const lo=toTrace(row[start]),hi=toTrace(row[start]+row[cpu]);return {row,lo,hi,gcMs:gc.reduce((n,e)=>n+overlap(e,lo,hi),0)/1000};});
 // These outer marks are sequential. Inner renderer stages are nested and
 // cannot be placed by summing their durations. Do not infer their GC overlap.
 const outer=['input-state-frontend','character-presentation','world-stream','ui','render-preparation-submit','hover','audio'];
 const runtimeStageGc=outer.every(name=>columns.includes(name))?Object.fromEntries(outer.map(name=>[name,{frames:0,totalMs:0,gcOverlapMs:0,withoutGcFrames:0,withoutGcMs:0,maxWithoutGcMs:0,over1MsWithoutGc:0}])):null;
 if(runtimeStageGc)for(const row of rows){let offset=0;for(const name of outer){
  const ms=row[at(name)],lo=toTrace(row[start]+offset),hi=toTrace(row[start]+offset+ms),gcMs=gc.reduce((n,e)=>n+overlap(e,lo,hi),0)/1000;
  const result=runtimeStageGc[name];result.frames++;result.totalMs+=ms;result.gcOverlapMs+=gcMs;
  if(gcMs===0){result.withoutGcFrames++;result.withoutGcMs+=ms;result.maxWithoutGcMs=Math.max(result.maxWithoutGcMs,ms);if(ms>1)result.over1MsWithoutGc++;}
  offset+=ms;
 }}
 return {
  window:window.name,pid:a.pid,tid:a.tid,frameCount:rows.length,clockScale:scale,
  gc:gc.map(e=>({kind:e.name,atMs:(e.ts-a.ts)/1000,ms:overlap(e,a.ts,b.ts)/1000})),
  runtimeStageGc,
  overBudgetFrames:withGc.filter(r=>r.row[cpu]>budget).length,
  overBudgetFramesWithGc:withGc.filter(r=>r.row[cpu]>budget&&r.gcMs>0).length,
  worstFrames:withGc.sort((a,b)=>b.row[cpu]-a.row[cpu]).slice(0,12).map(({row,lo,hi,gcMs})=>{
   const callback=callbacks.reduce((best,e)=>!best||overlap(e,lo,hi)>overlap(best,lo,hi)?e:best,null);
   const motion=samples.reduce((best,s)=>!best||Math.abs(s.at-row[start])<Math.abs(best.at-row[start])?s:best,null);
   return {frameId:row[id],elapsedMs:row[start]-clockStart,cpuMs:row[cpu],gcMs,
    callback:callback&&overlap(callback,lo,hi)>0?{wallMs:callback.dur/1000,threadCpuMs:Number.isFinite(callback.tdur)?callback.tdur/1000:null}:null,
    stages:Object.fromEntries(columns.slice(3).map((name,i)=>[name,row[i+3]])),
    nearestMotion:motion?{deltaMs:motion.at-row[start],pose:motion.pose}:null};
  }),
  qualification:'Instrumented trace, not clean FPS acceptance. GC overlap is not proof of allocation origin. Stage durations are nested. Motion samples are nearby observations, not exact camera positions. Browser clocks are quantized; tiny overlaps are approximate.'
 };
}
