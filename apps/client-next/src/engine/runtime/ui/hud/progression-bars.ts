import {advanceGauge} from '@/engine/foundation/ui/progression-bars';
export function createSkillGauge(){
 let current=0,target=0;
 return {
  step(skillExperience:number|undefined){
   const nextTarget=skillExperience===undefined?0:Math.fround(Math.max(0,Math.min(1,skillExperience/400)));
   const nextCurrent=skillExperience===undefined?0:advanceGauge(current,nextTarget);
   const changed=nextCurrent!==current||nextTarget!==target;current=nextCurrent;target=nextTarget;
   return changed;
  },
  current:()=>current,target:()=>target,
 };
}

// Slots belong to the assembled UI, not to entities indefinitely. Hidden controls
// retire after assembly; resource/viewport changes retain the existing fraction.
export function createGaugePresentation(){
 const slots=new Map<string,{identity:number;current:number;target:number}>(),seen=new Set<string>();
 return {
  advance(){let changed=false;for(const row of slots.values()){const value=advanceGauge(row.current,row.target);if(value!==row.current){row.current=value;changed=true;}}return changed;},
  begin(){seen.clear();},
  read(slot:string,identity:number,fraction:number,initial:'empty'|'target'='target'){
   const target=Math.fround(Number.isFinite(fraction)?Math.max(0,Math.min(1,fraction)):0);
   let row=slots.get(slot);
   if(!row||row.identity!==identity){row={identity,current:initial==='empty'?0:target,target};slots.set(slot,row);}
   else row.target=target;
   seen.add(slot);return row;
  },
  end(){for(const key of slots.keys())if(!seen.has(key))slots.delete(key);},
  reset(){slots.clear();seen.clear();},
 };
}
