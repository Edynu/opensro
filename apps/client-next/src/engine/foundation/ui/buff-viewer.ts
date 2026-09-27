import type {AttachedEffect} from '../gameplay/attached-effects';
import type {SkillMetadata} from '../gameplay/skill-catalog';
import type {UiHelpSource} from '@/engine/contracts/ui';
import {abnormalIcon,buffTimerRoot} from './buff-board';
import {iconPath} from './icon';

// CIFBuffViewer (ctor 6DDCA0): the buff/abnormal row shared by the target
// window, the quick-party slots and the pet mini-info. Row caps of zero are
// unlimited; the target window never sets them (SetRowCaps 6DD0B0).
export interface BuffViewerLayout {readonly columns:number;readonly pitch:number;readonly cell:number;readonly primaryRows:number;readonly secondaryRows:number;}
export function targetBuffViewer():BuffViewerLayout{return {columns:8,pitch:23,cell:20,primaryRows:0,secondaryRows:0};}// 581410
export function partyBuffViewer():BuffViewerLayout{return {columns:6,pitch:15,cell:12,primaryRows:1,secondaryRows:1};}// 5BAD30

// One 8608A0 record: every skill decoration in state 2 (0xB419 / spawn, via
// 8DF220) or state 3 (0xB5ED detection, 8DF1C0, which also stores the name).
export interface BuffViewerEntry {readonly skill:number;readonly named:boolean;readonly suppressed:boolean;readonly effect:AttachedEffect;}
export interface BuffViewerSlot {readonly kind:'buff'|'abnormal';readonly id:number;readonly named:boolean;readonly gauge:boolean;readonly suppressed:boolean;readonly effect?:AttachedEffect;}
export interface BuffViewerState {readonly primary:readonly BuffViewerSlot[];readonly secondary:readonly BuffViewerSlot[];}
export type SkillLookup=(id:number)=>SkillMetadata|undefined;
export function emptyBuffViewer():BuffViewerState{return {primary:[],secondary:[]};}
// GlobalDataManager_GetRecordByHost: an id index over one admitted catalogue.
// Owners build it once per catalogue publication, never per frame.
export function skillLookup(catalog:readonly SkillMetadata[]|undefined):SkillLookup{
 const rows=new Map((catalog??[]).map(row=>[row.id,row]));
 return id=>rows.get(id);
}

// 85CE40: the carrier's detection levels per abnormal bit, maximised over
// every skill decoration with a nonzero dttp mask; null when there is none.
function detectionLevels(effects:readonly AttachedEffect[],skill:SkillLookup){
 let levels:number[]|null=null;
 for(const effect of effects){
  const detect=skill(effect.skill)?.detect;if(!detect?.mask)continue;
  levels??=Array<number>(32).fill(0);
  for(let bit=0;bit<32;bit++)if(detect.mask&2**bit)levels[bit]=Math.max(levels[bit]!,detect.level);
 }
 return levels;
}
// 8608A0: a hide buff is suppressed when detection covers it. Only the last
// hidden bit decides, and with no hidden level at all the flag stays set.
function hideSuppressed(hide:SkillMetadata['hide'],detection:readonly number[]|null){
 if(!hide||!detection)return false;
 let result=0;
 for(let bit=0;bit<32;bit++)if(hide.mask&2**bit&&hide.level)result=detection[bit]!>=hide.level?1:2;
 return result!==2;
}
export function collectActiveBuffs(effects:readonly AttachedEffect[],gid:number,skill:SkillLookup):readonly BuffViewerEntry[]{
 const owned=effects.filter(effect=>effect.gid===gid),detection=detectionLevels(owned,skill);
 return owned.filter(effect=>effect.skill>0&&effect.skill<=0x7fffffff).map(effect=>({skill:effect.skill,named:!!effect.subject,suppressed:hideSuppressed(skill(effect.skill)?.hide,detection),effect}));
}

function capacity(layout:BuffViewerLayout,rows:number){return rows?rows*layout.columns:Infinity;}
// 6DF560: named entries and non-bbuf skills join the primary list. A gauge is
// built for named entries (two-bar) or skills carrying lnks (+0x144).
function addBuff(state:BuffViewerState,layout:BuffViewerLayout,entry:BuffViewerEntry,skill:SkillLookup):BuffViewerState{
 const record=skill(entry.skill),primary=entry.named||!record?.buffSecondary;
 const slot:BuffViewerSlot={kind:'buff',id:entry.skill,named:entry.named,gauge:entry.named||!!record?.buffCancelInstance,suppressed:entry.suppressed,effect:entry.effect};
 if(primary)return state.primary.length<capacity(layout,layout.primaryRows)?{...state,primary:[...state.primary,slot]}:state;
 return state.secondary.length<capacity(layout,layout.secondaryRows)?{...state,secondary:[...state.secondary,slot]}:state;
}
// 6DF820: abnormal bits always join the secondary list, without gauge or overlay.
function addAbnormal(state:BuffViewerState,layout:BuffViewerLayout,bit:number):BuffViewerState{
 if(state.secondary.length>=capacity(layout,layout.secondaryRows))return state;
 return {...state,secondary:[...state.secondary,{kind:'abnormal',id:bit,named:false,gauge:false,suppressed:false}]};
}
function appendAbnormal(state:BuffViewerState,layout:BuffViewerLayout,mask:number){
 for(let bit=0;bit<32;bit++)if(mask&2**bit)state=addAbnormal(state,layout,bit);
 return state;
}
// 581410 / 5BAD30: a full rebuild in collection order, then abnormal bits.
// The speed pass is not run here; the next one-second tick applies it.
export function rebuildBuffViewer(layout:BuffViewerLayout,entries:readonly BuffViewerEntry[],mask:number,skill:SkillLookup):BuffViewerState{
 let state=emptyBuffViewer();
 for(const entry of entries)state=addBuff(state,layout,entry,skill);
 return appendAbnormal(state,layout,mask);
}
// 6DE630: speed buffs do not stack. Every primary hste/hst2 slot is
// suppressed, then the last one with a nonzero value is released.
function applySpeedSuppression<T extends {readonly kind:string;readonly id:number;readonly suppressed:boolean}>(slots:readonly T[],skill:SkillLookup):readonly T[]{
 let active=-1;
 const next=slots.map((slot,index)=>{
  const speed=slot.kind==='buff'?skill(slot.id)?.speedBuff:undefined;if(!speed)return slot;
  if(speed.active)active=index;
  return slot.suppressed?slot:{...slot,suppressed:true};
 });
 if(active>=0&&next[active]!.suppressed)next[active]={...next[active]!,suppressed:false};
 return next;
}
function take(list:BuffViewerEntry[],id:number){const index=list.findIndex(entry=>entry.skill===id);return index<0?undefined:list.splice(index,1)[0];}
// 6DFBA0, run once a second: surviving slots keep their place (keyed by
// skill, first match consumed), primaries refresh the suppressed flag,
// abnormal slots live while their bit is set, and newcomers are appended.
export function tickBuffViewer(layout:BuffViewerLayout,state:BuffViewerState,entries:readonly BuffViewerEntry[],mask:number,skill:SkillLookup):BuffViewerState{
 const pending=[...entries];
 const primary:BuffViewerSlot[]=[];
 for(const slot of state.primary){const entry=take(pending,slot.id);if(entry)primary.push({...slot,suppressed:entry.suppressed,effect:entry.effect});}
 const secondary:BuffViewerSlot[]=[];
 for(const slot of state.secondary){
  if(slot.kind==='abnormal'){if(mask&2**slot.id){secondary.push(slot);mask&=~(2**slot.id);}continue;}
  const entry=take(pending,slot.id);if(entry)secondary.push({...slot,effect:entry.effect});
 }
 let next:BuffViewerState={primary:applySpeedSuppression(primary,skill),secondary};
 for(const entry of pending)next=addBuff(next,layout,entry,skill);
 return appendAbnormal(next,layout,mask);
}
// 6DE330: no minimum primary row; the secondary group sits two pixels lower.
export function buffViewerCells(layout:BuffViewerLayout,state:BuffViewerState){
 const {columns,pitch}=layout,rows=state.primary.length?Math.floor((state.primary.length-1)/columns)+1:0;
 return [
  ...state.primary.map((slot,i)=>({slot,x:(i%columns)*pitch,y:Math.floor(i/columns)*pitch})),
  ...state.secondary.map((slot,i)=>({slot,x:(i%columns)*pitch,y:(Math.floor(i/columns)+rows)*pitch+2})),
 ];
}
// 6E64A0 / 6E2580: the local board takes each collected entry's flag for
// every slot of that skill, then applies the same speed rule over its list.
export function boardSuppression<T extends {readonly kind:string;readonly id:number;readonly suppressed:boolean}>(slots:readonly T[],entries:readonly BuffViewerEntry[],skill:SkillLookup):readonly T[]{
 let next=slots;
 for(const entry of entries)next=next.map(slot=>slot.kind==='buff'&&slot.id===entry.skill&&slot.suppressed!==entry.suppressed?{...slot,suppressed:entry.suppressed}:slot);
 return applySpeedSuppression(next,skill);
}

// A viewer owned by a window: rebuilt when its subject changes and ticked by
// the owner's one-second state timer (581330 / 5BA840).
export function createBuffViewer(layout:BuffViewerLayout){
 let gid=0,due=0,state=emptyBuffViewer();
 return {
  step(subject:number,nowMs:number,effects:readonly AttachedEffect[],mask:number,skill:SkillLookup):BuffViewerState{
   if(subject!==gid){gid=subject;due=nowMs+1000;state=subject?rebuildBuffViewer(layout,collectActiveBuffs(effects,subject,skill),mask,skill):emptyBuffViewer();}
   else if(subject&&nowMs>=due){due+=1000;if(due<=nowMs)due=nowMs+1000;state=tickBuffViewer(layout,state,collectActiveBuffs(effects,subject,skill),mask,skill);}
   return state;
  },
 };
}

// CIFStateSlot (6E7FA0 / 6E8410) drawn from a viewer cell. Viewer gauges are
// never fed, so CIFGauge keeps its constructed value of 1.0 (523440). The
// admittance tile and cross cover a suppressed buff at the cell size.
export interface BuffViewerIcon {readonly id:string;readonly path:string;readonly label:string;readonly x:number;readonly y:number;readonly size:number;readonly gauge:readonly string[];readonly overlay:readonly string[];readonly helpSource:UiHelpSource;}
export function admittanceOverlay(){return [buffTimerRoot+'s_admittance_back.png',buffTimerRoot+'s_admittance_icon.png'];}
export function buffViewerIcons(layout:BuffViewerLayout,state:BuffViewerState,gid:number,skill:SkillLookup,options:{readonly unlevelled?:boolean}={}):readonly BuffViewerIcon[]{
 return buffViewerCells(layout,state).map(({slot,x,y},index)=>{
  const common={x,y,size:layout.cell,id:index+':'+slot.kind+':'+slot.id};
  if(slot.kind==='abnormal')return {...common,...abnormalIcon(slot.id),gauge:[],overlay:[],helpSource:{kind:'abnormal',gid,bit:slot.id,...(options.unlevelled?{unlevelled:true}:{})}};
  const record=skill(slot.id),effect=slot.effect!;
  // 6E7FA0 two-bar slots overlay s_stateodd_time_gauge on the time02 control.
  const gauge=!slot.gauge?[]:[buffTimerRoot+'s_stateodd_time.png',buffTimerRoot+(slot.named?'s_stateodd_time02_gauge.png':'s_stateodd_time_gauge.png'),...(slot.named?[buffTimerRoot+'s_stateodd_time_gauge.png']:[])];
  return {...common,path:iconPath(record?.icon)??'',label:record?.name??'',gauge,overlay:slot.suppressed?admittanceOverlay():[],helpSource:{kind:'effect',gid,token:effect.token,skill:slot.id,viewer:true}};
 });
}
