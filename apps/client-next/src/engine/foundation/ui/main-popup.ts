import type {AuthoredControl,AuthoredLayout} from './authored-layout';
import {authoredRect} from './authored-layout';
import type {UiRect} from '@/engine/contracts/ui';
export type MainPopupPage='Inventory'|'Character'|'Skills'|'Actions'|'Party'|'Quests'|'Academy';
// CIFMainPopup::ShowTab (589960): one shared static, with two explicit
// geometry overrides. Other pages hide it. This is not a frame-wide fill.
export function mainPopupPresentation(page:MainPopupPage,layout:AuthoredLayout,x:number,y:number){
const panes={Inventory:'GDR_INVENTORY',Character:'GDR_PLAYERINFO',Skills:'GDR_SKILL',Actions:'GDR_ACTION',Party:'GDR_PARTY',Quests:'GDR_QUEST',Academy:'GDR_APPRENTICESHIP'} as const;
const captions={Inventory:'UIIT_STT_INVENTORY',Character:'UIIT_STT_CHARACTER',Skills:'UIIT_STT_SKILL',Actions:'UIIT_STT_ACTION',Party:'UIIT_STT_PARTY',Quests:'UIIT_STT_QUEST',Academy:'UIIT_CTL_TC_TRAININGCAMP'} as const;
 const pane=layout[panes[page]];
 if(!pane)throw Error('Missing native main-popup pane '+panes[page]);
 const source=layout.GDR_MAINPOPUP_BG_TILE;
 if(!source)throw Error('Missing native main-popup backing');
 const backing:AuthoredControl|null=page==='Inventory'?{...source,rect:[189,68,9,292]}:page==='Actions'?{...source,rect:[40,154,308,124]}:null;
 return {caption:captions[page],pane:authoredRect(pane,x,y),backing};
}

export function isMainPopupPage(page:string):page is MainPopupPage{return ['Character','Inventory','Skills','Actions','Party','Quests','Academy'].includes(page);}
export function mainPopupFrame(width:number,height:number,position:readonly number[]|null):UiRect{
 const x=Math.max(42,Math.min(Math.max(42,width-388),position?.[0]??width-388));
 const y=Math.max(0,Math.min(Math.max(0,height-408),position?.[1]??height-478));
 return [x,y,388,408];
}
export function mainPopupGeometry(page:MainPopupPage,layout:AuthoredLayout,width:number,height:number,position:readonly number[]|null){
 const frame=mainPopupFrame(width,height,position);
 return {...mainPopupPresentation(page,layout,frame[0],frame[1]),frame};
}
