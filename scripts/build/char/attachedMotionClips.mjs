import path from 'node:path';
import {parseSkillAniSet} from './parseSkillEffect.mjs';
import {SKILL_EFFECT_ANIMATION_ID_BY_NAME} from './native/skillEffectAnimationRegistry.ts';
import {retailTextdataRoot} from '../world/paths.mjs';
import {findAnimationSet} from './animationUtils.mjs';
let required;
export function attachedMotionRequests(rows){
 const result=new Map();
 for(const row of rows){const name=row.actionWaitAnims[0];if(!name)continue;
  const id=SKILL_EFFECT_ANIMATION_ID_BY_NAME.get(name),set=row.aniGroup.toLowerCase();
  result.set(`${set}:${id}`,{id,set,role:`attached-${set.replaceAll('_','-')}-${id}`});
 }
 return [...result.values()];
}
export function pickAttachedMotionClips(bsr,requests){
 if(!requests)required??=attachedMotionRequests(parseSkillAniSet(path.join(retailTextdataRoot,'skilleffect.txt')).values());
 return (requests??required).flatMap(request=>{
  const find=set=>findAnimationSet(bsr,set)?.states.find(s=>s.stateId===request.id&&s.animationPath);
  const state=find(request.set)??find('default');
  return state?[{...request,state,path:state.animationPath}]:[];
 });
}
