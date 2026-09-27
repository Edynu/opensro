import type {EntityState} from '@/engine/contracts/world';
import type {AuthoredControl,AuthoredLayout} from './authored-layout';
const root='/assets/images/Media_extracted/interface/';
function monsterGrade(grade:number){const grades:Readonly<Record<number,readonly[string,string,number]>>={0:['normal','UIIT_CTL_WARENETWORK_DETAIL_NORMAL',1],1:['champion','UIIT_STT_MOB_CHAMPION',2],3:['unique','UIIT_STT_MOB_UNIQUE',1],4:['giant','UIIT_STT_MOB_GIANT',20],5:['titan','UIIT_STT_MOB_TITAN',100],6:['elite','UIIT_STT_MOB_ELITE',4]};return grades[grade];}
export function targetDifficulty(targetLevel:number,localLevel:number){const d=targetLevel-localLevel;return d<=-7?0:d<=-4?1:d<=0?2:d<=5?3:4;}
export function monsterMaximumHp(entity:EntityState){const factor=monsterGrade(entity.rarity??0)?.[2];return entity.maxHp===undefined||factor===undefined?undefined:entity.maxHp*factor*(entity.rarityAuxIcon===1?10:1);}
// 5814d0 selects one child, centers its actual width and uses y=7. Child
// layout mutations are values; authored resources remain immutable.
export function targetStatus(layouts:Readonly<Record<string,AuthoredLayout>>,entity:EntityState,localLevel:number,hp:number|undefined,copy:(key:string)=>string,measure:(value:string)=>number,previousGradeIcon:string){
 const images:{node:AuthoredControl;fraction?:number}[]=[],texts:{node:AuthoredControl;value:string}[]=[];
 const roots=layouts.iftargetwindow!;let width=196,height=51,frame=roots.GDR_TW_COMMONENEMY!,gradeIcon=previousGradeIcon;
 const change=(node:AuthoredControl,fields:Partial<AuthoredControl>)=>({...node,...fields});
 const texture=(node:AuthoredControl,path:string)=>change(node,{texture:root+path+'.png',uv:[0,0,1,1]});
 const put=(node:AuthoredControl,value:string)=>texts.push({node,value});
 if(entity.kind==='monster'){
  height=78;frame=roots.GDR_TW_SPECIALMOBWND!;const p=layouts.iftw_specialmob!,grade=monsterGrade(entity.rarity??0),difficulty=targetDifficulty(entity.level??localLevel,localLevel);
  const gems=['weak2','weak1','normal','strong1','strong2'],colors=[0x87d2ff,0xa5e0ce,0xffffff,0xffb387,0xff8787],color=colors[difficulty]!;
  images.push({node:texture(p.GDR_TWSM_GEM!,'targetwindow/tw_gem_'+gems[difficulty])});
  put(change(p.GDR_TWSM_TEXT_ID!,{color:[(color>>>16)/255,((color>>>8)&255)/255,(color&255)/255,1]}),entity.name);
  put(p.GDR_TWSM_LEVEL!,'Lv '+(entity.level??0));
  if(grade)gradeIcon=root+'targetwindow/tw_icon_'+grade[0]+'.png';
  let title=grade?copy(grade[1]):'';if(entity.rarityAuxIcon===1)title+=copy('UIIT_STT_PARTYMOB_TARGET');
  let icon=p.GDR_TWSM_ICON!,titleNode=p.GDR_TWSM_TEXT_LEV!;
  if(entity.rarityAuxIcon===1&&(entity.rarity??0)!==0){const x=Math.trunc((196-measure(title))/2)+(gradeIcon?10:0);titleNode=change(titleNode,{rect:[x,56,168,12]});icon=change(icon,{rect:[x-20,56,16,16]});}
  if(gradeIcon)images.push({node:change(icon,{texture:gradeIcon,uv:[0,0,1,1]})});put(titleNode,title);
  const max=monsterMaximumHp(entity);if(hp!==undefined&&max)images.push({node:p.GDR_TWSM_GAUGE_HPGAUGE!,fraction:Math.max(0,Math.min(1,hp/max))});
 }else if(entity.kind==='player'){
  const job=entity.jobType??4,working=job!==4&&job!==0,p=layouts[working?'iftw_jobplayer_trijob2':'iftw_player']!;
  height=working?58:36;frame=roots[working?'GDR_TW_JOB_PLAYERWND':'GDR_TW_PLAYERWND']!;
  const race=entity.countryByte9c,kindred=p[working?'GDR_TWJP_KINDRED_MARK':'GDR_TW_KINDRED_MARK']!;
  if(race===0||race===1)images.push({node:texture(kindred,'ifcommon/com_kindred_'+(race===0?'china':'europe'))});
  put(p[working?'GDR_TWJP_JOB_ALIAS':'GDR_TWP_TEXT_NAME']!,entity.name);
  if(working){const jobName=['','merchant','thief','hunter'][job];if(jobName){images.push({node:texture(p.GDR_TWJP_JOB_ICON!,'targetwindow/tw_job_'+jobName)});const grade=entity.jobGrade??0;put(p.GDR_TWJP_JOB_GRADENAME!,copy('UIIT_STT_CLASS_'+(race===1?'EU_':'')+jobName.toUpperCase()+'_'+grade));put(p.GDR_TWJP_JOB_GRADE!,grade+copy('UIIT_STT_GRADE'));}}
 }else if(entity.kind==='npc'||entity.kind==='cos'){
  const p=layouts.iftw_commonenemy!,flags=entity.tidWord??0,compact=entity.kind==='cos'&&(flags&0x7fe)===0x1c6&&[3,4,5].includes(flags>>>11);
  let nameWidth=137,gaugeWidth=168;
  if(entity.kind==='npc'){width=236;nameWidth=177;gaugeWidth=208;frame=change(frame,{uv:[.723632991,.220703006,.95410198-.723632991,.320313007-.220703006]});}
  else if(compact){height=36;nameWidth=122;frame=change(frame,{uv:[.53027302,.644531012,.721678972-.53027302,.714842975-.644531012]});}
  images.push({node:texture(p.GDR_TWCE_GEM!,'targetwindow/tw_gem_'+(entity.kind==='cos'?'animal':'player'))});
  put(change(p.GDR_TWCE_TEXT_ID!,{rect:[34,10,nameWidth,12]}),entity.name);
  if(!compact&&hp!==undefined&&entity.maxHp)images.push({node:change(p.GDR_TWCE_GAUGE_HPGAUGE!,{rect:[14,37,gaugeWidth,4]}),fraction:Math.max(0,Math.min(1,hp/entity.maxHp))});
 }else return null;
 images.unshift({node:change(frame,{rect:[0,0,width,height]})});
 const close=change(roots.GDR_TW_CLOSE!,{rect:[width-20,9,16,16],texture:root+'ifcommon/com_windowclose.png',uv:[0,0,1,1]});
 return {width,height,images,texts,close,gradeIcon};
}
