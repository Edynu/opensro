import {regionBannerText,regionBannerAlpha,type RegionBannerText} from '@/engine/foundation/ui/region-banner';

// UI lifetime owns the resolved key and appearance time. Hidden/showing are
// the only stored states; fade and hold are derived, never separate timers.
export function createRegionBanner(){
 let current:RegionBannerText|null=null,started=0,alpha=0;
 return {
  step(region:number|undefined,codes:Readonly<Record<string,string>>|undefined,zones:Readonly<Record<string,string>>|undefined,now:number){
   const next=region!==undefined&&codes&&zones?regionBannerText(region,codes,zones):null;
   let changed=false;
   if(next?.key!==current?.key){current=next;started=now;changed=true;}
   const nextAlpha=current?regionBannerAlpha(Math.max(0,now-started)):0;
   if(nextAlpha!==alpha){alpha=nextAlpha;changed=true;}
   return changed;
  },
  value:()=>current,
  alpha:()=>alpha,
 };
}
