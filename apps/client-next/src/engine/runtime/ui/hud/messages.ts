import {eligibleMessageTips,type MessageTip} from '@/engine/foundation/ui/message-tips';
import type {SystemNotice} from '@/engine/foundation/gameplay/system-notices';
import {noticeText} from '@/engine/foundation/ui/notice-text';
export {noticeText};
// 6B7AB4 rejects an empty C string before touching the native text box;
// 6B7B50 measures only through its first terminator.
const guideString=(value:string)=>value.split('\0',1)[0]!;
export function createHudMessages(choose:(count:number)=>number){
 let due:number|null=null,sequence=0;let rows:{value:string;category:string;colorArgb:number}[]=[];
 const category=(key:string,nativeType?:number)=>nativeType!==undefined?(['','gain','fight','status','party','game','','game'][nativeType]??''):['UIIT_MSG_STATE_GAIN_EXP_NEW','UIIT_MSG_STATE_LOSE_EXP_NEW','UIIT_MSG_STATE_GET_SKILL_EXP'].includes(key)?'gain':'game';
 return {
  append(value:string,colorArgb=0xffdbc99b){value=guideString(value);if(value)rows=[...rows.slice(-99),{value,category:'game',colorArgb}];},
  deadline:()=>due??0,
  reset(){due=null;sequence=0;rows=[];},
  step(now:number,tips:readonly MessageTip[],level:number,country:number|undefined,notices:readonly SystemNotice[],copy:(key:string)=>string,guides=true,filters?:ReadonlySet<string>){
   due??=now+60000;
   const project=(notice:SystemNotice)=>{
    const group=category(notice.key,notice.nativeType);
    if(notice.bannerOnly||group&&filters&&!filters.has(group))return null;
    const value=guideString(noticeText(copy,notice));
    return value?{value,category:group,colorArgb:notice.colorArgb??(notice.nativeType===6?0xffbacff2:0xffdbc99b)}:null;
   };
   // 67A600 calls 6B7690 before insertion. Consume rejected sequences too:
   // enabling a filter later must neither resurrect them nor erase history.
   for(const notice of notices)if(notice.sequence!==undefined&&notice.sequence>sequence){sequence=notice.sequence;const row=project(notice);if(row)rows.push(row);}
   // 6875F0 timer 2 (switch index 1) sends type 6 through 67A600; suspension never bursts missed tips.
   if(now>=due){due=now+60000;const eligible=eligibleMessageTips(tips,level,country);if(guides&&eligible.length){const value=guideString(eligible[choose(eligible.length)]!.text);if(value)rows.push({value,category:'',colorArgb:0xffbacff2});}}
   if(rows.length>100)rows=rows.slice(-100);
   const unsequenced=[];for(const notice of notices)if(notice.sequence===undefined){const row=project(notice);if(row)unsequenced.push(row);}
   return [...unsequenced,...rows];
  }
 };
}

