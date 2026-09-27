import {barChrome} from './bar';
import {matchingSlots} from './matching-slots';
import type {AuthoredLayout} from './authored-layout';
import {authoredRect} from './authored-layout';
import {frameParts,frameRing} from './frame-ring';
import {normalTile} from './normal-tile';
import {comboBoxChrome} from './combo-box';
import {stretchRing} from './stretch-ring';
import type {UiRect,UiQuad,UiControl} from '@/engine/contracts/ui';
import {academyCanJoin,type AcademyState} from '@/engine/foundation/gameplay/academy';
import type {GlyphStyle} from '@/engine/foundation/rendering/ui-glyphs';
export function academyLayout(data:{mentor:AuthoredLayout;mentorSlot:AuthoredLayout;strings:Readonly<Record<string,string>>},state:AcademyState,selected:number,x:number,y:number,clip:UiRect,size:(path:string)=>readonly[number,number]|undefined,text:(s:string,r:UiRect,c:UiRect,color:UiQuad['color'],style?:GlyphStyle)=>readonly UiQuad[],hover:string|null,pressed:string|null,filter={name:'',grade:5,kind:2,open:0},level?:number){
 const quads:UiQuad[]=[],controls:UiControl[]=[],paths:string[]=[],white=[1,1,1,1] as const;
 const image=(path:string,r:UiRect)=>{paths.push(path);if(size(path))quads.push({rect:r,clip,texture:path,uv:[0,0,1,1],color:white});};
 const bindings:Record<string,string>={GDR_MENTORMATCH_JOIN_BTN:'academy-join',GDR_MENTORMATCH_UPDATE_BTN:'academy-refresh',GDR_MENTORMATCH_SEARCH_BTN:'academy-search',GDR_MENTORMATCH_WHISPER_BTN:'academy-whisper'};
 const background=(type:string)=>['CIFFrame','CIFStretchWnd','CIFNormalTile'].includes(type)?0:1;
 for(const node of Object.values(data.mentor).sort((a,b)=>background(a.type)-background(b.type))){
  const r=authoredRect(node,x,y);if(node.name.includes('REGISTER')&&node.type!=='CIFButton'||node.name.includes('JOIN_PROGRESS')||node.type==='CIFMentorMatchSlot')continue;
  if(node.type==='CIFStretchWnd'){
   const ring=stretchRing(r,node.texture,size,clip);paths.push(...ring.paths);quads.push(...ring.quads);
  }else if(node.type==='CIFFrame'){
   const parts=frameParts().map(p=>node.texture+p+'.png');paths.push(...parts);quads.push(...frameRing(r,node.texture,parts.map(size),clip));
  }else if(node.type==='CIFNormalTile'){paths.push(node.texture);quads.push(...normalTile(r,node.texture,size(node.texture),clip));}
  else if(node.type==='CIFButton'){
   const header=node.name.startsWith('GDR_MENTORMATCH_SLOTLIST_'),id=bindings[node.name]??(header?'academy-sort:'+node.name.replace('GDR_MENTORMATCH_SLOTLIST_',''):undefined),disabled=!id||!!state.request||id==='academy-join'&&!academyCanJoin(state,selected,level)||id==='academy-whisper'&&!state.rows.some(row=>row.id===selected);
   const variants=(header?['','_focus','_press','']:['','_focus','_press','_disable']).map(s=>node.texture.replace('.png',s+'.png'));paths.push(...variants);
   image(variants[disabled?3:pressed===id?2:hover===id?1:0]!,r);
   quads.push(...text(data.strings[node.text]??node.text,r,r,disabled?[.5,.5,.5,1]:node.color,{fontIndex:node.fontIndex,hAlign:1,vAlign:1}));
   if(id)controls.push({id,label:data.strings[node.text]??node.text,kind:'button',rect:r,disabled});
  }else if(node.type==='CIFStatic'||node.type==='CIFBarWnd'){
   if(node.type==='CIFBarWnd'&&node.texture){const bar=barChrome(r,node.texture,size,clip);paths.push(...bar.paths);quads.push(...bar.quads);}
   if(node.texture&&node.texture.endsWith('.png'))image(node.texture,r);
   if(node.text&&!node.name.endsWith('DUMY'))quads.push(...text(data.strings[node.text]??node.text,r,clip,node.color,{fontIndex:node.fontIndex,hAlign:node.hAlign,vAlign:node.vAlign}));
  }
 }
 for(const {row,rect:r} of matchingSlots(data.mentor,'CIFMentorMatchSlot',state.rows,x,y)){
  const [sx,sy]=r;
  // 675690 switches the bound row between normal and selected bar skins;
  // an unselected row is not an absent background.
  const prefix='/assets/images/Media_extracted/interface/ifcommon/com_bar01'+(row&&row.id===selected?'select':'')+'_';
  const bar=barChrome(r,prefix,size,clip);paths.push(...bar.paths);quads.push(...bar.quads);
  if(!row)continue;
  const id='academy-row:'+row.id;
  const values:Record<string,string>={ID:String(row.id),LEVEL:String(row.level),NAME:row.name,SUBJECT:row.detail,STUDENT:String(row.graduates),NUMBER:String(row.students),GRADE_NUM:String(row.grade)};
  for(const [suffix,value]of Object.entries(values)){const n=data.mentorSlot['GDR_MENTORMATCH_SLOT_'+suffix];if(n)quads.push(...text(value,authoredRect(n,sx,sy),r,n.color));}
  controls.push({id,label:row.name+': '+row.detail,kind:'button',rect:r,selected:selected===row.id});
 }
 const root='/assets/images/Media_extracted/interface/ifcommon/';
 const edit=authoredRect(data.mentor.GDR_MENTORMATCH_SEARCH_NAME_EDIT!,x,y);controls.push({id:'academy-name',label:data.strings.UIIT_CTL_PARTYMATCH_PSEARCH_NAME??'Name',kind:'text',rect:edit,value:filter.name,maxLength:64});quads.push(...text(filter.name,edit,edit,white,{overflow:'clip'}));
 for(const [id,dx,skin,disabled]of [['academy-prev',360,'left',!!state.request||state.page===0],['academy-next',394,'right',!!state.request||state.page+1>=state.pages]] as const){const paths4=['','_focus','_press','_disable'].map(s=>root+'com_'+skin+'_arrow'+s+'.png');paths.push(...paths4);const r:UiRect=[x+dx,y+437,16,16];image(paths4[disabled?3:pressed===id?2:hover===id?1:0]!,r);controls.push({id,label:skin==='left'?'Previous page':'Next page',kind:'button',rect:r,disabled});}
 quads.push(...text(String(state.page+1),[x+376,y+441,18,12],clip,white,{fontIndex:2,hAlign:1}));
 for(const which of [1,2]){
  const node=data.mentor['GDR_MENTORMATCH_SEARCH_COMBOBOX'+which]!,r=authoredRect(node,x,y),options=which===1?['1','2','3','4','5',data.strings.UIIT_STT_OBJECTALL??'All']:[data.strings.UIIT_STT_TC_STUDENT??'Student',data.strings.UIIT_STT_TC_ASSISTANT_GUARDIAN??'Assistant guardian',data.strings.UIIT_STT_OBJECTALL??'All'];
  const combo=comboBoxChrome(r,size,clip,pressed==='academy-combo:'+which?2:hover==='academy-combo:'+which?1:0);paths.push(...combo.paths);quads.push(...combo.quads);quads.push(...text(options[which===1?filter.grade:filter.kind]??'',combo.textRect,r,white,{hAlign:1,vAlign:1}));controls.push({id:'academy-combo:'+which,label:which===1?'Honor class':'Recruitment type',kind:'button',rect:r});
  if(filter.open===which){const box:UiRect=[r[0],r[1]+r[3],r[2],options.length*20];quads.push({rect:box,clip,texture:'',uv:[0,0,1,1],color:[0,0,0,1]});options.forEach((value,i)=>{const row:UiRect=[box[0],box[1]+i*20,box[2],20];quads.push(...text(value,[row[0]+5,row[1],row[2]-10,row[3]],row,white,{vAlign:1}));controls.push({id:'academy-option:'+which+':'+i,label:value,kind:'button',rect:row,selected:i===(which===1?filter.grade:filter.kind)});});}
 }
 return {quads,controls,paths};
}
