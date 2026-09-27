export interface EquipmentVisualRule {readonly slot:number|null;readonly avatarSlot?:number;readonly visualMask:number;readonly visualPriority:number;}
export interface WornVisual {readonly refObjId:number;readonly slot:number;readonly avatar?:boolean;}

export interface DefaultWearRule {readonly armorClass:number;readonly thiefSuit:boolean;readonly visualMask:number;}
// 8EA2F0 / 8E91C0 / 8E8900. Occupancy and armor family use RAW references;
// only avatar suppression uses admitted visuals. Output is a complete replacement
// selection, so removing/changing equipment cannot retain stale default pieces.
export function selectDefaultWear(items:readonly WornVisual[],accepted:readonly WornVisual[],rules:Readonly<Record<string,DefaultWearRule>>,chinesePlayer:boolean):readonly string[]{
 if(!chinesePlayer||items.some(i=>!i.avatar&&i.slot===8&&rules[i.refObjId]?.thiefSuit))return [];
 const first=[...items].filter(i=>!i.avatar&&i.slot>=0&&i.slot<9).sort((a,b)=>a.slot-b.slot).find(i=>(rules[i.refObjId]?.armorClass??0)!==0);
 const family=first&&(rules[first.refObjId]?.armorClass??0)>=2?'light':'clothes';
 return ([{slot:1,mask:2,part:'BA'},{slot:4,mask:16,part:'LA'}] as const).filter(p=>!items.some(i=>!i.avatar&&i.slot===p.slot)&&!accepted.some(i=>i.avatar&&((rules[i.refObjId]?.visualMask??0)&p.mask)!==0)).map(p=>family+'_'+p.part);
}

// Ownerless CCObjCharacter previews pass the native player gate for both races.
// Decode their existing loadout into the same ordered visual slots as live gear.
export function previewDefaultWear(sets:readonly {key:string;parts:readonly string[]}[]):readonly string[]{
 const items:WornVisual[]=[],rules:Record<string,DefaultWearRule>={};
 const slots:Record<string,number>={HA:0,CA:0,BA:1,SA:2,AA:3,LA:4,FA:5};
 for(const set of sets)for(const part of set.parts){const slot=slots[part];if(slot===undefined)continue;const refObjId=items.length+1;items.push({refObjId,slot});rules[refObjId]={armorClass:set.key.includes('_HEAVY_')?3:set.key.includes('_LIGHT_')?2:1,thiefSuit:false,visualMask:0};}
 return selectDefaultWear(items,[],rules,true);
}

// 8E8710/8E8010/8E9A10/8E9B30/8E9C00: job50, avatar head/dress70,
// attachment90, flag110, armor150. Only strictly higher priority masks suppress.
// The job reference mask applies even when its resource cannot be attached.
export function selectEquipmentVisuals<T extends WornVisual>(items:readonly T[],rules:Readonly<Record<string,EquipmentVisualRule>>,resolvable:ReadonlySet<number>,hwanHair:boolean,mounted:boolean,fortress=false){
 const job=items.find(i=>!i.avatar&&i.slot===8),jobMask=job?rules[job.refObjId]?.visualMask??0:0;
 const accepted:T[]=[];
 const ordered=items.map((item,index)=>({item,index,rule:rules[item.refObjId]})).filter((row):row is typeof row & {rule:EquipmentVisualRule}=>!!row.rule).sort((a,b)=>a.rule.visualPriority-b.rule.visualPriority||a.index-b.index);
 for(const {item,rule} of ordered){
  if(!resolvable.has(item.refObjId))continue;
  // 8E8830 admits all weapon kinds and the two shield kinds. These are
  // precisely the native visual sockets 6/7; avatars have no such socket.
  if(fortress&&(item.avatar||(rule.slot!==6&&rule.slot!==7)))continue;
  if(!item.avatar&&mounted&&(item.slot===6||item.slot===7))continue;
  if(hwanHair&&(!item.avatar&&item.slot===0||item.avatar&&(rule.visualMask&1)!==0||!item.avatar&&item.slot===8&&(rule.visualMask&1)!==0&&(rule.visualMask&2)===0))continue;
  if(rule.visualPriority>50&&(rule.visualMask&jobMask)!==0)continue;
  if(accepted.some(other=>{const prior=rules[other.refObjId]!;return other.avatar&&prior.visualPriority<rule.visualPriority&&(prior.visualMask&rule.visualMask)!==0;}))continue;
  accepted.push(item);
 }
 // Preserve authored equipment/avatar traversal order after eligibility selection.
 const selected=new Set(accepted);return items.filter(item=>selected.has(item));
}
