import type {Progression} from '../gameplay/progression';
import {tooltipFormat,type TooltipRow} from './tooltip-rows';
export interface TooltipMastery {readonly id:number;readonly name:string;readonly description:string;readonly kind:number;readonly weapons:readonly number[];}
export function decodeTooltipMasteries(value:unknown):ReadonlyMap<number,TooltipMastery>{
 const raw=value as {format?:string;version?:number;masteryRows?:unknown};
 if(raw?.format!=='sro-skillmasterydata'||raw.version!==1||!Array.isArray(raw.masteryRows))throw Error('Invalid mastery tooltip catalogue');
 const rows=new Map<number,TooltipMastery>();
 for(const line of raw.masteryRows){if(typeof line!=='string')throw Error('Invalid mastery row');const c=line.split('\t');if(!/^\d+$/.test(c[0]??'')||c.length!==13)continue;
  const id=Number(c[0]),kind=Number(c[7]),weapons=c.slice(8,11).map(Number);if(rows.has(id)||![id,kind,...weapons].every(Number.isSafeInteger))throw Error('Invalid mastery metadata');
  rows.set(id,{id,name:c[2]!,description:c[4]!,kind,weapons});
 }
 if(!rows.size)throw Error('Empty mastery tooltip catalogue');return rows;
}
// Complete 55AB40 row sequence: description, Chinese mastery bonus, then
// character-level and SP requirements up to native level 120.
export function masteryTooltip(row:TooltipMastery,progression:Progression,costs:Readonly<Record<number,number>>,text:(key:string)=>string):readonly TooltipRow[]{
 const level=progression.masteries.find(m=>m.id===row.id)?.level;if(level===undefined)return [];
 const white=0xffffffff,gold=0xffefdaa4,red=0xffff4a4a,name=text(row.name);
 const result:TooltipRow[]=[{value:`${name} ${text('PARAM_MASTERY')} Lv ${level}\n `,color:white},{value:text(row.description),color:white}];
 const names=['PARAM_WEAPON_SWORD','PARAM_WEAPON_BLADE','PARAM_WEAPON_SPEAR','PARAM_WEAPON_TBLADE','PARAM_WEAPON_BOW'];
 const weapons=row.weapons.flatMap(k=>names[k-2]?[text(names[k-2]!)]:[]);
 if(row.kind===0&&weapons.length)result.push({value:weapons.join('/')+' '+tooltipFormat(text('PARAM_MASTERY_WEAPON_ATT_INCREASE'),level),color:gold});
 else if(row.kind===1)result.push({value:name+' '+tooltipFormat(text('PARAM_MASTERY_ATT_INCREASE'),level),color:gold});
 if(level<120){const cost=level===0?0:costs[level];if(cost===undefined)throw Error('Missing mastery training cost');result.push({value:' ',color:white},{value:text('PARAM_CONDITION_OF_NEXT_LEVEL'),color:gold,ornament:'diamond'},{value:text('PARAM_CHARACTER_LEVEL')+': '+(level+1),color:(progression.level??0)>=level+1?gold:red},{value:text('PARAM_REQ_SP')+' : '+cost,color:(progression.skillPoints??0)>=cost?gold:red});}
 return result.filter(row=>row.value.length>0);
}
