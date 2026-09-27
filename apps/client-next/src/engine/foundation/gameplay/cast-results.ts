import type {CastImpact,CastState,CastTargetResult} from '@/engine/contracts/gameplay';

// Native result storage is stage-major, even when later batches name different
// targets. Arrays stay dense; explicit stage indices avoid JSON/clone holes.
export function castResultIndex(impact:CastImpact,index:number):number{return impact.stage??index;}
export function castResultAt(impacts:readonly CastImpact[],stage:number):CastImpact|undefined {
 // Packet append order is monotonically increasing by absolute stage. A
 // binary search keeps cancellation bounded even for a full 16K-stage batch.
 let low=0,high=impacts.length-1;
 while(low<=high){const middle=(low+high)>>>1,impact=impacts[middle]!,index=castResultIndex(impact,middle);if(index===stage)return impact;if(index<stage)low=middle+1;else high=middle-1;}
 return undefined;
}
export function castResultStageCount(cast:CastState):number {
 if(cast.resultStageCount!==undefined)return cast.resultStageCount;
 let count=0;
 for(const row of cast.results??[{target:cast.target,impacts:cast.impacts??[]}])
  row.impacts.forEach((impact,index)=>{count=Math.max(count,castResultIndex(impact,index)+1);});
 return count;
}
export function appendCastResults(cast:CastState,incoming:readonly CastTargetResult[],stageCount:number):CastState {
 const offset=castResultStageCount(cast),results=(cast.results??[]).map(row=>({...row,impacts:[...row.impacts]}));
 if(offset+stageCount>16384)throw Error('Cast continuation stage capacity exceeded');
 for(const row of incoming){
  const impacts=row.impacts.map((impact,index)=>({...impact,stage:offset+castResultIndex(impact,index)}));
  const previous=results.find(entry=>entry.target===row.target);
  if(previous)previous.impacts.push(...impacts);else results.push({target:row.target,impacts});
 }
 if(results.reduce((sum,row)=>sum+row.impacts.length,0)>16384)throw Error('Cast continuation capacity exceeded');
 const impacts=results.find(row=>row.target===cast.target)?.impacts??[];
 return {...cast,results,resultStageCount:offset+stageCount,impacts,damage:impacts.reduce((sum,hit)=>sum+hit.damage,0),fatal:impacts.some(hit=>hit.fatal)};
}

// 8DCF40 always records the request before testing +D0 / pmhp[2]. A deferred
// request must not set the timestamp that drives result flushing/effect teardown.
export function requestCastCancellation(cast:CastState,atMs:number):CastState {
 const requested={...cast,cancellationRequestedAtMs:cast.cancellationRequestedAtMs??atMs};
 return cast.cancelledAtMs!==undefined||cast.cancellationDeferred?requested:{...requested,cancelledAtMs:atMs};
}
