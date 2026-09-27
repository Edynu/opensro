import type {SceneryEmitter} from '@/engine/contracts/scenery';
import {radians} from '@/engine/foundation/math/angles';
import {identity} from './world-math';
import {multiply} from '@/engine/foundation/math/pose-math';

// AD05F0: native row-vector Euler matrix, stored column-major for our math.
export function sceneryOrientation(v:readonly number[]):Float32Array {
 if(v.length!==3||!v.every(Number.isFinite))throw Error('Invalid emitter orientation');
 const [x,y,z]=v as readonly [number,number,number],cx=Math.fround(Math.cos(x)),sx=Math.fround(Math.sin(x)),cy=Math.fround(Math.cos(y)),sy=Math.fround(Math.sin(y)),cz=Math.fround(Math.cos(z)),sz=Math.fround(Math.sin(z));
 const m=identity(),a=Math.fround(sy*cx),b=Math.fround(sy*sx);
 m[0]=cz*cy;m[1]=-cy*sz;m[2]=-sy;
 m[4]=sz*cx-b*cz;m[5]=b*sz+cz*cx;m[6]=-sx*cy;
 m[8]=a*cz+sz*sx;m[9]=sx*cz-sz*a;m[10]=cy*cx;
 return m;
}
export function sceneryParticles(value:unknown,placement:string,branch:number,region:number,matrix:Float32Array,warn:(message:string)=>void):SceneryEmitter[]{
 if(value===undefined)return [];
 if(!Array.isArray(value)||value.length>128)throw Error('Invalid scenery particle modifiers');
 const out:SceneryEmitter[]=[];
 const modifiers:readonly unknown[]=value;
 const record=(row:unknown):Record<string,unknown>=>{if(!row||typeof row!=='object'||Array.isArray(row))throw Error('Invalid scenery modifier record');return row as Record<string,unknown>;};
 const vector=(row:unknown):readonly number[]=>{if(!Array.isArray(row)||row.length!==3)throw Error('Invalid scenery emitter vector');const values:readonly unknown[]=row;if(!values.every(v=>typeof v==='number'&&Number.isFinite(v)))throw Error('Invalid scenery emitter vector');return values as readonly number[];};
 for(const [mi,raw] of modifiers.entries()){
  const m=record(raw);
  if(m.kind!==2||m.stateId!==-1||m.animationSetName!=='ambient'){warn('Unsupported scenery particle state');continue;}
  if(!Array.isArray(m.entries)||m.entries.length>128)throw Error('Invalid scenery emitter list');
  const entries:readonly unknown[]=m.entries;
  for(const [ei,rawEntry] of entries.entries()){
   const e=record(rawEntry),position=vector(e.vector3c),flags=vector(e.flags50);
   if(flags.some(v=>!Number.isInteger(v)||v<0||v>255))throw Error('Invalid scenery emitter parameters');
   if(!e.field00){warn('Unsupported scenery bone emitter');continue;}
   if(e.field4c!==0){warn('Unsupported scenery emitter timing');continue;}
   if(typeof e.effectPath!=='string')throw Error('Invalid scenery emitter resource');
   const path=e.effectPath.replaceAll('\\','/').toLowerCase();
   if(!path.endsWith('.efp')||path.startsWith('/')||path.includes('..')||path.includes(':'))throw Error('Invalid scenery emitter resource');
   const [x,y,z]=position as readonly [number,number,number],orientation=e.flag53?sceneryOrientation(vector(e.vector54)):identity(),basis=identity();multiply(matrix,orientation,basis);
   out.push({id:`${placement}:${branch}:${mi}:${ei}`,placement,model:'/assets/effects/programs.json#'+encodeURIComponent(path),
    pose:{regionId:region,x:matrix[12]!+matrix[0]!*x+matrix[4]!*y+matrix[8]!*z,y:matrix[13]!+matrix[1]!*x+matrix[5]!*y+matrix[9]!*z,z:matrix[14]!+matrix[2]!*x+matrix[6]!*y+matrix[10]!*z,yaw:radians(0)},
    basis:[basis[0]!,basis[1]!,basis[2]!,basis[4]!,basis[5]!,basis[6]!,basis[8]!,basis[9]!,basis[10]!],nightOnly:!!(flags[1]!&1),renderPriority:flags[0]!});
  }
 }
 return out;
}
