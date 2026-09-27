import {headingRadians} from '@/engine/foundation/math/angles';

import type {Pose} from '@/engine/contracts/gameplay';
// CIFUnderBar::Update 571f60; float32 store precedes printf rounding.
export function experienceReadout(experience:string,level:number,levels:ReadonlyMap<number,readonly[string,number]>):string{
 const required=levels.get(level)?.[0];if(!required)return '';
 const percent=Math.min(Math.fround(99.989997863769531),Math.fround(Number(BigInt(experience))*100/Number(required)));
 return Math.max(0,percent).toFixed(2)+' %';
}
// CIFMinimap's outdoor coordinate conversion truncates toward zero.
export function minimapCoordinates(pose:Pick<Pose,'regionId'|'x'|'z'>):readonly[string,string]{
 if(pose.regionId&0x8000)return ['',''];
 const x=(((pose.regionId&255)*3-0x195)<<6)-Math.trunc(pose.x/-10),y=(((pose.regionId>>>8)*3-0x114)<<6)-Math.trunc(pose.z/-10);
 return ['X:'+String(x).padStart(3,' '),'Y:'+String(y).padStart(3,' ')];
}
// The authored arrow points right (+X). Map +Z projects upward, while UI
// quad rotation is clockwise in screen coordinates. Wire zero already faces
// +X; model yaw's pi/2 offset must not be added to this sprite.
export function minimapRotation(angle:number):number{return -headingRadians(angle);}
