import {readFileSync} from 'node:fs';
import path from 'node:path';
import {profileSourceMap} from './lib/profile-source-map.mjs';
const countsOnly=process.argv.includes('--counts-only');
const profile=JSON.parse(readFileSync(process.argv[2],'utf8'));
if(!profile.samples?.length||profile.samples.length!==profile.timeDeltas?.length||profile.timeDeltas.some(value=>!Number.isFinite(value)||!countsOnly&&value<0))throw Error('Incomplete or non-monotonic CPU samples; cannot safely attribute durations');
const sourceMaps=process.argv.find(value=>value.startsWith('--source-maps='))?.slice('--source-maps='.length),maps=new Map();
if(countsOnly)console.log(JSON.stringify({mode:'sample-counts-only',negativeDeltas:profile.timeDeltas.filter(v=>v<0).length,qualification:'Unweighted sample frequency; no duration or scheduling inference.'}));
let eligible=0,mapped=0;
if(sourceMaps)for(const node of profile.nodes){
 const frame=node.callFrame;if(!frame.url||frame.lineNumber<0)continue;
 eligible++;
 const name=path.basename(new URL(frame.url).pathname);
 if(!maps.has(name)){try{maps.set(name,profileSourceMap(JSON.parse(readFileSync(path.join(sourceMaps,name+'.map'),'utf8'))));}catch(error){if(error.code!=='ENOENT')throw error;maps.set(name,null);}}
 const location=maps.get(name)?.(frame.lineNumber,frame.columnNumber);
 if(location){mapped++;node.callFrame={...frame,url:location.source,lineNumber:location.line,columnNumber:location.column,functionName:location.name??frame.functionName};}
}
if(sourceMaps){if(eligible&&!mapped)throw Error('No source locations mapped; verify the frozen build source-map directory');console.log(JSON.stringify({sourceLocations:eligible,mapped,unmapped:eligible-mapped}));}
const nodes=new Map(profile.nodes.map(node=>[node.id,node])),parents=new Map(profile.nodes.flatMap(node=>(node.children??[]).map(id=>[id,node.id]))),self=new Map(),total=new Map();
const runs=new Map(),longest=new Map();
for(let i=0;i<profile.samples.length;i++){
 let id=profile.samples[i],time=countsOnly?1:profile.timeDeltas[i];self.set(id,(self.get(id)??0)+time);
 const active=new Set();
 while(nodes.has(id)){active.add(id);total.set(id,(total.get(id)??0)+time);id=parents.get(id);}
 for(const id of runs.keys())if(!active.has(id))runs.delete(id);
 for(const id of active){const run=(runs.get(id)??0)+time;runs.set(id,run);longest.set(id,Math.max(longest.get(id)??0,run));}
}
// Sampling can merge consecutive invocations. This identifies candidate stalls,
// not exact function durations; confirm them against frame/trace timestamps.
for(const [label,rows] of [['self',self],['inclusive',total],[countsOnly?'longest contiguous sample run (not duration)':'longest contiguous sampled span (not exact call duration)',longest]]){
 console.log(label);for(const [id,time] of [...rows].sort((a,b)=>b[1]-a[1]).slice(0,20)){
  const frame=nodes.get(id).callFrame;console.log(`${countsOnly?time+' samples':(time/1000).toFixed(1)+' ms'} ${frame.functionName} ${frame.url.replace(/^https?:\/\/[^/]+/,'').replace(/\?.*$/,'')}:${frame.lineNumber+1}`);
 }
}
