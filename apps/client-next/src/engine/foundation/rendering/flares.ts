import type {WorldCamera} from '@/engine/contracts/scene';
import {viewProjection} from './world-math';

// SWorld::8AD4A0; A1C050 projects the sun direction and forward*20 into pixels.
// The second projected point is the viewport centre. Visibility samples are
// world-space points, not offsets in the projected image (AEBAA0).
export function flareUniforms(camera:WorldCamera,timeOfDay:number,width:number,height:number,dt:number):Float32Array {
 if(![timeOfDay,width,height,dt].every(Number.isFinite)||width<=0||height<=0||dt<0)throw new Error('Invalid flare frame');
 const f=Math.fround,out=new Float32Array(28),angle=f((timeOfDay-.25)*f(Math.PI*2));
 const sun=[f(Math.cos(angle)*20000),f(Math.sin(angle)*20000),0],length=Math.hypot(...sun);
 const direction=sun.map(v=>f(f(v/length)*3500));
 const matrix=viewProjection({...camera,eye:[0,0,0],target:camera.target.map((v,i)=>v-camera.eye[i]!) as [number,number,number]},width/height);
 const offset=width/1024*10;
 // Native stores each changed coordinate to float before the next sample.
 const points=[direction.slice()];let p=direction.slice();p[2]=f(p[2]!+offset);points.push(p.slice());p[2]=f(p[2]!-offset*2);points.push(p.slice());p[2]=f(p[2]!+offset);p[0]=f(p[0]!+offset);points.push(p.slice());p[0]=f(p[0]!-offset*2);points.push(p);
 for(let i=0;i<5;i++){const p=points[i]!;for(let axis=0;axis<4;axis++)out[i*4+axis]=matrix[axis]!*p[0]!+matrix[4+axis]!*p[1]!+matrix[8+axis]!*p[2]!+matrix[12+axis]!;}
 const w=out[3]!,x=f(out[0]!/w),y=f(out[1]!/w);
 out.set([Number.isFinite(x)?f(x*width*.5+width*.5):0,Number.isFinite(y)?f(height*.5-y*height*.5):0,width,height],20);
 out[24]=dt;out[25]=sun[1]!>=700&&w>0&&Math.abs(x)<=1.1&&Math.abs(y)<=1.1?1:0;
 return out;
}

export function flareEntries():readonly {texture:number;size:number;alpha:number;fan:boolean;over:boolean}[]{
 const textures=[6,5,2,6,5,6,3,6,5,6,4,5,6,4,5,6,4,5,6,4,4,5,7,4,5,6,6,5,6,4];
 const sizes=[30,40,150,30,40,50,300,40,30,50,0,30,40,0,40,30,0,80,40,0,0,30,120,0,40,30,30,80,40,0];
 return textures.map((texture,i)=>({texture,size:sizes[i]!,alpha:i<=1?10:i===2?255:i>=10?30-i:20,fan:i===2,over:i===2||texture===3||texture===7}));
}
