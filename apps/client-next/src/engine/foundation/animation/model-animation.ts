import type {AnimationDispatch} from './animation-dispatch';
import type {AnimationActivation} from './animation-activation';
export interface ModifierSelector {readonly set:string;readonly state:number;readonly override?:boolean;}
export interface ModelAnimationFrame {
 readonly selected:ModifierSelector|null;
 readonly revision:number;
 readonly restarted:readonly ModifierSelector[];
 readonly dispatch:readonly {readonly selector:ModifierSelector;readonly ranges:AnimationDispatch['ranges']}[];
}
export function modelModifierSets(value:unknown):readonly ModifierSelector[]{
 if(value===undefined)return [];
 if(!Array.isArray(value))throw Error('Invalid modifier-set inventory');
 return value.filter(row=>row.kind===1).map(row=>{if(!Number.isInteger(row.stateId)||typeof row.animationSetName!=='string'||!Number.isInteger(row.count)||row.count<0)throw Error('Invalid modifier-set record');if(!Number.isInteger(row.firstBaseWord4)||row.firstBaseWord4<0||row.firstBaseWord4>0xffffffff)throw Error('Invalid modifier set override');return {set:row.animationSetName,state:row.stateId,...(row.firstBaseWord4?{override:true}:{})};});
}
export interface ModelAnimationBinding extends ModifierSelector {readonly clip:string;}
export function modelAnimationBindings(value:unknown):readonly ModelAnimationBinding[]{
 if(value===undefined)return [];
 if(!Array.isArray(value))throw Error('Invalid model animation bindings');
 return value.flatMap(row=>{
  if(!row||typeof row.set!=='string'||!Number.isInteger(row.stateId)||row.stateId<0||row.stateId>65535||row.clip!==null&&typeof row.clip!=='string')throw Error('Invalid model animation binding');
  return row.clip===null?[]:[{set:row.set,state:row.stateId,clip:row.clip}];
 });
}
/** A9ABE0/AB3DB0 installs one primary modifier set. ADD670 dispatches keys
 * from all surviving animations, independently of that primary queue. */
export function createModelAnimation(){
 let bound:readonly ModelAnimationBinding[]|undefined;
 let known=new Set<AnimationActivation>(),current:AnimationActivation|undefined,selected:ModifierSelector|null=null,revision=0;
 return {step(rows:readonly AnimationDispatch[],bindings:readonly ModelAnimationBinding[],sets:readonly ModifierSelector[]):ModelAnimationFrame{
  if(bound!==bindings){known.clear();current=undefined;selected=null;revision++;bound=bindings;}
  const resolve=(clip:string)=>{const b=bindings.find(b=>b.clip===clip);return b?(sets.find(s=>s.state===b.state&&s.set===b.set)??sets.find(s=>s.state===b.state&&s.set==='default')??null):null;};
  const restarted:ModifierSelector[]=[];
  const next=new Set(rows.map(r=>r.activation));
  // The presenter supplies installation times, not weights. At a common time
  // the event lane is installed over locomotion; outgoing layers follow it.
  const added=rows.filter(r=>!known.has(r.activation)).sort((a,b)=>a.activation.started-b.activation.started||(a.layer.lane===b.layer.lane?0:a.layer.lane==='timed'?-1:1));
  if(!added.length&&current&&!next.has(current)){current=undefined;selected=null;revision++;}
  for(const row of added){const replacement=resolve(row.layer.clip);if(selected&&replacement&&selected.set===replacement.set&&selected.state===replacement.state)restarted.push(selected);current=row.activation;selected=replacement;revision++;}
  known=next;
  return {selected,revision,restarted,dispatch:rows.flatMap(row=>{const selector=resolve(row.layer.clip);return selector?[{selector,ranges:row.ranges}]:[];})};
 },reset(){bound=undefined;known.clear();current=undefined;selected=null;revision=0;}};
}
