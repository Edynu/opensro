import type {Pose} from '@/engine/contracts/gameplay';
export interface RegionMoveResult {readonly point:Pose|null;readonly status:number;}
// 412230 re-expresses the original destination in each continuation's sector.
export function regionMoveDestination(to:Pose,regionId:number):Pose {
 return {...to,regionId,x:Math.fround(to.x+((to.regionId&255)-(regionId&255))*1920),z:Math.fround(to.z+((to.regionId>>>8)-(regionId>>>8))*1920)};
}
export function regionMoveAllowed(from:Pose,to:Pose,limit=0x7fffffff):boolean {
 const target=regionMoveDestination(to,from.regionId);
 return !(limit>10&&(target.x-from.x>1920||target.z-from.z>1920));
}
// Only the movement owner dispatches segments. This helper returns a decision;
// it cannot call back into runtime capabilities from the foundation layer.
export function regionMoveContinuation(start:Pose,target:Pose,result:RegionMoveResult,calls:number):'stop'|'continue'|'reject' {
 if(!result.point||(result.status&0x10000001)||!(result.status&0x14))return 'stop';
 const dx=Math.fround(target.x-start.x),dy=Math.fround(target.y-start.y),dz=Math.fround(target.z-start.z);
 if(Math.fround(dy*dy+dx*dx+dz*dz)<25)return 'stop';
 return calls>=6?'reject':'continue';
}
