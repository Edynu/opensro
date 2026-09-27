import type {WireFrame} from '@/engine/contracts/network';
export interface AutoPotionSettings {readonly hp:number;readonly mp:number;readonly cure:number;readonly timing:number;}
export interface AutoPotionEntry {readonly enabled:boolean;readonly percent:number;readonly slot:number;}
export function defaultAutoPotion():AutoPotionSettings{return {hp:0x3211,mp:0x3212,cure:0x0013,timing:0x8a};}
export function autoPotionSettings(value:unknown):AutoPotionSettings {
 if(!value||typeof value!=='object')throw Error('Invalid auto-potion settings');
 const r=value as Record<string,unknown>;
 for(const [key,max] of [['hp',65535],['mp',65535],['cure',65535],['timing',255]] as const)if(typeof r[key]!=='number'||!Number.isInteger(r[key])||r[key]<0||r[key]>max)throw Error('Invalid auto-potion '+key);
 return {hp:r.hp as number,mp:r.mp as number,cure:r.cure as number,timing:r.timing as number};
}
// 7783E0 substitutes all defaults for a zero timing byte, and HP alone for zero HP.
export function admittedAutoPotion(value:unknown):AutoPotionSettings {
 const r=autoPotionSettings(value);
 return r.timing===0?defaultAutoPotion():{...r,hp:r.hp||defaultAutoPotion().hp};
}
export function autoPotionBootstrap(value:unknown):AutoPotionSettings {
 const raw=(value as {character?:{autoPotion?:unknown}})?.character?.autoPotion;
 return raw===undefined?defaultAutoPotion():admittedAutoPotion(raw);
}
// 70C3D0: byte decrement wraps before zero extension; malformed page zero caps at 40.
export function autoPotionEntry(word:number):AutoPotionEntry {
 if(!Number.isInteger(word)||word<0||word>65535)throw Error('Invalid auto-potion word');
 const low=word&15,high=word>>>4&15;
 return {enabled:!!(word&0x8000),percent:word>>>8&127,slot:low===0&&high===0?0:Math.min(40,low+((high-1)&255)*10)};
}
export function autoPotionWord(entry:AutoPotionEntry):number {
 const {enabled,percent,slot}=entry;
 if(typeof enabled!=='boolean'||!Number.isInteger(percent)||percent<0||percent>127||!Number.isInteger(slot)||slot<0||slot>40)throw Error('Invalid auto-potion entry');
 const low=slot===0?0:((Math.floor((slot-1)/10)+1)<<4)|((slot-1)%10+1);
 return low|(percent<<8)|(enabled?0x8000:0);
}
export function autoPotionDelay(settings:AutoPotionSettings):number {return settings.timing&128?(settings.timing&127)*100:500;}
export function autoPotionSave(value:unknown):WireFrame {
 const s=autoPotionSettings(value),payload=new Uint8Array(8),v=new DataView(payload.buffer);
 payload[0]=2;v.setUint16(1,s.hp,true);v.setUint16(3,s.mp,true);v.setUint16(5,s.cure,true);payload[7]=s.timing;
 return {opcode:0x7541,payload};
}
export interface AutoPotionFacts {readonly alive:boolean;readonly hp:number;readonly mp:number;readonly maxHp:number;readonly maxMp:number;readonly abnormal:number;}
// 70C550/70C5D0/70C640 keep the repeating timer armed while blocked by an abnormal bit.
export function autoPotionActive(kind:0|1|2,entry:AutoPotionEntry,facts:AutoPotionFacts):boolean {
 if(!entry.enabled||!facts.alive)return false;
 if(kind===2)return facts.abnormal!==0;
 const current=kind===0?facts.hp:facts.mp,max=kind===0?facts.maxHp:facts.maxMp;
 return current<=Math.floor(max*entry.percent/100);
}
export function autoPotionEligible(kind:0|1|2,entry:AutoPotionEntry,facts:AutoPotionFacts):boolean {
 return autoPotionActive(kind,entry,facts)&&(kind===0?(facts.abnormal&0x20)===0:kind===2?(facts.abnormal&0x4000)===0:true);
}
// 70C300 -> 5729E0 -> 5503A0: only bag binding 46, consumable bands 1 or 2.
export function autoPotionItemSlot(binding:import('./quickslots').QuickSlot,inventory:readonly {slot:number;typeFlags:number}[]):number|null {
 if(binding.kind!==0x46)return null;
 const slot=binding.payload+13,item=inventory.find(row=>row.slot===slot),tid=item?.typeFlags;
 if(tid===undefined||(tid&2)!==0||(tid&0x1c)!==0xc||(tid&0x60)!==0x60||!([1,2].includes(tid>>>7&15)))return null;
 return slot;
}
