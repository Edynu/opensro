import type {CharacterLayer} from '@/engine/contracts/character';
import {animationActivation,type AnimationActivation} from './animation-activation';
interface Outgoing {readonly layer:CharacterLayer;readonly ends:number;}
export interface LocomotionBlend {rate?:number;clip:string;started:number;loop:boolean;enter:number;outgoing:readonly Outgoing[];activation:AnimationActivation;}
function outgoingAt(state:LocomotionBlend,now:number):Outgoing[]{
 const age=Math.max(0,now-state.started);
 return state.outgoing.filter(row=>row.ends>now).map(row=>({ends:row.ends,layer:{...row.layer,time:row.layer.time+age*(row.layer.rate??1),weight:row.layer.weight*Math.max(0,(row.ends-now)/(row.ends-state.started))}}));
}
function incomingAt(state:LocomotionBlend,now:number):CharacterLayer|null{
 if(!state.clip)return null;
 const age=Math.max(0,now-state.started),weight=state.enter?Math.min(1,age/state.enter):1;
 // An installation carries no pose until its entry blend gives it weight, and
 // outgoing rows are already filtered the same way. Publishing it a frame early
 // adds a phantom installation with its own cursor and sound lane.
 if(weight<=0)return null;
 return {...(state.rate===undefined||state.rate===1?{}:{rate:state.rate}),clip:state.clip,time:age*(state.rate??1),loop:state.loop,weight,lane:'timed',activation:state.activation};
}
export function stopLocomotion(previous:LocomotionBlend|undefined,now:number):LocomotionBlend|undefined{
 if(!previous)return undefined;
 const outgoing=outgoingAt(previous,now),incoming=incomingAt(previous,now);
 if(incoming)outgoing.push({layer:incoming,ends:now+.2});
 return {...previous,clip:'',started:now,outgoing};
}
// 8E5DD0/8E6ED0: run enters over 100 ms, walk over 200 ms;
// each outgoing motion keeps its own 200 ms exit deadline. Reversing again
// must not restart earlier exits and grow the mixer indefinitely.
export function locomotionLayers(state:LocomotionBlend,now:number):CharacterLayer[]{
 if(!state.outgoing.length){const incoming=incomingAt(state,now);return incoming?[incoming]:[];}
 state.outgoing=state.outgoing.filter(row=>row.ends>now);
 const layers=outgoingAt(state,now).map(row=>row.layer),incoming=incomingAt(state,now);
 if(incoming)layers.push(incoming);return layers;
}
export function changeLocomotion(previous:LocomotionBlend|undefined,clip:string,loop:boolean,now:number,role:string,restart=false):LocomotionBlend{
 if(!restart&&previous&&previous.clip===clip&&previous.loop===loop)return previous;
 const outgoing=previous?outgoingAt(previous,now):[],incoming=previous?incomingAt(previous,now):null;
 if(incoming)outgoing.push({layer:incoming,ends:now+.2});
 return {clip,loop,started:now,enter:outgoing.length?(role==='run'?.1:.2):0,outgoing,activation:animationActivation(now)};
}
