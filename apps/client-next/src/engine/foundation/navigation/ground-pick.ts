import {pickGeometry,rayIntersectsBounds} from '@/engine/foundation/rendering/picking';
import {pickDestination} from '@/engine/foundation/rendering/pick-destination';
import type {GroundPickQuery,NavPlacement} from '@/engine/contracts/navigation';
// 88D340 -> 412720: terrain wins equal distances; only object navigation
// cells participate. Placement transforms are relative to the admitted region.
export function pickNavigationGround(objects:readonly NavPlacement[],origin:number,query:GroundPickQuery){
 const {ray,originRegion,terrainDepth}=query;
 if(!Number.isInteger(originRegion)||originRegion<=0||originRegion>65535||ray.start.length!==3||ray.delta.length!==3||![...ray.start,...ray.delta].every(Number.isFinite)||Math.hypot(...ray.delta)>1000.001||terrainDepth!==null&&(!Number.isFinite(terrainDepth)||terrainDepth<0||terrainDepth>1))throw Error('Invalid ground ray');
 if(((originRegion|origin)&0x8000)&&originRegion!==origin)return null;
 let nearest=terrainDepth??Infinity;
 const dx=(originRegion&0x8000)?0:((origin&255)-(originRegion&255))*1920,dz=(originRegion&0x8000)?0:((origin>>>8)-(originRegion>>>8))*1920;
 for(const p of objects){
  const c=Math.cos(p.yaw),s=Math.sin(p.yaw),transform=new Float32Array([c,0,s,0,0,1,0,0,-s,0,c,0,p.x+dx,p.y,p.z+dz,1]);
  if(!rayIntersectsBounds(ray,p.mesh.bounds as readonly [number,number,number,number,number,number],transform,Math.min(1,nearest)))continue;
  const depth=pickGeometry(ray,{positions:p.mesh.vertices,indices:new Uint32Array(p.mesh.cells),transform},transform);
  if(depth!==null&&depth<nearest)nearest=depth;
 }
 return Number.isFinite(nearest)?pickDestination(ray,nearest,originRegion):null;
}
