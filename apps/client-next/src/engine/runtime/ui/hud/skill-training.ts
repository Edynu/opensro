import {createSkillTrainingContext,type SkillMetadata} from '@/engine/foundation/gameplay/skill-catalog';
const emptyCatalog:readonly SkillMetadata[]=[],emptyLearned:readonly number[]=[];
// UI-owned cache of immutable publications. Worker cloning changes learned-array
// identity without changing its values. Compare that small list before rebuilding
// the full catalog index. Catalog replacement, learned-value changes, reset and
// world teardown invalidate it; this owner retains exactly one input snapshot.
export function createSkillTrainingCache(){
 let catalog:readonly SkillMetadata[]|undefined,learned:readonly number[]|undefined,context:ReturnType<typeof createSkillTrainingContext>|undefined;
 return {
  read(nextCatalog=emptyCatalog,nextLearned=emptyLearned){
   const sameLearned=learned===nextLearned||learned?.length===nextLearned.length&&nextLearned.every((id,i)=>id===learned![i]);
   if(!context||catalog!==nextCatalog||!sameLearned){context=createSkillTrainingContext(nextLearned,nextCatalog);catalog=nextCatalog;learned=nextLearned;}
   return context;
  },
  reset(){context=undefined;catalog=undefined;learned=undefined;},
 };
}
