import type {PickRay} from './picking';
// The render ray is relative to the committed scene's origin region. Convert
// once at the picking boundary; worker navigation still admits the destination.
export function pickDestination(ray:PickRay,depth:number,originRegion:number){
 if(!Number.isFinite(depth)||depth<0||depth>1||!originRegion)return null;
 let x=ray.start[0]!+ray.delta[0]!*depth,y=ray.start[1]!+ray.delta[1]!*depth,z=ray.start[2]!+ray.delta[2]!*depth;
 let regionId=originRegion;
 if(!(originRegion&0x8000)){
  const dx=Math.floor(x/1920),dz=Math.floor(z/1920),rx=(originRegion&255)+dx,rz=(originRegion>>>8)+dz;
  if(rx<0||rx>255||rz<0||rz>=128)return null;
  regionId=rx|(rz<<8);x-=dx*1920;z-=dz*1920;
 }
 return [x,y,z].every(Number.isFinite)?{regionId,x,y,z}:null;
}
