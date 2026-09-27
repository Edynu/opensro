import type {WireFrame} from '@/engine/contracts/network';
export interface GuideState {readonly seenMask:number;readonly event:number;readonly country:0|1;readonly pending?:readonly number[];}
export function queueGuide(state:GuideState|undefined,events:readonly number[]):GuideState|undefined{
 if(!state)return state;
 const pending=[...state.pending??[]];
 for(const event of events){if(!Number.isInteger(event)||event<1||event>21)throw Error('Invalid guide producer');if(!(state.seenMask&(1<<(event-1)))&&!pending.includes(event))pending.push(event);}
 return {...state,pending};
}
// 779620: actual level growth, then crossings of 19 (PK) and 20 (jobs).
export function guideLevelEvents(before:number|undefined,after:number):readonly number[]{
 if(before===undefined||after<=before)return [];
 return [8,...(before<19&&after>=19?[12]:[]),...(before<20&&after>=20?[13]:[])];
}
export function guideInventoryEvents(items:readonly {slot:number;refObjId:number;typeFlags:number}[],equipmentSlots:number,summons:ReadonlyMap<number,number>):readonly number[]{
 const events:number[]=[];
 for(const item of items){const f=item.typeFlags;
  if((f&0x7e)===0x2c){events.push(3);if(item.slot<equipmentSlots&&(f&0x780)===0x380){const job=f&0xf800;if(job===0x800)events.push(14);else if(job===0x1800)events.push(15);else if(job===0x1000)events.push(16);}}
  if((f&0xfffe)===0x11ec){const summoned=summons.get(item.refObjId);if(summoned!==undefined&&(summoned&0x7fe)===0x1c6){if((summoned&0xf800)===0x800)events.push(17);else if((summoned&0xf800)===0x1000)events.push(18);}}
 }
 return [...new Set(events)];
}
export function guideAbnormalEvent(payload:Uint8Array):readonly number[]{
 if(payload.length<4)throw Error('Truncated abnormal snapshot');const mask=new DataView(payload.buffer,payload.byteOffset,payload.byteLength).getUint32(0,true);let bits=0;for(let i=0;i<32;i++)if(mask&(1<<i))bits++;
 if(payload.length!==4+bits*5)throw Error('Invalid abnormal snapshot extent');return bits?[11]:[];
}
export function guideBootstrap(value:unknown):GuideState|undefined {
 const mask=(value as {eventGuideStateMask?:unknown}).eventGuideStateMask;
 if(mask===undefined)return undefined;
 if(typeof mask!=='number'||!Number.isInteger(mask)||mask<0||mask>0xffffffff)throw Error('Invalid event-guide mask');
 const country=(value as {localPlayerEntry?:{countryByte9c?:unknown}}).localPlayerEntry?.countryByte9c;
 if(country!==0&&country!==1)throw Error('Missing guide country authority');
 return {seenMask:mask,event:0,country};
}
// CICPlayer::EvalEventGuideState 863A00: bits are event ID minus one.
// No response packet exists: retain accepted state only after enqueue succeeds.
export function revealGuide(state:GuideState,event:number):{state:GuideState;frame:WireFrame}|null {
 if(!Number.isInteger(event)||event<1||event>21)throw Error('Invalid event-guide ID');
 const bit=1<<(event-1);if(state.seenMask&bit)return null;
 const seenMask=(state.seenMask|bit)>>>0,payload=new Uint8Array(4);new DataView(payload.buffer).setUint32(0,seenMask,true);
 return {state:{...state,seenMask,event,...(state.pending?{pending:state.pending.filter(id=>id!==event)}:{})},frame:{opcode:0x707b,payload}};
}
export function automaticGuide(mask:number,facts:{moved:boolean;regionId:number;monster:boolean;hp:number;maxHp:number}):number|null {
 const x=facts.regionId&255,y=(facts.regionId>>>8)&255;
 const novice=(x>=0xa7&&x<=0xa9&&(y===0x61||y===0x62))||(x>=0x4d&&x<=0x50&&y>=0x67&&y<=0x6b);
 let event:number|null=null;
 if(facts.moved&&!(mask&2))event=2;
 if(!novice&&!(mask&8))event=4;
 if(facts.monster&&!(mask&16))event=5;
 if(facts.maxHp>0&&facts.hp<=Math.floor(facts.maxHp/2)&&!(mask&64))event=7;
 return event;
}
