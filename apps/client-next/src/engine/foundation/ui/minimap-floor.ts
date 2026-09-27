import type {Pose,GameplayState} from '@/engine/contracts/gameplay';
export function minimapPoseKey(p:Pick<Pose,'regionId'|'x'|'y'|'z'>):string{return [p.regionId,p.x,p.y,p.z].join(':');}
export function minimapSameFloor(local:Pose,target:Pose,game:GameplayState|null):boolean{
 if(!((local.regionId|target.regionId)&0x8000))return true;
 if(local.regionId!==target.regionId||game?.navigationFloor===undefined)return false;
 return game.minimapFloors?.[minimapPoseKey(target)]===game.navigationFloor;
}
export function minimapFloorQueries(game:GameplayState|null,targets:readonly Pose[]):readonly Pose[]{
 if(!game?.pose||(game.pose.regionId&0x8000)===0)return [];
 const rows:Pose[]=[...targets];
 for(const m of game.social?.members??[])rows.push({regionId:m.region,x:m.x,y:m.y,z:m.z,angle:0});
 if(game.academy?.member)for(const m of game.academy.members??[])if(m.regionId!==undefined&&m.x!==undefined&&m.y!==undefined&&m.z!==undefined)rows.push({regionId:m.regionId,x:m.x,y:m.y,z:m.z,angle:0});
 return [...new Map(rows.filter(p=>p.regionId===game.pose!.regionId).map(p=>[minimapPoseKey(p),p])).values()];
}
