import type {CosRecord,InventoryItem} from '@/engine/contracts/gameplay';

// Native 697E80 cases 1A/1B: GID + source/destination, no quantity.
export function planCosTransfer(record:CosRecord,player:readonly InventoryItem[],toCos:boolean,source:number,destination:number,capacity:number,equipment:number,caps:ReadonlyMap<number,number>){
 if(record.dead||record.hp===0||!record.inventory||!Number.isInteger(record.status)||record.status<1)throw Error('COS container unavailable');
 if(!Number.isInteger(capacity)||!Number.isInteger(equipment)||equipment<0||capacity<=equipment)throw Error('Player capacity unavailable');
 const from=new Map((toCos?player:record.inventory).map(row=>[row.slot,row])),to=new Map((toCos?record.inventory:player).map(row=>[row.slot,row]));
 if(!Number.isInteger(source)||!Number.isInteger(destination)||source<(toCos?equipment:0)||source>=(toCos?capacity:record.status)||destination<(toCos?0:equipment)||destination>=(toCos?record.status:capacity)||!from.has(source))throw Error('Transfer requires valid bag slots and a source item');
 const item=from.get(source)!,other=to.get(destination);
 if(other&&other.refObjId===item.refObjId&&(item.typeFlags&0x7e)===0x6c){
  const cap=caps.get(item.refObjId);
  if(cap===undefined||!Number.isInteger(cap)||cap<1||cap>65535||![item.quantity,other.quantity].every(n=>Number.isInteger(n)&&n>0&&n<=cap))throw Error('Invalid COS transfer stack limit/count');
  const dest=other.quantity===cap?item.quantity:Math.min(cap,item.quantity+other.quantity),remain=other.quantity===cap?cap:item.quantity+other.quantity-dest;
  to.set(destination,{...other,quantity:dest});if(remain)from.set(source,{...item,quantity:remain});else from.delete(source);
 }else{
  to.set(destination,{...item,slot:destination});if(other)from.set(source,{...other,slot:source});else from.delete(source);
 }
 return {player:[...(toCos?from:to).values()].sort((a,b)=>a.slot-b.slot),cos:{...record,inventory:[...(toCos?to:from).values()].sort((a,b)=>a.slot-b.slot)}};
}

export function cosTransferRequest(gid:number,toCos:boolean,source:number,destination:number){
 if(!Number.isInteger(gid)||gid<1||gid>0xffffffff)throw Error('Invalid COS identity');
 if(![source,destination].every(slot=>Number.isInteger(slot)&&slot>=0&&slot<=255))throw Error('Invalid transfer slot');
 const payload=new Uint8Array(7);payload[0]=toCos?0x1b:0x1a;new DataView(payload.buffer).setUint32(1,gid,true);payload[5]=source;payload[6]=destination;
 return {opcode:0x706d,payload};
}
