import type {CharacterPointLight} from '@/engine/contracts/character';
import type {EffectRecord} from '@/engine/contracts/effects';
export function createHitLights(){
 const rows=new Map<number,{light:CharacterPointLight;color:readonly [number,number,number];previous:number;progress:number;inverse:number}>();
 return {
  start(gid:number,definition:NonNullable<EffectRecord['hitLight']>,pose:CharacterPointLight['pose'],now:number){const color=definition.color.map(Math.fround) as [number,number,number];rows.set(gid,{color,previous:now,progress:0,inverse:definition.duration>=.001?Math.fround(1/definition.duration):1,light:{pose:{...pose},ambient:[0,0,0],diffuse:color,range:definition.range,attenuation:definition.attenuation}});},
  step(now:number,alive:ReadonlySet<number>){for(const [gid,row]of rows){if(!alive.has(gid)){rows.delete(gid);continue;}if(now<=row.previous)continue;row.progress=Math.fround(row.progress+row.inverse*Math.max(0,now-row.previous));row.previous=now;if(row.progress>=1){rows.delete(gid);continue;}const color=row.color.map(c=>Math.fround(c-row.progress*c)) as [number,number,number];row.light={...row.light,ambient:color.map(c=>Math.fround(c/Math.fround(1.67))) as [number,number,number],diffuse:color.map(c=>Math.fround(c*2)) as [number,number,number]};}},
  get(gid:number){return rows.get(gid)?.light;},reset(){rows.clear();}
 };
}
