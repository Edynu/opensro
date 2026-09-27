import type {Pose} from '@/engine/contracts/gameplay';
import {SIMULATION_STEP_MS} from '@/engine/contracts/simulation';
import {interpolateMovement,poseDistance} from '@/engine/foundation/gameplay/native-movement';
interface Track {target:Pose;from:Pose;at:number;duration:number;last:number;angle:number;moving:boolean;settled?:Pose;}
const tick=SIMULATION_STEP_MS/1000;
// Native 86CBA0: shortest arc, 3*pi radians/second. Logical headings remain
// authoritative; only the visual body turns. Heading words span one full turn.
function turn(from:number,to:number,seconds:number){
 const delta=((to-from+98304)%65536)-32768,limit=seconds*98304;
 return (from+Math.max(-limit,Math.min(limit,delta))+65536)%65536;
}
function position(row:Track,now:number){return interpolateMovement(row.from,row.target,Math.max(0,Math.min(1,(now-row.at)/row.duration)));}
function discontinuity(a:Pose,b:Pose){
 // Check coordinate spaces before distance: cross-dungeon distance is undefined.
 return !!((a.regionId|b.regionId)&0x8000)&&a.regionId!==b.regionId||poseDistance(a,b)>192;
}
// The worker journal is backpressured and can deliver several fixed steps in
// one batch. Bridge observed delivery intervals, not a fictitious 16ms cadence.
// Never extrapolate beyond admitted navigation; the camera shares this sample.
export function createPosePresentation(){
 const rows=new Map<number,Track>();
 return {
  pose(gid:number,target:Pose,now:number,settledTranslation=false):Pose{
   let row=rows.get(gid);
   // Death navigation is already settled by the world owner. Do not spend an
   // additional delivery interpolation interval sliding a falling corpse.
   // Keep accepting authoritative corrections; this is not a cached death pose.
   if(settledTranslation&&row){row.from={...target};row.target={...target};row.at=now-tick;row.duration=tick;row.settled=undefined;}

   // Settled world transforms have no remaining interpolation or body turn.
   // Retain the already-normalized result, not the raw region-local target;
   // this preserves the original floating-point conversion at sector edges.
   if(row?.settled&&now>=row.last&&now-row.last<=.25&&row.target.regionId===target.regionId&&row.target.x===target.x&&row.target.y===target.y&&row.target.z===target.z&&row.target.angle===target.angle){row.last=now;return {...row.settled};}
   if(row)row.settled=undefined;
   if(!row||now<row.last||now-row.last>.25||discontinuity(row.target,target)){
    row={from:{...target},target:{...target},at:now,duration:tick,last:now,angle:target.angle,moving:false};rows.set(gid,row);
   }else{
    row.angle=turn(row.angle,target.angle,now-row.last);row.last=now;
    if(row.target.regionId!==target.regionId||row.target.x!==target.x||row.target.y!==target.y||row.target.z!==target.z||row.target.angle!==target.angle){
     const from=position(row,now),interval=now-row.at;
     row.duration=interval>.25?tick:Math.min(.1,Math.max(tick,interval,row.duration*.75));
     row.from=from;row.target={...target};row.at=now;
    }
   }
   const result=position(row,now);
   row.moving=poseDistance(result,row.target)>1e-5;
   // Pose carries a native heading word. Keep sub-word precision internally,
   // but do not pass fractional words to the model's strict angle decoder.
   const output={...result,angle:Math.round(row.angle)%65536};
   if(now-row.at>=row.duration&&row.angle===target.angle)row.settled={...output};
   return output;
  },
  moving(gid:number){return rows.get(gid)?.moving??false;},
  retain(gids:ReadonlySet<number>){for(const gid of rows.keys())if(!gids.has(gid))rows.delete(gid);},
  reset(){rows.clear();}
 };
}
