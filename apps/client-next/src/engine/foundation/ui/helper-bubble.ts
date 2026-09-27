import type {TooltipRow} from './tooltip-rows';
import {textLines} from './text-lines';
import type {UiQuad,UiRect} from '@/engine/contracts/ui';
// CIFWnd+0x210 bindings installed by 6AC4D0, 573530, 54A5A0 and 6B4800.
export function hudTooltipKey(id:string,avatarView=false,blockTab=0):string|undefined {
 if(id==='equipment-view')return avatarView?'UIIT_STT_AVATAR_VIEW_EQUIPSLOT':'UIIT_STT_AVATAR_VIEW_AVATARSLOT';
 if(id==='blocking-help')return blockTab===0?'UIIT_STT_CHATING_SHUT_SAVE_SERVER_HELP':'UIIT_STT_CHATING_SHUT_SAVE_PC_HELP';
 const page=id.startsWith('select-window:')?id.slice(14):undefined;
 if(page)return ({Character:'UIIT_STT_TOGGLE_CHARACTER',Inventory:'UIIT_STT_TOGGLE_INVENTORY',Skills:'UIIT_STT_TOGGLE_SKILL',Actions:'UIIT_STT_TOGGLE_ACTION',Party:'UIIT_STT_TOGGLE_PARTY',Quests:'UIIT_STT_TOGGLE_QUEST',Academy:'UIIT_CTL_TC_SHORTKEY_L','Character-stats':'UIIT_STT_TOGGLE_CHARACTER'} as Record<string,string>)[page];
 return ({'open-window:Party Matching':'UIIT_STT_TOGGLE_PARTYMATCH','guild-dialog:donate':'UIIT_MSG_GUILD_SP_GP_TOOLTIP','ability-details':'UIIT_STT_CHARACTER_ABILITY_VIEW_OFF','chat-hide':'UIIT_STT_CHATING_VIEW_OFF','chat-whispers':'UIIT_CTL_WHISPER_LIST','chat-size':'UIIT_STT_TOGGLE_CHATING_WINDOW_SETING','status-size':'UIIT_STT_TOGGLE_CHATING_WINDOW_SETING','status-filter':'UIIT_PAG_CHATTING_SYS_MSG_FILTER','hud-menu':'UIIT_STT_TOGGLE_MENU','toggle-window:Guild':'UIIT_STT_TOGGLE_COMMUNITY','toggle-window:System':'UIIT_PAG_SYSTEM','item-mall':'UIIT_STT_SILKMALL_SHORT_KEY','toggle-window:Map':'UIIT_STT_TOGGLE_WORLD_MAP'} as Record<string,string>)[id];
}
export function helperBubble(value:string,anchor:UiRect,viewport:UiRect,measure:(s:string,strong?:boolean)=>number){
 return tooltipBubble([{value,color:0xffffffff}],anchor,viewport,measure);
}
export function tooltipBubble(rows:readonly TooltipRow[],anchor:UiRect,viewport:UiRect,measure:(s:string,strong?:boolean)=>number){
 const gutter=Math.ceil(12/Math.max(1,measure(' ')))+1;
 const expanded=rows.flatMap(row=>textLines((row.ornament?' '.repeat(gutter):'')+row.value,200,s=>measure(s,row.strong),true).map((value,index)=>({...row,value,ornament:index===0?row.ornament:undefined})));
 const lines=expanded.map(row=>row.value);
 const width=Math.max(1,...expanded.map(row=>measure(row.value,row.strong))),pitch=lines.length===1?14:18,height=lines.length*pitch;
 // 6791C0: right side +8, otherwise left side -8; bottom margin 15.
 const x=anchor[0]+anchor[2]+width+20<=viewport[2]?anchor[0]+anchor[2]+8:anchor[0]-width-8;
 const y=Math.min(anchor[1]+8,viewport[3]-height-15),r:UiRect=[x,y,width,height];
 const root='/assets/images/Media_extracted/interface/ifcommon/',corner=root+'com_tooltip_corner.png',edge=root+'com_tooltip_edge.png';
 const quads:UiQuad[]=[{rect:r,clip:viewport,texture:'',uv:[0,0,1,1],color:[26/255,35/255,69/255,181/255]}];
 const add=(texture:string,rect:UiRect,uv:UiRect,uvTurn:0|1|2|3=0,alpha=196/255,sampling:UiQuad['sampling']='nearest')=>quads.push({rect,texture,uv,uvTurn,sampling,clip:viewport,color:[1,1,1,alpha]});
 // 6791C0 overrides constructor alpha 128 with 196 in BOTH display branches.
 // 679190 -> 6FB700 -> 6FB030 consumes that live CTextBoard alpha.
 // modulates only the stretch border. Fill (181), text and child ornaments are independent.
 // 6FB0D6..6FB10D selects POINT for MINFILTER/MAGFILTER; restore is
 // local to that draw in native. Keep the sampling choice on each border quad.
 // 8px outset, corner UV variant 0, edge UV variant 1.
 add(corner,[x-8,y-8,8,8],[0,0,1,1]);add(corner,[x+width,y-8,8,8],[1,0,-1,1]);add(corner,[x+width,y+height,8,8],[1,1,-1,-1]);add(corner,[x-8,y+height,8,8],[0,1,1,-1]);
 add(edge,[x-8,y,8,height],[0,0,1,1]);add(edge,[x,y-8,width,8],[0,0,1,1],1);add(edge,[x+width,y,8,height],[1,1,-1,-1]);add(edge,[x,y+height,width,8],[0,0,1,1],3);
 const paths=[corner,edge];
 for(const [index,row]of expanded.entries())if(row.ornament){const texture=root+(row.ornament==='item'?'com_itemsign.png':'com_diamond.png');paths.push(texture);add(texture,[x,y+index*pitch,12,12],[0,0,1,1],0,1,'linear');}
 return {paths,quads,lines:lines.map((value,i)=>({...expanded[i]!,value,rect:[x,y+i*pitch,width,pitch] as UiRect}))};
}
