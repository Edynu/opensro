import {decodeQuest,admitQuest,mergeQuest,decodeQuestAcknowledgement,admitQuestMarker,decodeQuestMarker} from '@/engine/foundation/gameplay/quest';
import type {QuestRecord,QuestMarker,QuestProgressEvent} from '@/engine/contracts/gameplay';
import type {WireFrame} from '@/engine/contracts/network';
export function createQuests(send:(frame:WireFrame)=>void){
 // Two states only: idle or one pending operation. Refusals have no quest ID;
 // correlate by operation on the reliable ordered lane, never unlock on progress
 // or start a replacement request on a timer. Only terminal deltas own removal.
 let markers:readonly QuestMarker[]=[];
 let records:readonly QuestRecord[]=[],completed:readonly number[]=[],pending=0,pendingAck=0;
 // Sequence survives world re-bootstrap: the UI may retain the mission during teleport.
 let progress:readonly QuestProgressEvent[]=[],sequence=0;
 return {
 bootstrap(value:unknown){const b=value as {character?:{activeQuests?:unknown[];completedQuestIds?:unknown;trackedQuests?:unknown[]}};const rows=b.character?.activeQuests??[];if(!Array.isArray(rows)||rows.length>256)throw new Error('Quest residency budget');const next=rows.map(admitQuest);if(new Set(next.map(r=>r.refId)).size!==next.length)throw new Error('Duplicate quest');const done=b.character?.completedQuestIds??[];if(!Array.isArray(done)||done.length>65535||done.some(n=>!Number.isSafeInteger(n)||n<=0||n>0xffffffff)||new Set(done).size!==done.length)throw Error('Invalid completed quest IDs');const marks=b.character?.trackedQuests??[];if(!Array.isArray(marks)||marks.length>255)throw Error('Quest marker residency budget');const nextMarkers=marks.map(admitQuestMarker);if(new Set(nextMarkers.map(r=>r.refId)).size!==nextMarkers.length)throw Error('Duplicate quest marker');markers=nextMarkers;completed=[...done];records=next.map(r=>mergeQuest(undefined,r));pending=0;pendingAck=0;progress=[];},
 request(refId:number,reward:boolean){if(pending)throw new Error('Quest transaction pending');const row=records.find(r=>r.refId===refId);if(!row||reward&&row.u10!==2)throw new Error('Quest action unavailable');const payload=new Uint8Array(4);new DataView(payload.buffer).setUint32(0,refId,true);send({opcode:reward?0x729a:0x71eb,payload});pending=refId;pendingAck=reward?0xb29a:0xb1eb;},
 receive(frame:WireFrame){
  if(frame.opcode===0x3498){const row=decodeQuestMarker(frame.payload);if(markers.length>=255&&!markers.some(r=>r.refId===row.refId))throw Error('Quest marker residency budget');markers=[...markers.filter(r=>r.refId!==row.refId),row];return true;}
  if(frame.opcode===0x30ea){if(frame.payload.length!==4)throw Error('Invalid quest marker removal');const id=new DataView(frame.payload.buffer,frame.payload.byteOffset,4).getUint32(0,true);if(!id)throw Error('Invalid quest marker reference');markers=markers.filter(r=>r.refId!==id);return true;}

  if(frame.opcode===0xb29a||frame.opcode===0xb1eb){const result=decodeQuestAcknowledgement(frame.payload);if(result===2&&pending&&pendingAck===frame.opcode){pending=0;pendingAck=0;}return true;}
  if(frame.opcode!==0x31ed)return false;
  const r=decodeQuest(frame.payload),previous=records.find(q=>q.refId===r.refId);
  if(r.op===2&&!previous)throw new Error('Quest update without insertion');
  if(r.op===1&&previous)throw new Error('Duplicate quest insertion');
  if(r.op===1&&records.length>=256)throw new Error('Quest residency budget');
  const next=r.record?mergeQuest(previous,r.record):undefined;
  if(next&&previous){
   // Native walks existing child rows in tag order; insertion is silent.
   const changes=previous.contents.map(before=>({sequence:++sequence,refId:r.refId,before,after:next.contents.find(c=>c.tag===before.tag)!}));
   progress=[...progress,...changes].slice(-100);
  }
  if(r.op>=3&&!completed.includes(r.refId))completed=[...completed,r.refId];
  records=next?(previous?records.map(q=>q.refId===r.refId?next:q):[...records,next]):records.filter(q=>q.refId!==r.refId);
  if(pending===r.refId&&r.op>=3){pending=0;pendingAck=0;}return true;
 },
 state(){return {questMarkers:markers,completedQuests:completed,quests:records,questPending:pending,questProgress:progress};},clear(){markers=[];records=[];completed=[];pending=0;pendingAck=0;progress=[];}
 };
}
