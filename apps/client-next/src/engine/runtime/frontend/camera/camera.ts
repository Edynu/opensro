import {sampleFrontendCamera,frontendCameraView} from "@/engine/foundation/rendering/frontend-camera";
import type {FrontendCameraTrack,FrontendCameraFrame,FrontendCameraKey} from "@/engine/contracts/frontend";
export function createFrontendCamera(){
 let track:FrontendCameraTrack|null=null,time=0;
 return {
  install(value:FrontendCameraTrack){sampleFrontendCamera(value.keys,0);if(!Number.isFinite(value.target)||value.target<0)throw new Error("Invalid camera target");track=structuredClone(value);time=0;},
  returnTo(destination:FrontendCameraKey,duration=2){
   if(!Number.isFinite(duration)||duration<=0)throw new Error('Invalid camera duration');
   if(!track)throw new Error("Camera return requires a live pose");
   const source=sampleFrontendCamera(track.keys,time);
   const keys=[{...source,timeSeconds:0},{...destination,timeSeconds:duration}];
   sampleFrontendCamera(keys,0);track=structuredClone({keys,target:duration,mode:"transition"});time=0;
  },
  step(delta:number):FrontendCameraFrame|null {if(!track)return null;if(!Number.isFinite(delta)||delta<0)throw new Error("Invalid camera delta");
   const dt=Math.min(delta,3);time=Math.min(track.target,time+(track.mode==="intro"?(time<track.target-1?dt*.25:dt/6):dt));
   return {camera:frontendCameraView(sampleFrontendCamera(track.keys,time)),time,complete:time>=track.target};
  },
  completeTransition(){if(track)time=track.target;},dispose(){track=null;time=0;}
 };
}
