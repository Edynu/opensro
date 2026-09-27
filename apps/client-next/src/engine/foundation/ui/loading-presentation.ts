export interface LoadingRequest {readonly key:string;readonly background:string|null;readonly progress:number;readonly complete:boolean;readonly startup:boolean;readonly status:string;}
export interface LoadingPresentation extends LoadingRequest {readonly completedAt?:number;}
// One presentation lifetime owns its artwork and high-water progress. Newly
// discovered work may change the estimate, but cannot rewind the displayed bar.
export function loadingPresentation(previous:LoadingPresentation|null,request:LoadingRequest|null,now:number,cancel=false):LoadingPresentation|null{
 if(cancel)return null;
 if(!previous||request&&request.key!==previous.key)return request?{...request,progress:0,complete:false}:null;
 if(previous.completedAt!==undefined){if(now-previous.completedAt>=100)return request?previous:null;return previous;}
 if(!request||request.complete)return {...previous,progress:1,complete:true,status:'Ready',completedAt:now};
 const estimate=Number.isFinite(request.progress)?request.progress:0;
 return {...previous,progress:Math.max(previous.progress,Math.min(.99,Math.max(0,estimate))),status:request.status};
}
