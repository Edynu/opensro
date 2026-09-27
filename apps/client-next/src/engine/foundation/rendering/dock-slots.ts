import {radians} from "@/engine/foundation/math/angles";
// 0x73BCF0: each page distributes up to four slots between the native
// endpoints at 0xCC9A18/0xCC9A28, excluding both endpoints.
export function dockSlot(index:number,count:number){
 const t=(index%4+1)/(Math.min(4,count-Math.floor(index/4)*4)+1);
 // The published character GLB front is opposite native CInterfaceModel yaw.
 // Convert that yaw into the presentation basis at this boundary.
 return {regionId:0x6951,x:95-66*t,y:-27.600000381469727,z:654-10*t,yaw:radians(Math.PI-(3.200000047683716+.14999985694885254*t))};
}
