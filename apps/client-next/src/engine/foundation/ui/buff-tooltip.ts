import type {GameplayState} from '@/engine/contracts/gameplay';
import type {UiHelpSource} from '@/engine/contracts/ui';
import {effectRemainingMs} from '../gameplay/attached-effects';
import type {TooltipSkillCatalog} from './skill-tooltip-data';
import type {TooltipRow} from './tooltip-rows';
import {skillParameterFormatters} from './skill-tooltip-params';
import {statusCodes} from '../animation/status-presentation';

// 6DE6F0 uses the code/category variants of 6E0010, not its texture name.
export function abnormalTooltip(bit:number,level:number,text:(key:string)=>string):readonly TooltipRow[]{
 const code=statusCodes()[bit];if(!code)return [];
 const category=[0,1,6,7,8].includes(bit)?'PARAM_RESTRICTION':[2,3,4,11,13,17,18,19,20].includes(bit)?'PARAM_WEAKLY':bit===14?'PARAM_ETC':'PARAM_CURSING';
 const name=text('PARAM_'+code),description=text('DE_UIIT_MSG_STATE_SKILL_CURSING_'+code);
 if(!name)return [];
 return [{value:name+(level?' '+level+text('UIIT_STT_GRADE'):''),color:0xffffffff},{value:text(category)+' '+text('UIIT_STT_MACROPOTION_ABNORMAL'),color:0xffffffff},...(description?[{value:'\n'+description,color:0xffffffff}]:[])];
}
export function buffTooltip(source:UiHelpSource,game:GameplayState,timeMs:number,catalog:TooltipSkillCatalog,text:(key:string)=>string):readonly TooltipRow[]{
 if(source.kind==='abnormal'){
  const vital=game.vitals.find(v=>v.gid===source.gid);if(!((vital?.abnormal??0)&2**source.bit))return [];
  const record=game.abnormalRecords?.find(item=>item.bit===source.bit);
  const shown=source.unlevelled?0:record?record.level||record.grade:vital?.abnormalLevels?.find(r=>r.bit===(2**source.bit)>>>0)?.level??0;
  return abnormalTooltip(source.bit,shown,text);
 }
 // The 0xB419/spawn status byte is only a flag (776450 / 85FB20); every
 // attached effect is a displayable decoration.
 const effect=game.attachedEffects?.find(e=>e.gid===source.gid&&e.token===source.token&&e.skill===source.skill);
 const row=catalog.get(source.skill);if(!effect||!row)return [];
 // 4FC730 returns one on equality. The named soldier/pet exceptions branch
 // to the name-only format; all other skills retain their level suffix.
 const noLevelNames=['SN_SKILL_ASSAULTING_SOILDER','SN_SKILL_ELITE_ASSAULTING_SOILDER','SN_SKILL_CENTURION','SN_SKILL_ASSAULTING_LEADER','SN_SKILL_ELITE_IMPERIAL_GUARD','SN_SKILL_COMBAT_COMMANDER','SN_SKILL_MALL_PET_SKILL_COLD','SN_SKILL_MALL_PET_SKILL_FIRE','SN_SKILL_MALL_PET_SKILL_LIGHTNING','SN_SKILL_MALL_PET_WATCH_CHULHYEN','SN_SKILL_MALL_PET_WATCH_AGOL','SN_SKILL_MALL_PET_GROWTH_POTION'];
 const rows:TooltipRow[]=[{value:text(row.nameSymbol)+(noLevelNames.includes(row.nameSymbol)?'':' Lv '+row.basicLevel)+'\n ',color:0xffffffff}];
 const description=text(row.tooltipDescriptionSymbol);if(description)rows.push({value:description+'\n ',color:0xffffffff});
 for(const value of skillParameterFormatters(text).direct(row))rows.push({value,color:0xffffffff});
 const remaining=source.viewer?null:effectRemainingMs(effect,timeMs),seconds=remaining===null?0:Math.floor(remaining/1000);
 if(seconds>0){const values=[Math.floor(seconds/86400),Math.floor(seconds/3600)%24,Math.floor(seconds/60)%60,seconds%60],units=['PARAM_DAY','PARAM_HOUR','PARAM_MINUTE','PARAM_SECOND'];const first=values.findIndex(v=>v>0);rows.push({value:'\n'+text('UIIT_STT_REMAIN_TIME')+' '+values.slice(first).map((v,i)=>v+text(units[first+i]!)).join(' '),color:0xffffffff});}
 // 6DE6F0: a named (detection) entry appends "Targetting : <name>".
 if(source.viewer&&effect.subject?.name)rows.push({value:text('UIIT_STT_TARGETTING')+' : '+effect.subject.name,color:0xffffffff});
 return rows;
}
