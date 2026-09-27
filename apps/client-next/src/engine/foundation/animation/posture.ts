import type {CharacterLayer} from '@/engine/contracts/character';
// Pure projection state, retained only by the character presentation owner.
export type Posture =
 | {readonly kind:'down';readonly started:number;readonly recoverAt:number}
 | {readonly kind:'recover';readonly started:number}
 | {readonly kind:'emote';readonly started:number;readonly clip:string};
export type PostureEvent =
 | {readonly kind:'down';readonly at:number;readonly recoveryMs:number}
 | {readonly kind:'emote';readonly at:number;readonly action:number}
 | {readonly kind:'cancel'}
 | {readonly kind:'tick';readonly at:number;readonly duration:number};
export function transitionPosture(state:Posture|undefined,event:PostureEvent):Posture|undefined {
 switch(event.kind){
  case 'cancel':return undefined;
  case 'down':
   if(!Number.isInteger(event.recoveryMs)||event.recoveryMs<0)throw Error('Missing native recovery duration');
   // SetMotionState does not restart a state that is already active.
   return state?.kind==='down'?state:{kind:'down',started:event.at,recoverAt:event.at+(event.recoveryMs+500)/1000};
  case 'emote':return state?.kind==='down'||state?.kind==='recover'||state?.kind==='emote'?state:{kind:'emote',started:event.at,clip:`emote${event.action}`};
  case 'tick':
   if(!state)return undefined;
   if(state.kind==='down')return event.at>state.recoverAt?{kind:'recover',started:event.at}:state;
   return event.at-state.started>=event.duration+(state.kind==='emote'?.4:.2)?undefined:state;
 }
}
export function postureLayers(state:Posture,now:number,duration:number):CharacterLayer[] {
 const age=Math.max(0,now-state.started);
 if(state.kind==='down'){
  const loop:CharacterLayer={clip:'downwait',time:age,loop:true,weight:1,lane:'timed'};
  return age<duration?[{clip:'down',time:age,loop:false,weight:1,lane:'event'},loop]:[loop];
 }
 const entry=state.kind==='emote'?.2:0,cursor=Math.max(0,age-entry);
 return [{clip:state.kind==='emote'?state.clip:'wakeup',time:Math.min(cursor,duration),loop:false,weight:Math.min(1,entry?age/entry:1,Math.max(0,1-(cursor-duration)/.2)),lane:'event'}];
}
