import {multiply} from '@/engine/foundation/math/pose-math';
import {identity} from '@/engine/foundation/rendering/world-math';

/** AD05F0. Native row-vector matrix storage is also the column-vector storage
 * of its transpose. Keep this result in native coordinates until the adapter. */
export function bsrParticleRotation(angles:readonly [number,number,number]):Float32Array{
 if(!angles.every(Number.isFinite))throw Error('Invalid BSR particle rotation');
 const [x,y,z]=angles.map(Math.fround),f=Math.fround;
 const cx=f(Math.cos(x!)),sx=f(Math.sin(x!)),cy=f(Math.cos(y!)),sy=f(Math.sin(y!)),cz=f(Math.cos(z!)),sz=f(Math.sin(z!));
 const a=f(sy*cx),b=f(sy*sx);
 return new Float32Array([cy*cz,-cy*sz,-sy,0,cx*sz-b*cz,b*sz+cx*cz,-sx*cy,0,a*cz+sx*sz,sx*cz-a*sz,cy*cx,0,0,0,0,1]);
}

/** AEC870/AEC910 -> AEC1F0. Inputs and output are native matrix storage;
 * coordinate conversion belongs to the presentation adapter, exactly once.
 * Bone matrices already own bone translation; vector3C applies only at root. */
export function bsrParticleTransform(world:Float32Array,bone:Float32Array|null,offset:readonly [number,number,number],scale:number,rotation?:Float32Array):{matrix:Float32Array<ArrayBuffer>;scale:number}{
 if(world.length!==16||bone&&bone.length!==16||rotation&&rotation.length!==16||!Number.isFinite(scale)||!offset.every(Number.isFinite))throw Error('Invalid BSR particle transform');
 const local=bone??identity();
 if(!bone){local[12]=Math.fround(offset[0]*scale);local[13]=Math.fround(Math.fround(offset[1]*scale)*scale);local[14]=Math.fround(offset[2]*scale);}
 let matrix=new Float32Array(16);multiply(world,local,matrix);
 if(rotation){
  const translation=matrix.slice(12,15);matrix[12]=matrix[13]=matrix[14]=0;
  const rotated=new Float32Array(16);multiply(matrix,rotation,rotated);rotated.set(translation,12);matrix=rotated;
 }
 return {matrix,scale:Math.fround(scale)};
}

/** AE0380 performs lower_bound(previous) through lower_bound(current).
 * A key exactly at current remains pending for the next advancing range. */
export function bsrParticleRange(keys:readonly number[],previous:number,current:number):readonly number[]{
 if(!Number.isInteger(previous)||!Number.isInteger(current)||previous<0||current<previous)throw Error('Invalid BSR particle cursor range');
 const out:number[]=[];for(let i=0;i<keys.length;i++)if(keys[i]!>=previous&&keys[i]!<current)out.push(i);return out;
}

/** Adapter for the port's imported body/socket bases. EFP programs retain
 * native coordinates; unlike GLB vertices they have not been Z-flipped. */
export function bsrParticleAttachment(parent:Float32Array,socket:Float32Array,root:boolean,offset:readonly [number,number,number],ownerScale:number,initialScale:number,rotation?:Float32Array):Float32Array<ArrayBuffer>{
 if(!Number.isFinite(ownerScale)||ownerScale<=0)throw Error('Invalid BSR holder scale');
 const base=new Float32Array(16);
 if(root)base.set(parent);else multiply(parent,socket,base);
 for(let c=0;c<3;c++)for(let r=0;r<3;r++)base[c*4+r]=base[c*4+r]!/ownerScale*((root?c===0||c===2:c===2)?-1:1);
 const result=bsrParticleTransform(root?base:identity(),root?null:base,[offset[0],offset[1],-offset[2]],initialScale,rotation).matrix;
 for(let n=0;n<12;n++)result[n]!*=initialScale;
 return result;
}
