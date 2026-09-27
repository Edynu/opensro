// Diagnostic-only sampling. Never enabled in acceptance or shipping builds.
// Select evaluations pseudo-randomly so actor order cannot alias a fixed stride.
export function createAnimationPhaseProfiler(now=()=>performance.now()){
 let seed=240,eligible=0,sampled=0,reads=0,active=false;
 const sums={},counts={},starts={},models=new WeakMap(),rows=new Map();let current=null;
 const describe=model=>{let row=models.get(model);if(!row){row={id:model.primitives?.[0]?.name??"unknown",nodes:model.nodes.length,primitives:model.primitives.length};models.set(model,row);}return row;};
 const record=(model,reason,count=1)=>{if(!active||!model)return null;const meta=describe(model),key=meta.id+"|"+reason;if(!rows.has(key)&&rows.size>=512)return null;let row=rows.get(key);if(!row){row={...meta,reason,calls:0,sampled:0,ms:0};rows.set(key,row);}row.calls+=count;return row;};
 const timer={phases:false,start(name){starts[name]=now();reads++;},end(name){const elapsed=now()-starts[name];reads++;sums[name]=(sums[name]??0)+elapsed;counts[name]=(counts[name]??0)+1;if(name==="materialization"&&current){current.ms+=elapsed;current.sampled++;}}};
 return {
  tag(model,id,plan){const meta=describe(model);meta.id=id;meta.sharedPalette=plan.sharedPalette;},
  admission:record,
  start(){rows.clear();current=null;active=true;eligible=sampled=reads=0;seed=240;for(const name of Object.keys(sums))delete sums[name];for(const name of Object.keys(counts))delete counts[name];},
  pause(){active=false;},
  begin(model,reason="evaluate",resolved){if(!active)return null;current=model?record(model,reason+":"+(resolved?.length>1?"layered":resolved?.[0]?.clip?.name??"rest")):null;eligible++;seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;if((seed>>>0)%64)return null;sampled++;timer.phases=!!(seed&256);return timer;},
  stats(){return {eligible,sampled,clockReads:reads,materializations:[...rows.values()],sums:{...sums},counts:{...counts},qualification:'Separate randomized samples measure total CPU materialization or inner phases, never both on the same call. Includes deferred fallback, sockets and portraits. Sampling includes quaternion time; do not add them. Timer overhead and interruptions are included. Not an acceptance or exact per-frame estimate.'};}
 };
}

export function instrumentAnimationPhases(source){
 source=source.replace(/\r\n/g,'\n');
 const replace=(marker,value)=>{if(source.split(marker).length!==2)throw Error('Animation phase boundary changed: '+marker);source=source.replace(marker,value);};
 if(source.includes('function materialize()')){
  replace('function materialize(){','function materialize(reason="evaluate"){');
  replace('if(!cpuPending)return;', 'if(!cpuPending)return;const __ap=globalThis.__worldProbeAnimationPhases?.begin(model,reason,resolved);if(__ap&&!__ap.phases)__ap.start("materialization");');
  replace('cpuPending=false;cpuEvaluations++;','cpuPending=false;cpuEvaluations++;if(__ap&&!__ap.phases)__ap.end("materialization");');
  replace('            materialize();','            materialize("palette");');
  replace('socket(name: string) { materialize();','socket(name: string) { materialize("socket:"+name);');
 }
 else replace('pendingLayers.length=count;', 'const __ap=globalThis.__worldProbeAnimationPhases?.begin();pendingLayers.length=count;');
 replace('clocks.sample(time);','if(__ap)__ap.start("timelines");clocks.sample(time);if(__ap)__ap.end("timelines");');
 replace('for(let channelIndex=0;', 'if(__ap)__ap.start("sampling");for(let channelIndex=0;');
 replace('weights[index]=total;\n                    }','weights[index]=total;\n                    }if(__ap)__ap.end("sampling");');
 replace('const at=channelIndex*4;', 'if(__ap)__ap.start("quaternion");const at=channelIndex*4;');
 replace('target[i]=values[low*4+i]!*left+values[next*4+i]!*right*sign;', 'target[i]=values[low*4+i]!*left+values[next*4+i]!*right*sign;if(__ap)__ap.end("quaternion");');
 replace('compose(translations[n]!, rotations[n]!, scales[n]!, locals[n]!);','{if(__ap)__ap.start("composition");compose(translations[n]!, rotations[n]!, scales[n]!, locals[n]!);if(__ap)__ap.end("composition");}');
 replace('multiply(globals[node.parent]!, locals[n]!, globals[n]!);','{if(__ap)__ap.start("propagation");multiply(globals[node.parent]!, locals[n]!, globals[n]!);if(__ap)__ap.end("propagation");}');
 return source.replaceAll("if(__ap)","if(__ap&&__ap.phases)");
}

export function instrumentAnimationAdmission(source,file){
 const replace=(marker,value)=>{if(source.split(marker).length!==2)throw Error('Animation admission boundary changed: '+marker);source=source.replace(marker,value);};
 if(file==='src/engine/runtime/renderer/characters/characters.ts')replace('const resource=models.get(actor.model),model=resource?.model;if(!model)return null;', 'const resource=models.get(actor.model),model=resource?.model;if(!model)return null;globalThis.__worldProbeAnimationPhases?.tag(model,actor.model,resource.plan);');
 if(file==='src/engine/runtime/renderer/device/geometry.ts')replace('current();const palette=sharedPalettes.get(source);if(!palette)return false;',"current();const palette=sharedPalettes.get(source);if(!palette){globalThis.__worldProbeAnimationPhases?.admission(model,'gpu:palette-not-uploaded',samples.length);return false;}");
 if(file==='src/engine/runtime/renderer/device/animation.ts'){
  replace("if(!pipeline||unsupported.has(model)||!samples.some(s=>s!==null)||!primitive.joints.length)return false;", "if(!pipeline||unsupported.has(model)||!samples.some(s=>s!==null)||!primitive.joints.length){globalThis.__worldProbeAnimationPhases?.admission(model,!pipeline?'gpu:cold':model.nodes.length>128?'gpu:rig-limit':'gpu:previous-refusal',samples.length);return false;}");
  replace('if(!plan||staticBytes+plan.data.byteLength>STATIC_BYTES){unsupported.add(model);return false;}', "if(!plan||staticBytes+plan.data.byteLength>STATIC_BYTES){globalThis.__worldProbeAnimationPhases?.admission(model,model.nodes.length>128?'gpu:rig-limit':!plan?'gpu:plan-refused':'gpu:static-budget',samples.length);unsupported.add(model);return false;}");
  replace('pending.add(row);return true;', "pending.add(row);globalThis.__worldProbeAnimationPhases?.admission(model,'gpu:accepted',samples.filter(s=>s!==null).length);return true;");
 }
 return source;
}
