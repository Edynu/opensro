import {decodeNpcDialogue,npcGid,npcConversationTransition,npcInteractionMask,type NpcConversation} from '@/engine/foundation/gameplay/npc-dialogue';
import type {WireFrame} from '@/engine/contracts/network';
// One untagged request at a time. Timeout never permits automatic retry; close
// uses targeting's ordered release barrier before a new NPC may be selected.
export function createNpcConversation(send:(frame:WireFrame)=>void){
 let state:NpcConversation={phase:'closed'};
 let interactionMask=0;
 return {
  select(gid:number){state=npcConversationTransition(state,{type:'select',gid:npcGid(gid)});},
  talk(now:number){const next=npcConversationTransition(state,{type:'request',now});if(next.phase!=='waiting')throw Error('NPC transition');const payload=new Uint8Array(8);const v=new DataView(payload.buffer);v.setUint32(0,next.gid,true);v.setUint32(4,2,true);send({opcode:0x7338,payload});state=next;},
  choose(choice:number,now:number){if(state.phase!=='ready'||!state.dialogue.options.some(row=>row.choice===choice))throw Error('NPC choice unavailable');const next=npcConversationTransition(state,{type:'request',now});send({opcode:0x3773,payload:Uint8Array.of(choice)});state=next;},
  receive(frame:WireFrame){if(frame.opcode!==0x3773)return false;const dialogue=decodeNpcDialogue(frame.payload);state=npcConversationTransition(state,{type:'reply',dialogue});return true;},
  step(now:number){const next=npcConversationTransition(state,{type:'tick',now});if(next===state)return false;state=next;return true;},
  state:()=>state,
  interaction(payload:Uint8Array,capabilities:number){const next=npcInteractionMask(payload,capabilities);if(next!==null)interactionMask=next;},
  interactionLocked:()=>interactionMask!==0,
  clear(){state=npcConversationTransition(state,{type:'close'});interactionMask=0;},
 };
}
