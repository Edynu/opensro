import type {SystemNotice} from './system-notices';
interface UniqueReference {readonly symbol:string;readonly name:string}
// These five branches are literal comparisons in v1.150 750949..750a77;
// all other authored references use the generic template, including new ones.
function nativeWording(symbol:string):string|undefined {
 switch(symbol){
  case 'SN_MOB_CH_TIGERWOMAN':return 'TIGER_GIRL';
  case 'SN_MOB_KK_ISYUTARU':return 'IYUTARU';
  case 'SN_MOB_OA_URUCHI':return 'URRUCHI';
  case 'SN_MOB_TK_BONELORD':return 'BONELORD';
  case 'SN_MOB_RM_TAHOMET':return 'TAHOMET';
 }
}
export function uniqueReferences(value:unknown):ReadonlyMap<number,UniqueReference>{
 const rows=(value as {refObjSnapshot?:unknown})?.refObjSnapshot??[];
 if(!Array.isArray(rows))throw Error('Invalid announcement references');
 const refs=new Map<number,UniqueReference>();
 for(const row of rows){
  if(row.kind!=='monster')continue;
  if(!Number.isInteger(row.refObjId)||row.refObjId<=0||row.refObjId>0xffffffff||typeof row.name!=='string'||typeof row.nameStrId!=='string')throw Error('Invalid unique reference');
  refs.set(row.refObjId,{symbol:row.nameStrId,name:row.name});
 }
 return refs;
}
// 74d451: 3058 -> 7508c0. Unlike the newer server's 300C envelope,
// v1.150 starts with one subtype byte. No live entity/GID is required.
export function uniqueNotice(opcode:number,p:Uint8Array,refs:ReadonlyMap<number,UniqueReference>):SystemNotice|null{
 if(opcode!==0x3058)return null;
 if(p.length===0)throw Error('Missing announcement subtype');
 const kind=p[0];if(kind!==5&&kind!==6)return null;
 if(p.length<5)throw Error('Truncated unique reference');
 const view=new DataView(p.buffer,p.byteOffset,p.byteLength),id=view.getUint32(1,true);
 let killer:string|undefined;
 if(kind===5){if(p.length!==5)throw Error('Trailing unique appearance bytes');}
 else {
  if(p.length<7)throw Error('Truncated unique killer');
  const length=view.getUint16(5,true);if(p.length!==7+length)throw Error('Invalid unique killer length');
  killer=new TextDecoder('utf-8',{fatal:true}).decode(p.subarray(7));
 }
 const ref=refs.get(id);if(!ref)return null;
 // 750c0e et al compare against the UTF-16 literal "???" at C0B1DC.
 const suffix=nativeWording(ref.symbol),dead=kind===6,anonymous=killer==='???';
 const prefix=!dead?'APPEAR':anonymous?'DEAD':'ANYONE_DEAD';
 const args=!dead||anonymous?(suffix?[]:[ref.name]):suffix?[killer!]:[killer!,ref.name];
 return {key:`UIIT_MSG_${prefix}_${suffix??'UNIC'}`,value:0,nativeType:0,arguments:args,banner:true};
}
