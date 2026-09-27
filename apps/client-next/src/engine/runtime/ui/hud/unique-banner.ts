import type {SystemNotice} from '@/engine/foundation/gameplay/system-notices';
import {noticeText} from '@/engine/foundation/ui/notice-text';
export const uniqueBannerPaths=['corner','edge','edge2'].map(part=>`/assets/images/Media_extracted/interface/ifcommon/com_warning_${part}.png`);
// 67d030 targets warning id 35, not the red notice sibling. 6b3180 arms
// 7000 ms; 6b30f0 fades for its final 2000 ms. The latest notice replaces it.
export const notificationBannerPaths=['corner','edge','edge2'].map(part=>`/assets/images/Media_extracted/interface/ifcommon/com_notice_${part}.png`);
export function createNoticeBanner(kind:'banner'|'notificationBanner'='banner'){
 let sequence=0,current:SystemNotice|null=null,started:number|null=null,alpha=0;
 return {
  reset(){sequence=0;current=null;started=null;alpha=0;},
  step(notices:readonly SystemNotice[],now:number,ready:boolean,copy?:(key:string)=>string){
   let changed=false;
   for(const notice of notices)if(notice[kind]&&notice.sequence!==undefined&&notice.sequence>sequence){
    // 67D034 returns on empty text without replacing the active warning.
    // Wait for localization admission before deciding whether text is empty.
    if(copy&&!ready)continue;
    sequence=notice.sequence;if(copy&&!noticeText(copy,notice,'banner'))continue;
    current=notice;started=null;changed=true;
   }
   if(current&&ready&&started===null){started=now;changed=true;}
   const next=current&&started!==null?Math.floor(Math.max(0,Math.min(255,(7000-(now-started))*255/2000)))/255:0;
   if(next!==alpha){alpha=next;changed=true;}
   return changed;
  },
  value:(copy:(key:string)=>string)=>current?noticeText(copy,current,'banner'):'',
  alpha:()=>alpha,
 };
}
export const createUniqueBanner=createNoticeBanner;
