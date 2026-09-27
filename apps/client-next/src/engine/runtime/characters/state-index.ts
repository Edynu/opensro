import type {EntityState} from '@/engine/contracts/world';
import type {GameplayState} from '@/engine/contracts/gameplay';
// Derived indices belong to delivered state, not the render clock. Keep bounded
// key snapshots as well: tests and non-journal producers may reuse input arrays.
// No actor/effect timer or interpolated pose is cached here.
export function createCharacterStateIndex(){
 let entities:readonly EntityState[]|undefined,casts:GameplayState['casts']|undefined,vitals:GameplayState['vitals']|undefined;
 const entitiesByGid=new Map<number,EntityState>(),castByActor=new Map<number,GameplayState['casts'][number]>(),vitalsByGid=new Map<number,GameplayState['vitals'][number]>(),castTokens=new Set<number>();
 const tokens:number[]=[];
 const value={entitiesByGid,castByActor,vitalsByGid,castTokens};
 return {update(next:readonly EntityState[],gameplay:GameplayState|null|undefined){
  if(entities!==next||next.length!==entitiesByGid.size||next.some(row=>entitiesByGid.get(row.gid)!==row)){entitiesByGid.clear();for(const entity of next)entitiesByGid.set(entity.gid,entity);entities=next;}
  if(casts!==gameplay?.casts||tokens.length!==(gameplay?.casts.length??0)||gameplay?.casts.some((row,i)=>castByActor.get(row.caster)!==row||tokens[i]!==row.token)){castByActor.clear();castTokens.clear();tokens.length=0;for(const cast of gameplay?.casts??[]){if(!cast.resultOnly)castByActor.set(cast.caster,cast);castTokens.add(cast.token);tokens.push(cast.token);}casts=gameplay?.casts;}
  if(vitals!==gameplay?.vitals||(gameplay?.vitals.length??0)!==vitalsByGid.size||gameplay?.vitals.some(row=>vitalsByGid.get(row.gid)!==row)){vitalsByGid.clear();for(const vital of gameplay?.vitals??[])vitalsByGid.set(vital.gid,vital);vitals=gameplay?.vitals;}
  return value;
 },reset(){entities=casts=vitals=undefined;tokens.length=0;entitiesByGid.clear();castByActor.clear();vitalsByGid.clear();castTokens.clear();}};
}
