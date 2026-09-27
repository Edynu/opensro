import type {AttachedEffect} from '@/engine/foundation/gameplay/attached-effects';
import type {CastState} from '@/engine/contracts/gameplay';
export interface AttachedAction {readonly priority:number;readonly defense:string|null;readonly attack:string|null;}
// 85C450 / 85C3C0: victim defense has precedence. Equal-priority defense
// keeps the first effect; equal-priority attack selects the last effect.
// 8E09AF..8E09B3 registers the executing CIDecoSkill before its callbacks.
// It is not a B419 status effect. Omitting it makes ordinary unbuffed attacks
// lose their primary impact, nested blood/light and root-skill hit sound.
// A cancellation flush still owns this cast until its final results drain.
export function impactSource(caster:number|undefined,target:number,effects:readonly AttachedEffect[],record:(skill:number)=>AttachedAction|undefined,cast?:Pick<CastState,'caster'|'skill'|'receivedAtMs'>){
 const candidates=effects.filter(effect=>effect.token!==0||effect.restored).map(effect=>({gid:effect.gid,skill:effect.skill,at:effect.receivedAtMs??-Infinity}));
 if(cast)candidates.push({gid:cast.caster,skill:cast.skill,at:cast.receivedAtMs??Infinity});
 candidates.sort((a,b)=>a.at-b.at);
 function select(gid:number,kind:'defense'|'attack'){
  let selected:{skill:number;action:AttachedAction}|undefined;
  for(const effect of candidates){
   if(effect.gid!==gid)continue;const action=record(effect.skill);if(!action?.[kind])continue;
   if(!selected||action.priority>selected.action.priority||(kind==='attack'&&action.priority===selected.action.priority))selected={skill:effect.skill,action};
  }
  return selected;
 }
 const defense=select(target,'defense');
 if(defense)return {gid:target,skill:defense.skill,defensive:true};
 if(caster===undefined)return {gid:target,skill:0,defensive:true};
 return {gid:caster,skill:select(caster,'attack')?.skill??0,defensive:false};
}
