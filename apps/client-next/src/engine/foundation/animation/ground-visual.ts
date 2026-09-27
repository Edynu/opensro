export interface GroundVisualClock {time:number;last:number;pendingModel:boolean;completed:boolean;scheduledAt:number|null;}
export function groundVisualClock(seconds:number,fanfare:boolean):GroundVisualClock{return {time:0,last:seconds,pendingModel:fanfare,completed:false,scheduledAt:null};}
// 86DB40 + A00B30: only event 100 with an auxiliary holder schedules state 1.
// Repeated registration is refused, preserving the original registration time.
export function groundVisualEvent(clock:GroundVisualClock,event:number,nowMs:number):void{
 if(event===100&&clock.pendingModel&&clock.scheduledAt===null)clock.scheduledAt=nowMs>>>0;
}
export function advanceGroundVisual(clock:GroundVisualClock,seconds:number,claimed:boolean,fanfareDuration:number):void{
 const nowMs=Math.trunc(seconds*1000)>>>0,elapsed=Math.max(0,seconds-clock.last);clock.last=seconds;
 // A00BE0's scheduler is independent of CIItem's claimant early-return. The
 // pending holder has not advanced through 853600 while it was auxiliary.
 if(clock.scheduledAt!==null&&((nowMs-clock.scheduledAt)>>>0)>=1){clock.pendingModel=false;clock.scheduledAt=null;clock.time=0;}
 if(claimed)return;
 clock.time+=elapsed;
 if(clock.pendingModel&&!clock.completed&&clock.time>=fanfareDuration){clock.completed=true;groundVisualEvent(clock,100,nowMs);}
}
