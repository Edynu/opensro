// 854410: one due child per update, followed by attached-child drainage.
export type ItemEffectClock={readonly phase:'pending'}|{readonly phase:'emitting'|'draining';readonly started:number;readonly emitted:number};
export type ItemEffectClockEvent={readonly type:'admit';readonly now:number;readonly count:number}|{readonly type:'reset'};
export function itemEffectClock(state:ItemEffectClock,event:ItemEffectClockEvent):{readonly state:ItemEffectClock;readonly emit:boolean}{
 switch(event.type){
  case 'reset':return {state:{phase:'pending'},emit:false};
  case 'admit':{
   if(!Number.isFinite(event.now)||!Number.isInteger(event.count)||event.count<0||event.count>255)throw Error('Invalid item emitter clock');
   const started=state.phase==='pending'?event.now:state.started,emitted=state.phase==='pending'?0:state.emitted;
   if(state.phase==='draining'||emitted>=event.count)return {state:{phase:'draining',started,emitted},emit:false};
   if(event.now-started<emitted*2)return {state:{phase:'emitting',started,emitted},emit:false};
   // 854438..85448F returns from the emission branch, including the last
   // child. The empty-host removal branch is considered on the NEXT update.
   return {state:{phase:'emitting',started,emitted:emitted+1},emit:true};
  }
 }
}
