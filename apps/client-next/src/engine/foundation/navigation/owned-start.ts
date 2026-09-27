import type {NavMesh,NavPlacement} from '@/engine/contracts/navigation';
import {cellEntry} from './contact-response';
import {navLocal} from './object-navigation';

// 428F40/429052 (server 9B5A80): outside starts first intersect the
// start-to-centroid segment with the retained triangle. EDX writes the HIT
// back to the temporary start, THEN 45C1B0 nudges it inward. This is not
// permission to keep an arbitrary outside sliver of the original chord.
export function ownedCellStart(mesh:NavMesh,cell:number,x:number,z:number):readonly[number,number]{
 const f=Math.fround,v=mesh.vertices,ids=mesh.cells.subarray(cell*3,cell*3+3);
 if(ids.length!==3)return [x,z];
 const points=Array.from(ids,i=>[v[i*3]!,v[i*3+2]!] as const);
 const cx=f(points.reduce((s,p)=>s+p[0],0)/3),cz=f(points.reduce((s,p)=>s+p[1],0)/3);
 let outside=false,boundary=false;
 for(let i=0;i<3;i++){
  const a=points[i]!,b=points[(i+1)%3]!,sx=f(b[0]-a[0]),sz=f(b[1]-a[1]);
  const side=f(sz*f(x-a[0])-sx*f(z-a[1])),inside=sz*(cx-a[0])-sx*(cz-a[1]);
  if(side*inside<0)outside=true;if(side===0)boundary=true;
 }
 if(!outside)return boundary?cellEntry([cx,cz],[x,z]):[x,z];
 const dx=f(cx-f(x)),dz=f(cz-f(z));
 for(let i=0;i<3;i++){
  const a=points[i]!,b=points[(i+1)%3]!,sx=f(b[0]-a[0]),sz=f(b[1]-a[1]),den=f(dx*sz-dz*sx);
  if(den===0)continue;
  const t=f(f((a[0]-x)*sz-(a[1]-z)*sx)/den),u=f(f((a[0]-x)*dz-(a[1]-z)*dx)/den);
  // 43BA6D..43BA99: B parameter is (0,1], A parameter is [0,1).
  // Native deliberately assigns shared vertices to one oriented edge.
  if(t>0&&t<=1&&u>=0&&u<1)return cellEntry([cx,cz],[f(f(x)+dx*t),f(f(z)+dz*t)]);
 }
 return [x,z];
}

export function ownedPlacementStart(p:NavPlacement,cell:number,point:readonly number[]):readonly number[]{
 const q=navLocal(p,point[0]!,point[1]!,point[2]!),a=ownedCellStart(p.mesh,cell,q[0],q[2]);
 if(a[0]===q[0]&&a[1]===q[2])return point;
 const c=Math.cos(p.yaw),s=Math.sin(p.yaw);
 return [c*a[0]-s*a[1]+p.x,point[1]!,s*a[0]+c*a[1]+p.z];
}
