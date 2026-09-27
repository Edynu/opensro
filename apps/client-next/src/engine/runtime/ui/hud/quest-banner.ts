import type {QuestProgressEvent} from '@/engine/contracts/gameplay';
import type {SystemNotice} from '@/engine/foundation/gameplay/system-notices';
import {questProgressText} from '@/engine/foundation/ui/quest-presentation';

export const questBannerPaths=['corner','edge','edge2'].map(part=>`/assets/images/Media_extracted/interface/ifcommon/com_quest_${part}.png`);
// Independent CIFNotify child 42. The quest owner supplies ordered transitions;
// this adapter localizes them once, even when no journal window is admitted.
export function createQuestBanner(banner:{reset():void;step(notices:readonly SystemNotice[],now:number,ready:boolean):boolean;value(copy:(key:string)=>string):string;alpha():number}){
 let observed=0,observedNotice=0,sequence=0;
 return {
  reset(){observed=0;observedNotice=0;sequence=0;banner.reset();},
  step(events:readonly QuestProgressEvent[],now:number,entries:Readonly<Record<string,string>>|undefined,ready:boolean,authored:readonly SystemNotice[]=[],seconds:readonly number[]=[],copy:(key:string)=>string=()=> ''){
   const notices:SystemNotice[]=[];
   if(entries&&ready)for(const event of events)if(event.sequence>observed){
    observed=event.sequence;const text=questProgressText(event,entries);
    if(text)notices.push({sequence:++sequence,key:'',value:0,text,banner:true});
   }
   if(entries&&ready){
    for(const row of authored)if(row.questBanner&&(row.sequence??0)>observedNotice){observedNotice=row.sequence!;const text=row.text??entries[row.key]??copy(row.key);if(text)notices.push({sequence:++sequence,key:'',value:0,text,banner:true});}
    for(const value of seconds){const text=copy('UIIT_MSG_QUEST_INS_TIMEOUT').replace('%d',String(value));if(text)notices.push({sequence:++sequence,key:'',value:0,text,banner:true});}
   }
   return banner.step(notices,now,!!entries&&ready);
  },
  value:()=>banner.value(()=>'%s'),alpha:banner.alpha,
 };
}
