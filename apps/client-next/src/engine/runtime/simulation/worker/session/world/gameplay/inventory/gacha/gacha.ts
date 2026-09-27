import {gachaPrizes,isGachaTicket} from '@/engine/foundation/gameplay/gacha-catalog';
import type {GachaState} from '@/engine/contracts/item-process';
import type {InventoryItem} from '@/engine/contracts/gameplay';
import type {UiSoundHandle} from '@/engine/foundation/ui/sound-catalog';
export function createGacha(){
 let state:GachaState={visible:false,phase:'closed',npc:0,slot:null,entry:0,started:0,result:null,error:null};
 return {
  open(gid:number){if(!Number.isInteger(gid)||gid<=0||gid>0xffffffff||state.phase==='rolling'||state.phase==='waiting')throw Error('Magic Pop unavailable');const payload=new Uint8Array(8),v=new DataView(payload.buffer);v.setUint32(0,gid,true);v.setUint32(4,0x10000,true);state={...state,phase:'opening',npc:gid,error:null};return {opcode:0x7338,payload};},
  opened(p:Uint8Array){if(p[0]!==1){if(state.phase!=='opening')return false;if(p.length!==2)throw Error('Invalid NPC interaction rejection');state={...state,phase:'closed',error:p[1]!};return true;}if(p.length!==5)throw Error('Invalid NPC interaction result');if(!(new DataView(p.buffer,p.byteOffset,p.byteLength).getUint32(1,true)&0x10000))return false;if(state.phase!=='opening')return true;state={...state,visible:true,phase:'idle'};return true;},
  close(){if(state.phase==='rolling'||state.phase==='waiting')return false;state={...state,visible:false,phase:'closed'};return true;},
  start(entry:number,slot:number,item:InventoryItem|undefined,now:number):readonly UiSoundHandle[]{
   const flags=item?.typeFlags??0;
   if(!state.visible||!['idle','result'].includes(state.phase)||!gachaPrizes().some(prize=>prize.entry===entry)||!item||slot<13||slot>255||item.slot!==slot||item.quantity<=0||!isGachaTicket(flags))throw Error('Magic Pop roll unavailable');
   state={...state,phase:'rolling',entry,slot,started:now,result:null,reward:undefined,error:null};return ['SND_GACHA_MOVE','SND_GACHA_TURN'];
  },
  step(now:number,item:InventoryItem|undefined){if(state.phase!=='rolling'||now-state.started<4000)return null;if(!item||item.slot!==state.slot||item.quantity<=0||!isGachaTicket(item.typeFlags)){state={...state,phase:'idle',slot:null};return null;}const payload=new Uint8Array(9),v=new DataView(payload.buffer);v.setUint32(0,state.npc,true);v.setUint32(4,state.entry,true);payload[8]=state.slot!;state={...state,phase:'waiting'};return {opcode:0x7053,payload};},
  result(p:Uint8Array,item:InventoryItem|undefined):readonly UiSoundHandle[]{
   if(p.length!==2)throw Error('Invalid Magic Pop result');
   // 766A4E jumps directly to the system-notice dispatcher on failure;
   // it never calls CIFGhaCha_ApplyResult or changes this window's state.
   if(p[0]!==1)return [];
   if(!state.visible||!item)return [];
   if(p[1]!==1){state={...state,phase:'result',result:'lose',error:null};return ['SND_GACHA_END'];}
   if(item.magic.length!==2)return [];
   // CSOItem's indexed magic map contains the two raw values for result cards.
   const refObjId=Number(BigInt(item.magic[0]!)&0xffffffffn),quantity=Number(BigInt(item.magic[1]!)&0xffffffffn);
   state={...state,phase:'result',result:'win',reward:{refObjId,quantity},error:null};return ['SND_GACHA_WIN'];
  },
  state:()=>state,
  reset(){state={visible:false,phase:'closed',npc:0,slot:null,entry:0,started:0,result:null,error:null};}
 };
}
