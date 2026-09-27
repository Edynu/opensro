import type {QuestRecord,QuestMarker} from '@/engine/contracts/gameplay';
// 788210 / 787AC0 deserialize into the existing object and tag-keyed map.
// Construct detached values before the owner commits; flags are delta presence.
export function mergeQuest(previous:QuestRecord|undefined,delta:QuestRecord):QuestRecord{
 const contents=new Map(previous?.contents.map(c=>[c.tag,c]));
 for(const c of delta.contents)contents.set(c.tag,c);
 const targetIds=[...(delta.flags&4?previous?.targetIds??[]:[]),...delta.targetIds];
 if(targetIds.length>65535)throw Error('Quest target residency budget');
 return {...delta,progress:delta.flags&4?delta.progress:previous?.progress,u10:delta.flags&8?delta.u10:previous?.u10,contents:[...contents.values()].sort((a,b)=>a.tag-b.tag),targetIds};
}
// Native 75c370 (B29A) / 75c3d0 (B1EB): success carries u32,
// refusal carries u8, other result flags carry no body. Validate before mutation.
export function decodeQuestAcknowledgement(p:Uint8Array):number{
 if(p.length!==(p[0]===1?5:p[0]===2?2:1))throw Error('Invalid quest acknowledgement');
 return p[0]!;
}
// Server quest/wire.go pins 31ED and SQuestInfo to native 75c1d0/788210.
export function decodeQuest(p:Uint8Array):{op:number;refId:number;record?:QuestRecord}{
 const v=new DataView(p.buffer,p.byteOffset,p.byteLength);let o=0;function take(n:number){if(o+n>p.length)throw new Error('Truncated quest update');const at=o;o+=n;return at;}
 const u8=()=>v.getUint8(take(1)),u32=()=>v.getUint32(take(4),true);const op=u8(),refId=u32();if(!refId||op<1||op>4)throw new Error('Invalid quest update');
 let record:QuestRecord|undefined;
 if(op<=2){const u08=u8(),u09=u8(),flags=u8(),progress=flags&4?u32():undefined,u10=flags&8?u8():undefined,contents:QuestRecord['contents'][number][]=[],targetIds:number[]=[];
 if(flags&16){const n=u8();for(let i=0;i<n;i++){const tag=u8(),kind=u8(),len=v.getUint16(take(2),true);if(len>4096)throw new Error('Quest description budget');const at=take(len),description=new TextDecoder('utf-8',{fatal:true}).decode(p.subarray(at,at+len)),count=u8(),objectiveValues:number[]=[];if(count!==255)for(let j=0;j<count;j++)objectiveValues.push(u32());contents.push({tag,kind,description,objectiveSentinel:count===255,objectiveValues});}}
 if(flags&64){const n=u8();for(let i=0;i<n;i++)targetIds.push(u32());}record={refId,u08,u09,flags,progress,u10,contents,targetIds};}
 if(o!==p.length)throw new Error('Quest trailing bytes');return {op,refId,record};
}
export function admitQuest(value:unknown):QuestRecord{
 const r=value as QuestRecord;function uint(n:unknown,max:number):number{if(typeof n!=='number'||!Number.isInteger(n)||n<0||n>max)throw new Error('Invalid quest field');return n;}
 const refId=uint(r?.refId,0xffffffff);if(!refId)throw new Error('Invalid quest reference');const u08=uint(r.u08,255),u09=uint(r.u09,255),flags=uint(r.flags,255);
 const contents:QuestRecord['contents'][number][]=[],targetIds:number[]=[];
 if(flags&16){if(r.contents!==undefined&&(!Array.isArray(r.contents)||r.contents.length>255))throw new Error('Quest content budget');for(const c of r.contents??[]){if(typeof c.description!=='string'||new TextEncoder().encode(c.description).length>4096)throw new Error('Quest description budget');const values=c.objectiveValues??[];if(!Array.isArray(values)||values.length>254)throw new Error('Quest objective budget');contents.push({tag:uint(c.tag,255),kind:uint(c.kind,255),description:c.description,objectiveSentinel:c.objectiveSentinel===true,objectiveValues:c.objectiveSentinel?[]:values.map(n=>uint(n,0xffffffff))});}}
 if(flags&64){if(r.targetIds!==undefined&&(!Array.isArray(r.targetIds)||r.targetIds.length>255))throw new Error('Quest target budget');for(const n of r.targetIds??[])targetIds.push(uint(n,0xffffffff));}
 return {refId,u08,u09,flags,progress:flags&4?uint(r.progress??0,0xffffffff):undefined,u10:flags&8?uint(r.u10??0,255):undefined,contents,targetIds};
}

export function admitQuestMarker(value:unknown):QuestMarker{
 const r=value as QuestMarker;
 function uint(n:unknown,max:number):number{if(typeof n!=='number'||!Number.isInteger(n)||n<0||n>max)throw Error('Invalid quest marker field');return n;}
 const refId=uint(r?.refId,0xffffffff),flags=uint(r?.flags,255);
 if(!refId||!Array.isArray(r.tail6)||r.tail6.length!==6)throw Error('Invalid quest marker record');
 return {refId,flags,valueA:uint(r.valueA,255),word:uint(r.word,65535),tail6:r.tail6.map(n=>uint(n,255)),optional:flags&2?uint(r.optional??0,0xffffffff):undefined};
}
export function decodeQuestMarker(p:Uint8Array):QuestMarker{
 if(p.length<14||p.length!==(p[4]!&2?18:14))throw Error('Invalid quest marker packet');
 const v=new DataView(p.buffer,p.byteOffset,p.byteLength);
 return admitQuestMarker({refId:v.getUint32(0,true),flags:p[4],valueA:p[5],word:v.getUint16(6,true),tail6:[...p.subarray(8,14)],optional:p[4]!&2?v.getUint32(14,true):undefined});
}
// 856500: 1/default=start, 2=going, 3=end, 4=alternate mark.
export function questMarkerEffect(state:number):number{return state===2?0x8000001c:state===3?0x8000001b:state===4?0x80000027:0x8000001a;}
