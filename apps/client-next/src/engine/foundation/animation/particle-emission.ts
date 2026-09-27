export interface ParticleEmitter {readonly start:number;readonly duration:number;readonly period:number;readonly limit:number;readonly rate:number;}
export interface ParticleEmission {readonly emitted:number;readonly total:number;readonly closed:boolean;}
// AEFEA0: age is the parent element's integer frame, not elapsed seconds.
// The float accumulator holds live occupancy plus fractional emission residue.
// AF2A40 subtracts one on retirement; the graph owns that transition.
export function particleEmission(emitter:ParticleEmitter,total:number,parentFrame:number,periodScale=1,density=0):ParticleEmission {
 if(![emitter.start,emitter.duration,emitter.period,emitter.limit,parentFrame,periodScale,density].every(Number.isSafeInteger)||emitter.start<0||emitter.duration<0||emitter.period<0||emitter.limit<0||!Number.isFinite(emitter.rate)||emitter.rate<0||!Number.isFinite(total)||total<0)throw new Error('Invalid particle emission state');
 const age=parentFrame-emitter.start;
 if(age>=emitter.duration)return {emitted:0,total,closed:true};
 let period=emitter.period;
 if(periodScale>1&&period*periodScale<emitter.duration)period*=periodScale;
 if(age<0||period<=0||age%period!==0)return {emitted:0,total,closed:false};
 let limit=emitter.limit;
 if(density>0&&density<emitter.rate&&limit>0)limit=Math.max(1,Math.trunc(limit*.5));
 const next=Math.fround(Math.min(limit,total+emitter.rate));
 return {emitted:Math.trunc(next)-Math.trunc(total),total:next,closed:false};
}
// Initial expansion without retirements, used for metadata and static fixtures.
// Runtime emission must also account for capacity returned by retired elements.
export function particleBirthFrames(emitter:ParticleEmitter,parentFrames:number,maxParticles=4096):readonly number[]{
 if(!Number.isSafeInteger(parentFrames)||parentFrames<0||parentFrames>1200||!Number.isSafeInteger(maxParticles)||maxParticles<0||maxParticles>4096)throw new Error('Particle schedule budget');
 let total=0;const births:number[]=[];
 for(let frame=0;frame<parentFrames;frame++){
  const next=particleEmission(emitter,total,frame);total=next.total;
  if(next.emitted<0)throw new Error('Particle emitter regressed');
  if(births.length+next.emitted>maxParticles)throw new Error('Particle population budget');
  for(let n=0;n<next.emitted;n++)births.push(frame);
  if(next.closed)break;
 }
 return births;
}
