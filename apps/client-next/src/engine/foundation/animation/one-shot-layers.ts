import type {CharacterLayer} from '@/engine/contracts/character';
// CRTAniOneShot: adf310 binds enter/exit separately; ae07e0 holds the end
// cursor during exit. The timed lane continues beneath the event lane.
export function oneShotLayers(event:string,timed:string,elapsed:number,duration:number,exitSeconds:number):readonly CharacterLayer[]{
 const weight=elapsed<duration?1:exitSeconds>0?Math.max(0,1-(elapsed-duration)/exitSeconds):0;
 return [...(weight>0?[{clip:event,time:Math.min(elapsed,duration),loop:false,weight,lane:'event' as const}]:[]),{clip:timed,time:elapsed,loop:true,weight:1,lane:'timed'}];
}
