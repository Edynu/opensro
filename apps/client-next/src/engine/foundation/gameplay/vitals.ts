import type {VitalState} from '@/engine/contracts/gameplay';

// 77A080 / 8604D0, S->C 33A6. Satiety precedes abnormal state on the wire.
// Only the abnormal bits selected by 017FCFC0 carry a following level byte.
export function vitalsUpdate(payload:Uint8Array):VitalState&{readonly sourceFlags:number} {
 const v=new DataView(payload.buffer,payload.byteOffset,payload.byteLength);
 let at=0;
 function read(bytes:1|2|4):number {
  if(at+bytes>payload.length)throw Error('Truncated vitals update');
  const value=bytes===1?v.getUint8(at):bytes===2?v.getUint16(at,true):v.getUint32(at,true);
  at+=bytes;return value;
 }
 const gid=read(4),sourceFlags=read(2);
 const flags=read(1);
 // Bits 4..7 have no consumers in 77A080; they do not add payload fields.
 const hp=flags&1?read(4):undefined,mp=flags&2?read(4):undefined,satiety=flags&8?read(2):undefined;
 const abnormal=flags&4?read(4):undefined;
 const abnormalLevels: {bit:number;level:number}[]=[];
 if(abnormal!==undefined)for(let index=0;index<32;index++){
  const bit=(2**index)>>>0;
  if((abnormal&bit)&&(bit&0x017fcfc0))abnormalLevels.push({bit,level:read(1)});
 }
 if(at!==payload.length)throw Error('Trailing vitals update data');
 return {gid,sourceFlags,...(hp!==undefined?{hp}:{}),...(mp!==undefined?{mp}:{}),...(satiety!==undefined?{satiety}:{}),...(abnormal!==undefined?{abnormal,abnormalLevels}:{})};
}
