import type {QuestRecord} from '@/engine/contracts/gameplay';
import {decrementQuestMinute,questDurationText} from '@/engine/foundation/ui/quest-time';

type Clock={phase:'minutes'|'tens'|'seconds';due:number}|{phase:'stopped'};
type Timer={packed:number;labelPacked:number;initial:boolean;clock:Clock};
// Frame-driven statechart: the UI owner supplies every clock event. Keeping
// this bounded transition local avoids importing an opaque scheduler whose
// execution/capability flow the foundation cannot resolve.
function startTimer(packed:number,now:number,worldId:number):Timer{
 const t:Timer={packed,labelPacked:packed,initial:true,clock:{phase:'stopped'}};
 if(packed===0||packed===0xffffffff)return t;
 if(((packed>>>20)&63)===1&&worldId!==0x10001){t.packed=((packed&0x3ffffff)|(60<<26))>>>0;t.clock={due:now+10000,phase:'tens'};}
 else t.clock={due:now+60000,phase:'minutes'};
 return t;
}
function tickTimer(t:Timer,now:number,worldId:number):number|null{
 switch(t.clock.phase){
 case 'minutes':
  if(t.packed===0xffffffff){t.clock={phase:'stopped'};return null;}
  t.packed=decrementQuestMinute(t.packed);t.labelPacked=t.packed;t.initial=false;t.clock={phase:'minutes',due:now+60000};
  if(((t.packed>>>20)&63)===1&&worldId!==0x10001){t.packed=((t.packed&0x3ffffff)|(60<<26))>>>0;t.clock={phase:'tens',due:now+10000};return 60;}
  return null;
 case 'tens':case 'seconds':{
  const seconds=((t.packed>>>26)-(t.clock.phase==='tens'?10:1))&63;
  t.packed=seconds?((t.packed&0x3ffffff)|(seconds<<26))>>>0:0;
  t.clock=seconds===0?{phase:'stopped'}:seconds<=10?{phase:'seconds',due:now+1000}:{phase:'tens',due:now+10000};
  // 5C3040 only repaints the duration in timer 1; second notices leave it intact.
  return seconds||null;
 }
 case 'stopped':return null;
 default:{const unreachable:never=t.clock;return unreachable;}
 }
}
export function createQuestTimers(){
 const rows=new Map<number,{record:QuestRecord;timer:Timer}>();
 return {
  reset(){rows.clear();},
  step(records:readonly QuestRecord[],now:number,worldId:number,metadata?:Readonly<Record<number,{readonly progressClear:number}>>){
   const live=new Set(records.map(q=>q.refId));let changed=false;const notices:number[]=[];
   for(const id of rows.keys())if(!live.has(id)){rows.delete(id);changed=true;}
   for(const q of records){
    let row=rows.get(q.refId);
    // 788264..78827A: an authored nonzero CQuestData +C0 turns the
    // unlimited sentinel into the blank-duration value. It does not clear a
    // running duration. Apply at metadata admission, never mutate wire truth.
    const raw=q.progress??0xffffffff,packed=raw===0xffffffff&&metadata?.[q.refId]?.progressClear?0:raw;
    if(packed===0xffffffff){
     if(!row)continue;
     // Native's unlimited branch updates text without killing the existing
     // timer. Timer 1 retires on its next callback; timers 2/3 keep running.
     if(row.record!==q&&(q.flags&4)!==0){row.timer.packed=packed;row.timer.labelPacked=packed;row.timer.initial=true;changed=true;}
    }else if(!row||row.record!==q&&(q.flags&4)!==0){row={record:q,timer:startTimer(packed,now,worldId)};rows.set(q.refId,row);changed=true;}
    row.record=q;const timer=row.timer;
    if(timer.clock.phase==='stopped'||now<timer.clock.due)continue;
    const notice=tickTimer(timer,now,worldId);changed=true;if(notice!==null)notices.push(notice);
   }
   return {changed,notices};
  },
  text(q:QuestRecord,copy:(key:string)=>string){const timer=rows.get(q.refId)?.timer;return questDurationText(timer?.labelPacked??q.progress,copy,timer?.initial??true);},
 };
}
