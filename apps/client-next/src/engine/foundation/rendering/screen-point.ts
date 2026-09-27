import {viewProjection} from "./world-math";
import type {WorldCamera} from "@/engine/contracts/scene";
export function screenPoint(camera:WorldCamera,point:readonly [number,number,number],width:number,height:number){
 const m=viewProjection(camera,width/height),[x,y,z]=point;
 const w=m[3]!*x+m[7]!*y+m[11]!*z+m[15]!;
 if(w<=0)return null;
 return [(1+(m[0]!*x+m[4]!*y+m[8]!*z+m[12]!)/w)*width/2,(1-(m[1]!*x+m[5]!*y+m[9]!*z+m[13]!)/w)*height/2] as const;
}
