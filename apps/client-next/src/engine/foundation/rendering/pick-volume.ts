import {pickGeometry,type PickBounds,type PickRay} from './picking';
// 0x8e75f0 / data_cccc78: eight corners and twelve faces of the model box.
// Transform the box itself, retaining orientation, scale and reflection.
export function pickVolumeDepth(ray:PickRay,b:PickBounds,transform:Float32Array):number|null{
 for(let i=0;i<6;i++)if(!Number.isFinite(b[i]))return null;
 if(b[0]>b[3]||b[1]>b[4]||b[2]>b[5])return null;
 // Invert the affine basis with scalar cofactors. Parameter t is unchanged
 // by this transform, so the result retains finite world-segment depth.
 const m=transform,a=m[0]!,d=m[1]!,g=m[2]!,c=m[8]!,f=m[9]!,i=m[10]!,bb=m[4]!,e=m[5]!,h=m[6]!;
 const A=e*i-f*h,B=c*h-bb*i,C=bb*f-c*e,D=f*g-d*i,E=a*i-c*g,F=c*d-a*f,G=d*h-e*g,H=bb*g-a*h,I=a*e-bb*d;
 const determinant=a*A+bb*D+c*G;
 if(Number.isFinite(determinant)&&Math.abs(determinant)>1e-12&&Math.max(Math.abs(ray.delta[0]!),Math.abs(ray.delta[1]!),Math.abs(ray.delta[2]!))>1e-10){
  const x=ray.start[0]!-m[12]!,y=ray.start[1]!-m[13]!,z=ray.start[2]!-m[14]!;
  const dx=ray.delta[0]!,dy=ray.delta[1]!,dz=ray.delta[2]!;
  let enter=-Infinity,exit=Infinity;
  for(let axis=0;axis<3;axis++){
   const r0=axis===0?A:axis===1?D:G,r1=axis===0?B:axis===1?E:H,r2=axis===0?C:axis===1?F:I;
   const start=(r0*x+r1*y+r2*z)/determinant,delta=(r0*dx+r1*dy+r2*dz)/determinant;
   if(!Number.isFinite(start)||!Number.isFinite(delta))return null;
   if(delta===0){if(start<b[axis]!||start>b[axis+3]!)return null;continue;}
   const near=(b[axis]!-start)/delta,far=(b[axis+3]!-start)/delta;
   enter=Math.max(enter,Math.min(near,far));exit=Math.min(exit,Math.max(near,far));
   if(enter>exit)return null;
  }
  // A ray starting inside selects its exit surface, as the triangle oracle
  // does. An entirely internal segment has no surface hit.
  const depth=enter>=0?enter:exit;
  return Number.isFinite(depth)&&depth>=0&&depth<=1?depth:null;
 }
 // A flattened transform can still contain hittable triangles. Retain the
 // established oracle for this exceptional case rather than reject it.
 const [x,y,z,X,Y,Z]=b;
 return pickGeometry(ray,{positions:new Float32Array([x,Y,Z,X,Y,Z,X,Y,z,x,Y,z,x,y,Z,X,y,Z,X,y,z,x,y,z]),indices:new Uint32Array([0,1,2,0,2,3,3,2,6,3,6,7,2,1,5,2,5,6,1,0,4,1,4,5,0,3,7,0,7,4,7,6,5,7,5,4]),transform},transform);
}

export function pickVolume(ray:PickRay,b:PickBounds,transform:Float32Array):boolean{return pickVolumeDepth(ray,b,transform)!==null;}
