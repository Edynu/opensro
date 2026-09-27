import type {AttachedEffectReference} from './attached-effects';
export interface HuntingPoint {readonly gid:number;readonly token:number;readonly name:string;readonly regionId:number;readonly x:number;readonly y:number;readonly z:number;readonly angle:number;}
// 776600: three dwords, byte-length string, config-gated duration. The name
// belongs to the effect; it is not a second entity-spawn message.
export function detectionEffect(p:Uint8Array,refs:ReadonlyMap<number,AttachedEffectReference>){
 if(p.length<14)throw Error('Truncated detection effect');const v=new DataView(p.buffer,p.byteOffset,p.byteLength),skill=v.getUint32(0,true),token=v.getUint32(4,true),owner=v.getUint32(8,true),n=v.getUint16(12,true),ref=refs.get(skill);
 if(!ref||ref.huntingPoint===undefined||ref.stealthDuration===undefined)throw Error('Missing detection effect authority');
 if(n>4096||p.length!==14+n+(ref.stealthDuration?4:0))throw Error('Invalid detection effect length');
 return {skill,token,owner,name:new TextDecoder('windows-1252').decode(p.subarray(14,14+n)),duration:ref.stealthDuration?v.getUint32(14+n,true):0,track:ref.huntingPoint};
}
export function huntingMovement(points:readonly HuntingPoint[],p:Uint8Array):readonly HuntingPoint[]{
 if(p.length!==20)throw Error('Invalid tracked movement');const v=new DataView(p.buffer,p.byteOffset,p.byteLength),gid=v.getUint32(16,true),regionId=v.getUint16(0,true),x=v.getFloat32(2,true),y=v.getFloat32(6,true),z=v.getFloat32(10,true),angle=v.getUint16(14,true);
 if(![x,y,z].every(Number.isFinite))throw Error('Invalid tracked coordinates');return points.map(row=>row.gid===gid?{...row,regionId,x,y,z,angle}:row);
}
