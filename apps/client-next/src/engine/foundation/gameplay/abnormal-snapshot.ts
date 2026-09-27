import type {SystemNotice} from './system-notices';
import {statusCodes} from '../animation/status-presentation';

// 77C110 stores one record per set bit. The text suffix is the PARAM code
// from 6DE6F0 (textuisystem UIIT_MSG_STATE_SKILL_CURSING_*), not the
// texture stem abnormalIcon uses (freeze, frostbite, ...).

export interface AbnormalRecord {
 readonly bit:number;
 readonly level:number;
 readonly grade:number;
 readonly durationMs:number;
 readonly elapsedMs:number;
 readonly receivedAtMs:number;
}

// 77C110: u32 mask, then per set bit low to high u16 duration/100,
// u16 elapsed/100, and one byte (level for 0x203F, grade for 0x017FCFC0).
export function parseAbnormalSnapshot(payload:Uint8Array,receivedAtMs:number):readonly AbnormalRecord[]{
 if(payload.length<4)throw Error('Truncated abnormal snapshot');
 const view=new DataView(payload.buffer,payload.byteOffset,payload.byteLength);
 const mask=view.getUint32(0,true)>>>0;
 let offset=4;
 const records:AbnormalRecord[]=[];
 for(let bit=0;bit<32;bit++){
  const value=2**bit;
  if((mask&value)===0)continue;
  if(offset+5>payload.length)throw Error('Invalid abnormal snapshot extent');
  const durationMs=view.getUint16(offset,true)*100;
  const elapsedMs=view.getUint16(offset+2,true)*100;
  const byte=payload[offset+4]!;
  const level=(value&0x203f)!==0?byte:0;
  const grade=(value&0x017fcfc0)!==0?byte:0;
  records.push({bit,level,grade,durationMs,elapsedMs,receivedAtMs});
  offset+=5;
 }
 if(offset!==payload.length)throw Error('Invalid abnormal snapshot extent');
 return records;
}

// 6E6AA0: elapsed grows with the frame delta and stops at the duration.
// Bit 0x1000000 is infinite, so its bar stays full.
export function abnormalBarFraction(record:AbnormalRecord,nowMs:number):number{
 if((2**record.bit)===0x1000000)return 1;
 if(record.durationMs<=0)return 0;
 const elapsed=Math.min(record.durationMs,record.elapsedMs+Math.max(0,nowMs-record.receivedAtMs));
 return (record.durationMs-elapsed)/record.durationMs;
}

// 6841C0: a newly set bit announces CURSING_<code>; a cleared bit announces
// the RELEASE form. Both are a type-3 system line and a notice.
export function abnormalSnapshotNotices(previousMask:number,records:readonly AbnormalRecord[]):readonly SystemNotice[]{
 const mask=records.reduce((bits,record)=>bits|(2**record.bit),0)>>>0;
 const notices:SystemNotice[]=[];
 for(let bit=0;bit<32;bit++){
  const value=2**bit,code=statusCodes()[bit];
  if(!code)continue;
  const was=(previousMask&value)!==0,now=(mask&value)!==0;
  if(now&&!was)notices.push({key:'UIIT_MSG_STATE_SKILL_CURSING_'+code,value:0,nativeType:3,banner:true});
  else if(was&&!now)notices.push({key:'UIIT_MSG_STATE_SKILL_CURSING_RELEASE_'+code,value:0,nativeType:3,banner:true});
 }
 return notices;
}
