import type {CharacterActor} from '@/engine/contracts/character';
export interface Disappear {readonly actor:CharacterActor;readonly started:number;}
// 852800 transfers the model to a private CIDecoDisappear (8D5B10).
// The wire identity is retired immediately; this visual can never be targeted.
export function disappearActor(row:Disappear,now:number):CharacterActor|null{
 const age=Math.max(0,now-row.started);if(age>=1.5)return null;
 return {...row.actor,pickable:false,opacity:(row.actor.opacity??1)*(1-age/1.5),time:row.actor.time+age,layers:row.actor.layers?.map(layer=>({...layer,time:layer.time+age}))};
}
