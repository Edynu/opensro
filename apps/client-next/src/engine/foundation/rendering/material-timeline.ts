import {createModifierDelta} from './modifier-delta';
export interface MaterialTimeline {readonly duration:number;readonly mode:0|1|2;readonly flags:number;readonly colors:readonly {readonly time:number;readonly value:readonly number[]}[];}
export function validateMaterialTimeline(t:MaterialTimeline){
 if(!Number.isSafeInteger(t.duration)||t.duration<0||![0,1,2].includes(t.mode)||!Number.isInteger(t.flags)||!t.colors.length||t.colors.length>65536||t.colors.some((k,i)=>!Number.isSafeInteger(k.time)||k.time<0||(i>0&&k.time<t.colors[i-1]!.time)||k.value.length!==4||!k.value.every(Number.isFinite)))throw Error('Invalid material timeline');
}
// AECBA0/BD0/CC20 clock, AECE90 float32 interpolation. Mode 1 clamps
// at each reversal; mode 2 clamps only on the update after overshooting.
export function createMaterialTimeline(source:MaterialTimeline){
 validateMaterialTimeline(source);const t=structuredClone(source),rgb=new Float32Array(3);const deltaFor=createModifierDelta();let time=0,direction=1;
 const stepDelta=(delta:number)=>{
  if(t.mode===0){time+=delta;if(t.duration>0)time%=t.duration;}
  else if(t.mode===1){time+=direction*delta;if(time>=t.duration){time=t.duration;direction=-1;}else if(time<=0){time=0;direction=1;}}
  else time=time>=t.duration?t.duration:time+delta;
  let lower=t.colors[0]!,upper=lower;for(const k of t.colors){upper=k;if(time<k.time)break;lower=k;}
  const f=upper.time===lower.time?0:Math.fround((time-lower.time)/(upper.time-lower.time));let changed=false;
  for(let i=0;i<3;i++){const value=Math.fround(upper.value[i]!*f+lower.value[i]!*(1-f));changed ||= rgb[i]!==value;rgb[i]=value;}
  return changed;
 };
 return {rgb,stepDelta,step:(seconds:number)=>stepDelta(deltaFor(seconds))};
}
