import type {CastImpact,CastTargetResult,Pose} from '@/engine/contracts/gameplay';
// 8E0440 -> 8E0190 -> 8E1710. Decode completely before any owner changes.
export function castPhase(payload:Uint8Array,offset:number) {
 const view=new DataView(payload.buffer,payload.byteOffset,payload.byteLength);let cursor=offset;
 function need(n:number){if(cursor+n>payload.length)throw Error('Truncated cast result');}
 function u8(){need(1);return view.getUint8(cursor++);}
 function u16(){need(2);const n=view.getUint16(cursor,true);cursor+=2;return n;}
 function i16(){need(2);const n=view.getInt16(cursor,true);cursor+=2;return n;}
 function u32(){need(4);const n=view.getUint32(cursor,true);cursor+=4;return n;}
 function position():Omit<Pose,'angle'>{return {regionId:u16(),x:i16(),y:i16(),z:i16()};}
 const target=u32(),flags=u8();if(flags&~11)return null;
 const results:CastTargetResult[]=[];let stageCount=0;
 if(flags&1){
  const hits=u8(),targets=u8();stageCount=hits;
  if(hits*targets>16384)throw Error('Cast result capacity exceeded');
  for(let t=0;t<targets;t++){
   const gid=u32(),impacts:CastImpact[]=[];
   for(let h=0;h<hits;h++){
    const raw=u8(),type=raw&127;let packed=0,secondaryAmount=0,displacement:Omit<Pose,'angle'>|undefined,auxiliary:readonly [number,number]|undefined;
    if(type===0||type===4||type===5){packed=u32();secondaryAmount=u32();if(type===4||type===5)displacement=position();}
    else if(type===7){packed=u32();auxiliary=[u16(),u16()];}
    impacts.push({type,damage:packed>>>8,flags:packed&255,fatal:type!==7&&!!(raw&128),secondaryAmount,...(displacement?{displacement}:{}),...(auxiliary?{auxiliary}:{})});
   }
   results.push({target:gid,impacts});
  }
 }
 const travel=flags&8?position():undefined,correction=flags&2?position():undefined;
 if(cursor!==payload.length)throw Error('Invalid cast result length');
 return {target,flags,results,stageCount,travel,correction};
}
