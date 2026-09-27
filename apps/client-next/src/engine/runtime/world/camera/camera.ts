import type {CameraScript} from '@/engine/contracts/camera-script';
import type {PresentationRandom} from '@/engine/contracts/presentation-random';

// CGInterface 68F6D0 / 687C3E: timer 4 terminates before timer 5 can
// sample. A00BE0 polls each timer once, then restamps it to now; it does
// not catch up missed ticks. No browser timer and no private RNG stream.
export function createCameraScripts(random:PresentationRandom){
 let active:CameraScript|null=null,lastMs=0,amplitude=0,x=0,y=0;
 function reset(){active=null;lastMs=0;amplitude=0;x=0;y=0;}
 return {
  step(nowMs:number,events:readonly CameraScript[]){
   if(!Number.isFinite(nowMs)||nowMs<0)throw Error('Invalid camera script clock');
   for(const event of events){
    if(!Number.isFinite(event.atMs)||event.atMs<0||event.atMs>nowMs||![50,200,300,400].includes(event.amplitude)||event.durationMs!==500||event.periodMs!==(event.amplitude===50?20:25))throw Error('Invalid camera script event');
    active={...event,atMs:Math.trunc(event.atMs)};lastMs=active.atMs;amplitude=event.amplitude;x=0;y=0;
   }
   const now=Math.trunc(nowMs);
   if(active){
    if(((now-active.atMs)>>>0)>=active.durationMs)reset();
    else if(((now-lastMs)>>>0)>=active.periodMs){
     // 687CA6 stores the ratio as float before x87 truncates the product.
     amplitude=Math.max(1,(amplitude-Math.trunc(Math.fround(((now-lastMs)>>>0)/active.durationMs)*active.amplitude))>>>0);
     x=Math.fround(random.range(-amplitude,amplitude)/100);
     y=Math.fround(random.range(-amplitude,amplitude)/100);
     lastMs=now;
    }
   }
   return [x,y] as const;
  },reset,dispose:reset
 };
}
