export type RecoveryCategory=1|2|3;
export interface ItemCooldown {readonly category:RecoveryCategory;readonly startedAtMs:number;readonly durationMs:number;}
// SRO_Client 755E40 / 565400: recovery lanes are TID4, not bag slot or reference ID.
export function recoveryCategory(typeFlags:number):RecoveryCategory|null {
 const category=typeFlags>>>11;
 return (typeFlags&0x7fe)===0xec&&category>=1&&category<=3?category as RecoveryCategory:null;
}
export function itemCooldown(rows:readonly ItemCooldown[],typeFlags:number,now:number):ItemCooldown|undefined {
 const category=recoveryCategory(typeFlags);
 return rows.find(row=>row.category===category&&now<row.startedAtMs+row.durationMs);
}
// Native receipt 755FF4..756084. The server independently owns its reuse guard.
export function recoveryCooldownMs(category:RecoveryCategory,fields:Readonly<Record<string,number>>,country:number,abnormal:number):number {
 if(country!==0&&country!==1)throw Error('Invalid recovery cooldown country');
 const percentage=(fields.itemParam2_2a0??0)!==0||(fields.itemParam4_2a8??0)!==0;
 const duration=percentage?4000:country===0?1000:15000;
 return duration+((category===1&&(abnormal&0x200000)!==0||category===2&&(abnormal&0x400000)!==0)?4000:0);
}
