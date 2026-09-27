import type {SkillTooltipRowView,TooltipSkillCatalog} from './skill-tooltip-data';
import {skillParameterFormatters} from './skill-tooltip-params';
import {tooltipFormat,type TooltipRow} from './tooltip-rows';
import type {Progression} from '../gameplay/progression';
// 55FE60 / 806EE0: the current record owns use/effect rows; the group's
// successor owns next-level requirements. Chain children are never upgrades.
export function skillTooltip(id:number,catalog:TooltipSkillCatalog,learned:readonly number[],progression:Progression,text:(symbol:string)=>string,masteryName:(id:number)=>string):readonly TooltipRow[]{
 const row=catalog.get(id);if(!row)return [];
 const white=0xffffffff,gold=0xffefdaa4,red=0xffff4a4a,rows:TooltipRow[]=[];
 const add=(value:string,color=gold,heading=false)=>{if(value.trim())rows.push({value,color,heading,...(heading?{ornament:'diamond' as const}:{})});};
 const levels=new Map<number,number>();for(const id of learned){const r=catalog.get(id);if(r)levels.set(r.groupId,Math.max(levels.get(r.groupId)??0,r.basicLevel));}
 const groupRecord=(group:number,level:number)=>catalog.groups.get(group+':'+level);
 const conditions=(r:SkillTooltipRowView,heading:string)=>{
  const requirements:TooltipRow[]=[];
  const requirement=(value:string,met:boolean)=>{if(value.trim())requirements.push({value,color:met?gold:red});};
  if(r.masteryId)requirement(`${text('PARAM_MASTERY_LEVEL')} : ${masteryName(r.masteryId)} Lv ${r.reqMasteryLevel}`,(progression.masteries.find(m=>m.id===r.masteryId)?.level??0)>=r.reqMasteryLevel);
  if(r.reqStr)requirement(`${text('PARAM_STR')} : ${r.reqStr}`,(progression.stats?.strength??0)>=r.reqStr);
  if(r.reqInt)requirement(`${text('PARAM_INT')} : ${r.reqInt}`,(progression.stats?.intellect??0)>=r.reqInt);
  let index=0;for(const req of r.reqGroups){if(!req.groupId||req.groupId===r.groupId)continue;const prior=groupRecord(req.groupId,req.level);if(!prior)throw Error('Missing tooltip prerequisite');requirement(`${text('PARAM_REQ_PREV_SKILL')}${++index} : ${text(prior.nameSymbol)} Lv ${req.level}`,(levels.get(req.groupId)??0)>=req.level);}
  if(r.reqLearnSp)requirement(`${text('PARAM_REQ_SP')} : ${r.reqLearnSp}`,(progression.skillPoints??0)>=r.reqLearnSp);
  if(requirements.length){add(text(heading),white,true);rows.push(...requirements);}
 };
 add(`${text(row.nameSymbol)} Lv ${row.basicLevel}\n `,white);
 add(text(row.basicActivity===0?'PARAM_PASSIVE_SKILL':'PARAM_ACTIVE_SKILL'));
 for(const [symbol,value]of [['PARAM_REQ_HP',row.requiredHp],['PARAM_REQ_MP',row.requiredMp],['PARAM_REQ_HP_RATIO',row.requiredHpRatio],['PARAM_REQ_MP_RATIO',row.requiredMpRatio]] as const)if(value>0)add(tooltipFormat(text(symbol),value));
 const weapons=['PARAM_WEAPON_SWORD','PARAM_WEAPON_BLADE','PARAM_WEAPON_SPEAR','PARAM_WEAPON_TBLADE','PARAM_WEAPON_BOW',...['ONEHANDSWORD','TWOHANDSWORD','DUELAXE','DARKSTAFF','TWOHANDSTAFF','CROSSBOW','DAGGER','HARP','ONEHANDSTAFF'].map(s=>'UIO_NEWCHAR_STT_EU_'+s)];
 const names=row.requiredWeaponKinds.flatMap(kind=>weapons[kind-2]?[text(weapons[kind-2]!)]:[]);if(names.length)add(`${text('PARAM_REQ_WEAPON_TYPE')}: ${names.join(', ')}`);
 add(text(row.tooltipDescriptionSymbol),white);
 const format=skillParameterFormatters(text);
 if(!row.chainNextSkillId){for(const value of format.direct(row))add(value);}
 else{
  const chain:SkillTooltipRowView[]=[],seen=new Set<number>();let cursor:SkillTooltipRowView|undefined=row;
  while(cursor){if(seen.has(cursor.id))throw Error('Cyclic tooltip skill chain');seen.add(cursor.id);chain.push(cursor);cursor=cursor.chainNextSkillId?catalog.get(cursor.chainNextSkillId):undefined;}
  const attacks=chain.filter(r=>r.attack.present),last=chain.at(-1)!;
  if(attacks.length){const flags=attacks.at(-1)!.attack.flags;if(flags&12){const average=(key:'minimum'|'maximum'|'percent')=>Math.trunc(attacks.reduce((sum,r)=>sum+r.attack[key],0)/attacks.length);add(`${text(flags&4?'PARAM_PA':'PARAM_MA')} ${average('minimum')}~${average('maximum')} (${average('percent')}%)`);}}
  for(const value of format.aggregate(chain))add(value);
  const count=chain.reduce((sum,r)=>sum+(format.block(row,0x5c)?format.block(r,0x5c)?.values[1]??0:1),0);
  if(count)add(`${chain.some(r=>r.directTooltipParams.knockout||r.directTooltipParams.knockback)?text('PARAM_MAX')+' ':''}${text('PARAM_MC_COUNT')} ${count}${text('UIIT_STT_COUNT')}`);
  const area=format.area(last,true);if(area)add(area);
  const p=last.directTooltipParams;
  if(p.downAttackRatio!==null&&p.downAttackRatio!==100)add(`${text('PARAM_DA')} ${p.downAttackRatio-100}% ${text('PARAM_INCREASE')}`);
  if(p.criticalFlat)add(`${text('PARAM_CRITICAL')} ${p.criticalFlat} ${text('PARAM_INCREASE')}`);
  if(p.criticalRatio)add(`${text('PARAM_CRITICAL')} ${p.criticalRatio}% ${text('PARAM_INCREASE')}`);
  if(p.tauntFlat||p.tauntRatio){const base=row.directTooltipParams;if(base.tauntFlat)add(`${text('UIIT_STT_EU_TAUNT')} ${base.tauntFlat}`);if(base.tauntRatio)add(`${text('PARAM_AGGRO')} ${base.tauntRatio}% ${text('PARAM_INCREASE')}`);}
 }
 if(row.basicActivity===1&&(levels.get(row.groupId)??0)<row.basicLevel)conditions(row,'PARAM_CONDITION_OF_LEARN');
 const next=groupRecord(row.groupId,row.basicLevel+1);if(next)conditions(next,'PARAM_CONDITION_OF_NEXT_LEVEL');
 return rows;
}
