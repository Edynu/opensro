import type {AssetOwner} from '@/engine/contracts/assets';
// UI text is a presentation resource. Loading never modifies skill eligibility.
export function createLocalization(assets:Pick<AssetOwner,'available'|'request'|'take'|'cancel'>,base:string){
 let request:number|null=null,entries:Record<string,string>|null=null,retryAt=0,failures=0,disposed=false;
 return {
  step(now:number){
   if(disposed)return false;
   if(request!==null){const result=assets.take(request);if(result){request=null;
    try{if(result.kind!=='bytes')throw Error('Text resource unavailable');
     const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(result.buffer));
     if(!value.entries||typeof value.entries!=='object'||Array.isArray(value.entries)||Object.values(value.entries).some(v=>typeof v!=='string'))throw Error('Invalid text catalogue');
     entries=value.entries;return true;
    }catch{failures++;retryAt=now+Math.min(30000,1000*2**failures);}
   }}
   if(!entries&&request===null&&failures<6&&now>=retryAt&&assets.available()>0){
    try{request=assets.request(new URL('/assets/text/textdataname.en.json',base).href,8<<20);}catch{failures++;retryAt=now+Math.min(30000,1000*2**failures);}
   }
   return false;
  },
  text(symbol:string|undefined,fallback:string){return symbol&&entries&&Object.hasOwn(entries,symbol)?entries[symbol]!:fallback;},
  dispose(){disposed=true;if(request!==null)assets.cancel(request);request=null;entries=null;}
 };
}
