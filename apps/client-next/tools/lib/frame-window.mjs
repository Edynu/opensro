// Serializable browser-side recorder. Input and observation share this window's
// clock, so host/Playwright scheduling cannot lengthen the movement recipe.
export function captureFrameWindow({duration,name,movement,camera,deferExport=false}){
 return new Promise(resolve=>{
  globalThis.__worldProbeFrameProfiler?.start();globalThis.__worldProbeAnimationCeiling?.start();
  globalThis.__worldProbeAnimationPhases?.start();globalThis.__worldProbeUiProducts?.start();
  performance.mark(`world-profile:${name}:start`);
  const times=[],telemetry=[],motion=[],commands=[],start=performance.now(),startFrameId=globalThis.__worldProbeRenderedFrame;
  let previous=globalThis.__worldProbeFrameTelemetry,turn=-1,nextMotion=0;
  function tick(t){
   const elapsed=t-start;times.push(t);
   // Render-work isolation, not a physical mouse/input-latency benchmark.
   // Sample an elapsed-time path once per browser frame, without CDP round trips.
   if(camera&&elapsed<duration){
    const phase=elapsed/duration*Math.PI*2;
    document.querySelector('canvas').dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:1,pointerType:'mouse',buttons:2,clientX:camera.x+120*Math.sin(phase),clientY:camera.y+25*Math.sin(phase*2)}));
   }
   if(movement&&elapsed<duration){
    const nextTurn=Math.floor(elapsed/1500);
    if(nextTurn!==turn){turn=nextTurn;const destination=turn%2?movement.original:movement.destination;globalThis.__worldProbeRoot.session({kind:'gameplay',command:{kind:'move',destination}});commands.push({at:t,destination});}
   }
   if(movement&&(elapsed>=nextMotion||elapsed>=duration)){
    const game=globalThis.__worldProbeRoot.gameplay();motion.push({at:t,pose:game.pose,moving:game.moving});nextMotion=elapsed+100;
   }
   const current=globalThis.__worldProbeFrameTelemetry;
   if(current&&current!==previous){telemetry.push({at:t,sample:current});previous=current;}
   if(elapsed<duration)requestAnimationFrame(tick);
   else {
    performance.mark(`world-profile:${name}:end`);globalThis.__worldProbeFrameProfiler?.pause();globalThis.__worldProbeAnimationCeiling?.pause();
    globalThis.__worldProbeAnimationPhases?.pause();globalThis.__worldProbeUiProducts?.pause();
    const result={times,telemetry,motion,commands,start,end:t,startFrameId,endFrameId:globalThis.__worldProbeRenderedFrame};
    if(deferExport){globalThis.__worldProbeCompletedWindow=result;resolve(null);}else resolve(result);
   }
  }
  requestAnimationFrame(tick);
 });
}
