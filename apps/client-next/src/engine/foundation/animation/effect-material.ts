import type {EffectScript} from './effect-script';
export type MaterialScript=Extract<EffectScript,{kind:'material'}>;
export interface MaterialClock {readonly elapsed:number;readonly forward:boolean;}
// A917E0 samples BEFORE advancing. Endpoint overshoot is clamped, never
// wrapped; even a stalled frame changes direction at most once.
export function stepMaterial(script:MaterialScript,clock:MaterialClock,deltaMs:number){
 const f=Math.fround,t=script.durationMs?f(clock.elapsed/script.durationMs):0;
 const color=script.from.map((v,i)=>f(v+f(f(script.to[i]!-v)*t))) as [number,number,number];
 let elapsed=clock.elapsed,forward=clock.forward;
 const delta=Math.max(0,Math.trunc(deltaMs))>>>0;
 if(forward){elapsed=(elapsed+delta)>>>0;if(elapsed>script.durationMs){elapsed=script.durationMs;forward=false;}}
 else if(elapsed<=delta){elapsed=0;forward=true;}else elapsed-=delta;
 return {color,elapsed,forward};
}
// 8D98B0 / 856640: EFP size is captured at birth, independently of the
// later attachment matrix. CHAR_BASE includes characterInfo heightFactor.
export function stageEffectScale(mode:'CHAR_BASE'|'MOB_BASE'|null|undefined,scale:number,heightFactor:number|undefined){
 if(!mode)return 1;
 if(mode==='MOB_BASE')return Math.fround(scale);
 if(heightFactor===undefined)throw Error('Missing native character effect height factor');
 return Math.fround(Math.fround(heightFactor)*Math.fround(scale));
}
// 868DC0 / 85D890: activation is 10 ms, restoration is one second.
export function stepHwanScale(from:number,target:number,progress:number,deltaSeconds:number,active:boolean){
 const f=Math.fround,next=f(progress+(active?100:1)*f(deltaSeconds));
 return {progress:Math.min(1,next),value:next>=1?target:f(f(target-from)*next+from)};
}
