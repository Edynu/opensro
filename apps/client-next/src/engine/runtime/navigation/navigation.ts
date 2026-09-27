import type {AssetOwner} from '@/engine/contracts/assets';
import type {Pose,GameplayCommand} from '@/engine/contracts/gameplay';
// Owns demand and cancellation, not collision state or a second asset cache.
export function createNavigationStream(assets:AssetOwner,emit:(command:GameplayCommand)=>void,origin:string){
 let catalog:Record<string,{bundlePublicPath:string}[]>|null=null;
 let state:{phase:'idle'}|{phase:'loading';id:number;region:number;catalog:boolean}|{phase:'admitting'|'ready';region:number}|{phase:'failed';region:number;error:string}={phase:'idle'};
 let disposed=false,requestId=0,deadline=0;
 function cancel(){if(state.phase==='loading')assets.cancel(state.id);state={phase:'idle'};}
 return {
  step(pose:Pose|null,admittedRegion?:number,failure?:{region:number;requestId?:number;error:string},admittedRequestId?:number,now=performance.now()){
   if(disposed)return;if(!pose){cancel();return;}
   if(state.phase!=='idle'&&state.region!==pose.regionId)cancel();
   if(state.phase==='admitting'&&failure?.region===state.region&&failure.requestId===requestId){state={phase:'failed',region:state.region,error:failure.error};return;}
   if(state.phase==='admitting'&&admittedRegion===state.region&&admittedRequestId===requestId)state={phase:'ready',region:state.region};
   try{
    if(state.phase==='admitting'&&now>=deadline)throw Error('Navigation admitting timed out for region '+state.region);
    if(state.phase==='loading'){
     const result=assets.take(state.id);if(!result){if(now>=deadline)throw Error('Navigation loading timed out for region '+state.region);return;}
     if(result.kind==='error')throw new Error(result.error);
     if(state.catalog){if(result.kind!=='bytes')throw new Error('Navigation catalog response');const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(result.buffer));if(!value.regionsById||typeof value.regionsById!=='object')throw new Error('Navigation catalog');catalog=value.regionsById;state={phase:'idle'};}
     else {if(result.kind!=='navigation')throw new Error('Navigation product response');if(result.product.regionId!==pose.regionId)throw Error('Navigation product region mismatch');emit({kind:'navigation',requestId:++requestId,regionId:result.product.regionId,bundle:result.product});deadline=now+15000;state={phase:'admitting',region:pose.regionId};}
    }
    if(state.phase!=='idle'||!assets.available())return;
    const dungeon=!!(pose.regionId&0x8000),isCatalog=!dungeon&&!catalog;
    const path=dungeon?'/assets/world/dungeon/dungeon-resources.json':isCatalog?'/assets/world/world-region-catalog.json':catalog?.[`0x${pose.regionId.toString(16).padStart(4,'0')}`]?.[0]?.bundlePublicPath;
    if(!path||!path.startsWith('/assets/')||path.includes('..')||path.includes('\\'))throw new Error('No published navigation for region '+pose.regionId);
    const url=new URL(path,origin);if(!isCatalog)url.hash=String(pose.regionId);
    deadline=now+60000;state={phase:'loading',region:pose.regionId,catalog:isCatalog,id:assets.request(url.href,(isCatalog?16:128)<<20,isCatalog?undefined:'navigation')};
   }catch(error){cancel();state={phase:'failed',region:pose.regionId,error:String(error)};}
  },
  phase(){return state.phase;},
  error(){return state.phase==='failed'?state.error:null;},
  retry(){if(state.phase==='failed')state={phase:'idle'};},
  reset(){cancel();},dispose(){if(disposed)return;cancel();catalog=null;disposed=true;}
 };
}
