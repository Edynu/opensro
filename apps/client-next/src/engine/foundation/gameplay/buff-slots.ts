import type {AttachedEffect} from './attached-effects';

// Combat owns these values. Pure transitions keep UI timing independent from
// authoritative effect residency (6E5F90, 6E6AA0, CIFStateSlot::OnTimer).
export type BuffSlot = {readonly serial:number;readonly effect:AttachedEffect} & (
 | {readonly state:'active';readonly secondary:boolean}
 | {readonly state:'departing';readonly endedAtMs:number});
export const buffDepartureDurationMs=900;
export function retireBuffSlots(slots:readonly BuffSlot[],skill:number,token:number,now:number){
 let sounded=false,secondaryRemoved=false;
 const next:BuffSlot[]=[];
 for(const slot of slots){
  if(slot.state==='active'&&slot.effect.skill===skill&&slot.effect.token===token){
   if(!slot.secondary&&!sounded){sounded=true;next.push({state:'departing',serial:slot.serial,effect:slot.effect,endedAtMs:now});continue;}
   if(slot.secondary&&!secondaryRemoved){secondaryRemoved=true;continue;}
  }
  next.push(slot);
 }
 return {slots:next,sounded};
}
export function buffDepartureFrame(slot:Extract<BuffSlot,{state:'departing'}>,now:number){
 const frame=Math.min(9,Math.floor(Math.max(0,now-slot.endedAtMs)/100));
 return {frame,alpha:Math.max(0,255-Math.max(0,frame-3)*85)/255};
}
