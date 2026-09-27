import {textLines,textBoxParagraphs} from './text-lines';
import {chatScrollbar} from './chat-scrollbar';
import type {NpcConversation} from '@/engine/foundation/gameplay/npc-dialogue';
import type {AuthoredLayout} from './authored-layout';
import type {UiControl,UiQuad,UiRect} from '@/engine/contracts/ui';
// 5D31D0: signed difference of two level bytes. Only SN_ choices consult
// the quest by-code table; missing records keep the ordinary menu color.
export function npcChoiceColor(symbol:string,level:number,requiredLevel:(code:string)=>number|undefined):UiQuad['color'] {
 const required=symbol.startsWith('SN_')?requiredLevel(symbol.slice(3)):undefined;
 if(required!==undefined){const delta=(level&255)-(required&255);if(delta>=10)return [101/255,175/255,162/255,1];if(delta<0)return [1,74/255,74/255,1];}
 return [239/255,218/255,164/255,1];
}
// Hash-bound executable literals use STT; shipped textuisystem only contains
// CTL captions for these three identical actions. This is a named same-caption
// compatibility mapping, not evidence that native TextManager aliases them.
export function npcDialogueCaption(symbol:string,copy:(symbol:string)=>string):string {
 const value=copy(symbol);if(value)return value;
 switch(symbol){case 'UIIT_STT_YES':return copy('UIIT_CTL_YES');case 'UIIT_STT_NO':return copy('UIIT_CTL_NO');case 'UIIT_STT_CONFIRM':return copy('UIIT_CTL_CONFIRM');default:return '';}
}
// Disambiguate identical branch labels (e.g. unpatched official English "Purchase/sell/repair weapon")
// using regional group symbol naming conventions.
export function npcBranchLabel(branch:import('@/engine/foundation/gameplay/merchant-branches').MerchantBranch,branches:readonly import('@/engine/foundation/gameplay/merchant-branches').MerchantBranch[],copy:(symbol:string)=>string):string {
 const label=copy(branch.labelSymbol);
 if(branches.filter(b=>copy(b.labelSymbol)===label).length>1){
  if(branch.labelSymbol.includes('_EU_')||branch.labelSymbol.includes('EU_'))return `${label} (European)`;
  if(branch.labelSymbol.includes('_CH_')||branch.labelSymbol.includes('CH_')||branch.labelSymbol.includes('_GROUP'))return `${label} (Chinese)`;
 }
 return label;
}
// 5D4A10: font 0, 18px pitch, 19 visible lines. 5D5AE0 inserts the
// white prompt and one spacer; 5D60C0 adds numbered interactive rows.
export function npcTalkLayout(state:Exclude<NpcConversation,{phase:'closed'}>,layout:AuthoredLayout,origin:readonly[number,number],copy:(symbol:string)=>string,measure:(text:string)=>number,draw:(text:string,rect:UiRect,clip:UiRect,color:UiQuad['color'])=>UiQuad[],size:(path:string)=>readonly[number,number]|undefined,hover:string|null,pressed:string|null,top:number,canShop:boolean,branches:readonly import('@/engine/foundation/gameplay/merchant-branches').MerchantBranch[]=[],choiceColor:(symbol:string)=>UiQuad['color']=()=>[239/255,218/255,164/255,1],canPortal=false,portalRows:readonly {id:string;label:string}[]|null=null,canTalk=true,prompt="",canRecall=false){
 const box=layout.GDR_NT_TALKBOX!,scroll=layout.GDR_NPCTALK_SCROLL!;
 const bounds:UiRect=[origin[0]+box.rect[0],origin[1]+box.rect[1],box.rect[2],box.rect[3]];
 const rows:{text:string;id?:string;color:UiQuad['color']}[]=[],normal:UiQuad['color']=[239/255,218/255,164/255,1];
 const dialogue=state.phase==='menu'?null:state.dialogue;
 const wrap=(value:string)=>textBoxParagraphs(value).flatMap(paragraph=>textLines(paragraph,bounds[2],measure));
 if(!dialogue&&prompt){for(const text of wrap(prompt))rows.push({text,color:[1,1,1,1]});rows.push({text:"",color:normal});}
 if(dialogue){for(const text of wrap(copy(dialogue.prompt)))rows.push({text,color:[1,1,1,1]});rows.push({text:'',color:normal});}
 const options=dialogue?dialogue.options.map(r=>({id:'npc-choice:'+r.choice,label:npcDialogueCaption(r.symbol,copy)})):[...(portalRows??[...(canTalk?[{id:'npc-talk',label:copy('UIIT_STT_NPC_CHATTING_WND_TALKSTART')}]:[]),...(canShop?(branches.length?branches.map(branch=>({id:branches.length===1?'shop-open':'shop-group:'+branch.id,label:npcBranchLabel(branch,branches,copy)})):[{id:'shop-open',label:copy('UIIT_STT_NPC_CHATTING_WND_SHOP')}]):[]),...(canRecall?[{id:'npc-recall-designate',label:copy('UIIT_CTL_RECALL_POSITION')}]:[]),...(canPortal?[{id:'npc-portal-open',label:copy('UIIT_CTL_TELEPORT_TARGET')}]:[])]),{id:'npc-talkend',label:copy('UIIT_STT_NPC_CHATTING_WND_TALKEND')}];
 options.forEach((option,i)=>{const color=dialogue?choiceColor(dialogue.options[i]!.symbol):normal;for(const text of wrap(`${i+1}. ${option.label}`))rows.push({text,id:option.id,color});});
 if(rows.length>1024)throw Error('NPC text row capacity');
 const range=Math.max(0,rows.length-19),offset=Math.max(0,Math.min(range,Math.round(top))),quads:UiQuad[]=[],controls:UiControl[]=[];
 const busy=state.phase==='waiting'||state.phase==='uncertain';
  rows.slice(offset,offset+19).forEach((row,i)=>{const rect:UiRect=[bounds[0],bounds[1]+i*18,bounds[2],18],disabled=busy&&row.id!=='npc-talkend';
  const color=row.id&&(hover===row.id||pressed===row.id)&&!disabled?[1,138/255,0,1] as const:row.color;
  quads.push(...draw(row.text,rect,bounds,color));if(row.id){const index=controls.findIndex(c=>c.id===row.id),previous=controls[index];if(previous)controls[index]={...previous,label:previous.label+' '+row.text,rect:[previous.rect[0],previous.rect[1],previous.rect[2],rect[1]+18-previous.rect[1]]};else controls.push({id:row.id,label:row.text,rect,kind:'button',disabled});}
 });
 // 5D4A10/5D4BA0 -> 544C10: 320 is thumb travel, not outer height.
 // Native child offsets are up=-16, thumb=0, down=travel+16.
 const r:UiRect=[origin[0]+scroll.rect[0],origin[1]+scroll.rect[1],16,scroll.rect[3]];
 const bar=chatScrollbar('npc-scroll',r,rows.length,19,range-offset,size,bounds,hover,pressed);
 // Scroll chrome lies outside the text clip, inside the authored child window.
 const clip:UiRect=[origin[0],origin[1],364,391];
 quads.push(...bar.quads.map(q=>({...q,clip})));controls.push(...bar.controls);
 return {quads,controls,paths:bar.paths,bounds,range,travel:bar.travel};
}
