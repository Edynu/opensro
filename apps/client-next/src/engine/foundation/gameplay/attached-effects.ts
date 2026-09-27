export interface AttachedEffect {readonly cancellationRequestedAtMs?:number;readonly gid:number;readonly skill:number;readonly token:number;readonly phase:number;readonly subject?:{readonly gid:number;readonly name:string};readonly extra?:number;readonly receivedAtMs?:number;readonly remainingMs?:number;readonly durationMs?:number;readonly restored?:boolean;readonly hawk?:{readonly revision:number;readonly target:number;readonly damage:number};}
// 74DC91 registers 357A -> 775510 -> 8E2D30: instance u32, target
// u32, packed damage u16. This is neither a cast nor an entity spawn.
export function hawkCommand(payload:Uint8Array){
 if(payload.length!==10)throw Error('Invalid summoned-hawk command');
 const view=new DataView(payload.buffer,payload.byteOffset,payload.byteLength);
 return {token:view.getUint32(0,true),target:view.getUint32(4,true),damage:view.getUint16(8,true)};
}
// 8E38A3: the high bit fills result+8 (fatal), not result+A (critical).
export function hawkResult(packed:number){return {type:0,flags:1,damage:packed&0x7fff,fatal:!!(packed&0x8000),secondaryAmount:0};}
export interface AttachedEffectReference {readonly linkedSkillId?:number;readonly cancellationDeferred?:boolean;readonly nameHit?:boolean;readonly status:boolean;readonly effectRider:boolean;readonly effectDurationMs?:number;readonly zeroEffectDuration?:boolean;readonly hideDetectionBuff?:boolean;readonly indefiniteBuffTimer?:boolean;readonly huntingPoint?:boolean;readonly stealthDuration?:boolean;}
export function attachedEffectReferences(rows:readonly ({id:number}&AttachedEffectReference)[]):ReadonlyMap<number,AttachedEffectReference>{
 const refs=new Map<number,AttachedEffectReference>();
 if(rows.length>65536)throw Error('Attached effect reference capacity exceeded');
 for(const row of rows){
  for(const field of ['status','effectRider'] as const)if(typeof row[field]!=='boolean')throw Error(`Invalid attached effect reference ${row.id}: ${field} must be boolean (received ${typeof row[field]})`);
  if(!Number.isInteger(row.id)||row.id<=0||row.id>0xffffffff||(row.effectDurationMs!==undefined&&(!Number.isInteger(row.effectDurationMs)||row.effectDurationMs<0||row.effectDurationMs>0xffffffff))||refs.has(row.id))throw Error('Invalid attached effect reference');
  for(const field of ['huntingPoint','stealthDuration','nameHit','zeroEffectDuration','hideDetectionBuff','indefiniteBuffTimer','cancellationDeferred'] as const)if(row[field]!==undefined&&typeof row[field]!=='boolean')throw Error('Invalid detection effect authority');
  if(row.linkedSkillId!==undefined&&(!Number.isInteger(row.linkedSkillId)||row.linkedSkillId<0||row.linkedSkillId>0xffffffff))throw Error('Invalid linked skill reference');
  refs.set(row.id,{linkedSkillId:row.linkedSkillId,cancellationDeferred:row.cancellationDeferred,hideDetectionBuff:row.hideDetectionBuff,indefiniteBuffTimer:row.indefiniteBuffTimer,zeroEffectDuration:row.zeroEffectDuration,nameHit:row.nameHit,status:row.status,effectRider:row.effectRider,huntingPoint:row.huntingPoint,stealthDuration:row.stealthDuration,...(row.effectDurationMs!==undefined?{effectDurationMs:row.effectDurationMs}:{})});
 }
 return refs;
}
// 776450: efta (+274) adds a byte; RPBU/STDU/DTDR (+2dc/+2ec/+300)
// add one u32 in total. Never infer skill configuration from packet length.
export function attachedEffect(payload:Uint8Array,refs:ReadonlyMap<number,AttachedEffectReference>):AttachedEffect {
 if(payload.length<12)throw Error('Invalid attached effect packet');
 const v=new DataView(payload.buffer,payload.byteOffset,payload.byteLength),ref=refs.get(v.getUint32(4,true));
 if(!ref)throw Error('Missing attached effect reference authority');
 const hasPhase=ref.status;
 if(payload.length!==12+Number(hasPhase)+4*Number(ref.effectRider))throw Error('Invalid attached effect packet');
 const gid=v.getUint32(0,true),skill=v.getUint32(4,true),token=v.getUint32(8,true),phase=hasPhase?v.getUint8(12):2;
 if(!gid||!skill)throw Error('Invalid attached effect identity');
 return {gid,skill,token,phase,...(payload.length>=16?{extra:v.getUint32(hasPhase?13:12,true)}:{})};
}
// 7759B0: count followed by instance tokens, not skill or entity IDs.
export function endedEffectTokens(payload:Uint8Array):readonly number[]{
 const count=payload[0];if(count===undefined||payload.length!==1+count*4)throw Error('Invalid effect teardown packet');
 const v=new DataView(payload.buffer,payload.byteOffset,payload.byteLength);
 return Array.from({length:count},(_,i)=>v.getUint32(1+i*4,true));
}

// 6E5D40 adds the rider to dura for newly applied local buff timers. Only
// server teardown retires an effect; an exhausted UI timer is not authority.
export function effectRemainingMs(effect:AttachedEffect,nowMs:number):number|null {
 return effect.remainingMs===undefined?null:Math.max(0,effect.remainingMs-Math.max(0,nowMs-(effect.receivedAtMs??nowMs)));
}
