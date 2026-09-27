import type {CosRecord} from '@/engine/contracts/gameplay';

export function cosBehaviorRequest(record:CosRecord,mode:number){
    if(record.dead||record.hp===0||!Number.isInteger(mode)||mode<0||mode>0xffffffff||record.commandMode===undefined)throw Error('Invalid COS behavior command');
    if(record.band===3 ? mode>1 : record.band!==4||((mode^record.commandMode)&~0xc7)!==0)throw Error('Unsupported COS behavior transition');
    const payload=new Uint8Array(9),v=new DataView(payload.buffer);
    v.setUint32(0,record.gid,true);payload[4]=record.band===3?1:2;v.setUint32(5,mode,true);
    return {opcode:0x705b,payload};
}

// 778530 (B05B), 82D330/82D340: gold pet = band 3, cash pet = band 4.
// The dword at SCOSInfo+AB08 is command mode, not an owner account ID.
export function cosBehaviorResult(p:Uint8Array):
    {kind:'rejected';code:number}|{kind:'changed';gid:number;band:3|4;commandMode:number} {
    if(p[0]===2&&p.length===2)return {kind:'rejected',code:p[1]!};
    if(p[0]!==1||p.length!==10||(p[5]!==1&&p[5]!==2))throw Error('Invalid COS behavior result');
    const v=new DataView(p.buffer,p.byteOffset,p.byteLength),gid=v.getUint32(1,true);
    if(!gid)throw Error('Invalid COS behavior identity');
    return {kind:'changed',gid,band:p[5]===1?3:4,commandMode:v.getUint32(6,true)};
}

export function applyCosBehavior(record:CosRecord,result:Extract<ReturnType<typeof cosBehaviorResult>,{kind:'changed'}>):CosRecord {
    if(record.gid!==result.gid||record.band!==result.band)throw Error('COS behavior family mismatch');
    return {...record,commandMode:result.commandMode};
}
