import {itemActivation} from './item-activation';
export interface QuickSlot {readonly slot:number;readonly kind:number;readonly payload:number;}
// 571E40 exposes four pages; 572990 leaves common slot 0 invariant.
export function hotbarSlot(page:number,key:number):number {
 if(!Number.isInteger(page)||page<0||page>3||!Number.isInteger(key)||key<0||key>10)throw Error('Invalid native hotbar index');
 return key===0?0:page*10+key;
}
// Native 59bf50/592b80: bag grid indices exclude the thirteen equipment slots.
export function quickSlotItemSlot(row:QuickSlot):number|null{
 quickSlot(row);
 return row.kind===0x46?row.payload+13:row.kind===0x47?row.payload:null;
}
export function hotbarActions(){return [{id:1000,name:'Sit / Stand'},{id:4000,name:'Greeting'},{id:4001,name:'Laugh'},{id:4002,name:'Salute'},{id:4003,name:'Yes'},{id:4004,name:'Rush'},{id:4005,name:'Joy'},{id:4006,name:'No'},{id:5000,name:'Pet charm'}] as const;}
// 695420 maps action IDs to emote bytes, not to their ordinal slot index.
export function actionEmote(id:number):number|null{
 return id>=4000&&id<=4006?[0,6,1,5,2,3,4][id-4000]!:null;
}
export function quickSlotCommand(row:QuickSlot,state:import('@/engine/contracts/gameplay').GameplayState,mountedOn=0):import('@/engine/contracts/gameplay').GameplayCommand|null{
 const slot=quickSlotItemSlot(row);
 if(slot!==null)return itemActivation(slot,state.inventory,state.inventorySlotCount,state.inventoryPending);
 if(row.kind===0x49&&state.skills?.includes(row.payload))return {kind:'skill',skillId:row.payload,...(state.target?{gid:state.target}:{})};
 if(row.kind===0x4a){const id=row.payload&0xffffff;
  if(id===1000&&!mountedOn||id===1001||actionEmote(id)!==null)return {kind:'action-command',id};
  if(id===5000&&state.cosRecords?.some(c=>c.band===4&&!c.dead&&c.hp>0))return {kind:'action-command',id};
  if(id===1002&&state.target)return {kind:'attack',gid:state.target};
 }
 if(row.kind===0x25&&row.payload===2&&state.activeCos&&mountedOn===state.activeCos.gid&&!state.activeCos.dead&&state.target)return {kind:'cos-attack',gid:state.target};
 return null;
}
// server enterworld/quickslot.go; native 572080 / 572e00. This is client
// configuration, distinct from acknowledgement of the action bound to a slot.
export function quickSlot(value:QuickSlot):QuickSlot {
 const {slot,kind,payload}=value;
 if(!Number.isInteger(slot)||slot<0||slot>=51||![0,0x25,0x46,0x47,0x49,0x4a,0x4e].includes(kind)||!Number.isInteger(payload)||payload<0||payload>0xffffffff)throw new Error('Invalid quickslot binding');
 if(kind===0x46&&payload>=45||kind===0x47&&payload>=13||kind===0x4e&&payload>=4)throw new Error('Invalid quickslot item slot');
 return {slot,kind,payload:kind===0?0:payload};
}
export function quickSlotPacket(value:QuickSlot){
 const row=quickSlot(value),payload=Uint8Array.of(1,row.slot,row.kind,0,0,0,0);new DataView(payload.buffer).setUint32(3,row.payload,true);
 return {opcode:0x7541,payload};
}
export function skillBindings(value:unknown){
 const character=(value as {character?:{skills?:number[];quickSlots?:QuickSlot[]}})?.character;
 const skills=character?.skills??[],rows=character?.quickSlots??[];
 if(!Array.isArray(skills)||skills.length>4096||skills.some(id=>!Number.isInteger(id)||id<=0||id>0xffffffff)||new Set(skills).size!==skills.length||!Array.isArray(rows)||rows.length>51)throw new Error('Invalid skill/bootstrap bindings');
 const bindings=rows.map(quickSlot);if(new Set(bindings.map(row=>row.slot)).size!==bindings.length)throw new Error('Duplicate quickslot');
 return {skills:[...skills],quickSlots:bindings.filter(row=>row.kind!==0).sort((a,b)=>a.slot-b.slot)};
}

// CIFExtQuickSlot 548300 binds underbar windows +458..47C, ten fixed slots.
export function extendedSlot(index:number):number {
 if(!Number.isInteger(index)||index<0||index>=10)throw Error('Invalid extended quickslot index');
 return 41+index;
}
// Dragging a reference never moves the inventory item or grants a skill.
export function quickSlotDrag(source:string,slot:number,state:import('@/engine/contracts/gameplay').GameplayState):QuickSlot|null {
 if(source.startsWith('hotbar:')){const row=state.quickSlots?.find(r=>r.slot===Number(source.slice(7)));return row?quickSlot({...row,slot}):null;}
 if(source.startsWith('skill:')){const id=Number(source.slice(6));return state.skills?.includes(id)?quickSlot({slot,kind:0x49,payload:id}):null;}
 if(source.startsWith('action:')){const id=Number(source.slice(7));return quickSlot({slot,kind:id===2?0x25:0x4a,payload:id});}
 if(source.startsWith('slot:')){const id=Number(source.slice(5));return id<58&&state.inventory.some(r=>r.slot===id)?quickSlot({slot,kind:id<13?0x47:0x46,payload:id<13?id:id-13}):null;}
 return null;
}

// 574B80: a quickslot source (kind 0x0c) swaps with the destination and
// persists both slots. Catalog and inventory sources only copy a reference.
export function quickSlotDrop(source:string,slot:number,state:import('@/engine/contracts/gameplay').GameplayState):QuickSlot[]{
 const binding=quickSlotDrag(source,slot,state);if(!binding)return [];
 if(!source.startsWith('hotbar:'))return [binding];
 const from=Number(source.slice(7));if(from===slot)return [];
 const displaced=state.quickSlots?.find(row=>row.slot===slot);
 return [quickSlot(displaced?{...displaced,slot:from}:{slot:from,kind:0,payload:0}),binding];
}
