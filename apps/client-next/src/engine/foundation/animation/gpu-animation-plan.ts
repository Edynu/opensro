import type {CharacterModel,CharacterPrimitive} from '@/engine/contracts/character';

// GPU workgroup storage is two matrices for each of at most 128 bones (16 KiB).
// Larger rigs retain the full-rate CPU path. Static admission has its own cap;
// the device additionally limits the sum of resident GPU animation tables.
export const GPU_ANIMATION_NODES=128;
export const GPU_ANIMATION_MODEL_BYTES=8388608;
export function createGpuAnimationPlan(model:CharacterModel){
 const count=model.nodes.length;if(!count||count>GPU_ANIMATION_NODES)return null;
 let floats=count*31+model.clips.length*2;
 for(const clip of model.clips){floats+=count*12;for(const channel of clip.channels)floats+=channel.times.length+channel.values.length;}
 for(const primitive of model.primitives)floats+=primitive.joints.length*17;
 if(floats*4>GPU_ANIMATION_MODEL_BYTES)return null;
 // Reject unsafe GPU inputs to the existing CPU validator/evaluator.
 for(const node of model.nodes)if(!node.matrix&&Math.hypot(...node.rotation)<1e-12)return null;
 for(const clip of model.clips)for(const channel of clip.channels){
  if(channel.path==='rotation'&&channel.interpolation!=='CUBICSPLINE')for(let i=0;i<channel.values.length;i+=4)if(Math.hypot(channel.values[i]!,channel.values[i+1]!,channel.values[i+2]!,channel.values[i+3]!)<1e-12)return null;
 }
 const data=new Float32Array(floats);let cursor=0;
 const append=(values:ArrayLike<number>)=>{const at=cursor;data.set(values,at);cursor+=values.length;return at;};
 const depths=new Uint32Array(count),state=new Uint8Array(count);
 function visit(n:number):number{if(n<0)return -1;if(n>=count||state[n]===1)throw Error('Invalid GPU animation hierarchy');if(state[n]===2)return depths[n]!;state[n]=1;depths[n]=visit(model.nodes[n]!.parent)+1;state[n]=2;return depths[n]!;}
 for(let n=0;n<count;n++)visit(n);
 const depthAt=append(depths),parents=append(model.nodes.map(n=>n.parent)),rest=append(model.nodes.flatMap(n=>[...n.translation,0,...n.rotation,...n.scale,0]));
 const fixed=append(model.nodes.map(n=>n.matrix?1:0)),matrices=append(model.nodes.flatMap(n=>n.matrix?[...n.matrix]:Array(16).fill(0)));
 const clips=cursor;cursor+=model.clips.length*2;
 model.clips.forEach((clip,index)=>{
  data[clips+index*2]=clip.duration;data[clips+index*2+1]=cursor;
  const table=cursor;cursor+=count*12;
  for(const channel of clip.channels){const property=channel.path==='translation'?0:channel.path==='rotation'?1:2,at=table+(channel.node*3+property)*4;
   data[at]=channel.times.length;data[at+1]=append(channel.times);data[at+2]=append(channel.values);data[at+3]=channel.interpolation==='STEP'?1:channel.interpolation==='CUBICSPLINE'?2:0;
  }
 });
 const configurations=new Map<CharacterPrimitive,Uint32Array>();
 for(const primitive of model.primitives){const joints=append(primitive.joints),inverse=append(primitive.inverseBind);
  configurations.set(primitive,Uint32Array.of(count,Math.max(...depths)+1,primitive.joints.length,joints,parents,rest,fixed,matrices,depthAt,clips,inverse,0));
 }
 if(!data.every(Number.isFinite))return null;
 if(cursor!==data.length)throw Error('GPU animation plan accounting mismatch');
 return {data,configurations,clips:new Map(model.clips.map((clip,index)=>[clip,index]))};
}
