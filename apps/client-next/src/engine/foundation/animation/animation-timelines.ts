import type {CharacterClip} from '@/engine/contracts/character';

// A pose owns mutable cursors. Channels with byte-identical authored clocks
// share bracket calculation, never sampled values or animation event state.
export function createAnimationTimelines(clip:CharacterClip){
 type Timeline={times:Float32Array;low:number;next:number;span:number;fraction:number};
 const buckets=new Map<number,Timeline[]>(),unique:Timeline[]=[];
 const channels=clip.channels.map(channel=>{
  const times=channel.times,words=new Uint32Array(times.buffer,times.byteOffset,times.length);
  let hash=2166136261;for(const word of words)hash=Math.imul(hash^word,16777619);
  let bucket=buckets.get(hash);if(!bucket){bucket=[];buckets.set(hash,bucket);}
  const existing=bucket.find(row=>row.times.length===times.length&&new Uint32Array(row.times.buffer,row.times.byteOffset,row.times.length).every((word,i)=>word===words[i]));
  if(existing)return existing;
  const row={times,low:0,next:0,span:0,fraction:0};bucket.push(row);unique.push(row);return row;
 });
 return {channels,sample(time:number){
  for(const row of unique){
   const times=row.times;let low=row.low,high=times.length-1;
   if(!(times[low]!<=time&&(low===high||time<times[low+1]!))){
    low=0;while(low<high){const mid=Math.ceil((low+high)/2);if(times[mid]!<=time)low=mid;else high=mid-1;}
   }
   row.low=low;row.next=Math.min(low+1,times.length-1);row.span=times[row.next]!-times[low]!;
   row.fraction=row.span?Math.max(0,Math.min(1,(time-times[low]!)/row.span)):0;
  }
 }};
}
