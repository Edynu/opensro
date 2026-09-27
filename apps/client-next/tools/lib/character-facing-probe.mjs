// Uses the caller's authenticated, scratch-guarded browser and existing owners.
export async function probeCharacterFacing(page,directory){
 const original=await page.evaluate(()=>globalThis.__worldProbeRoot.gameplay().pose),rows=[],failures=[];
 try{
  // Offset the clicks sideways so they cannot select the local model itself.
  for(const [index,[dx,dz]] of [[35,-35],[-35,-35]].entries()){
   const point=await page.evaluate(async ([dx,dz])=>{
    const game=globalThis.__worldProbeRoot.gameplay(),pose=game.pose;
    const {screenPoint}=await import('/src/engine/foundation/rendering/screen-point.ts');
    const canvas=document.querySelector('canvas'),rect=canvas.getBoundingClientRect();
    const point=screenPoint(globalThis.__worldProbeCamera,[pose.x+dx,pose.y,pose.z+dz],rect.width,rect.height);
    if(!point||point[0]<0||point[1]<0||point[0]>=rect.width||point[1]>=rect.height)throw Error('Facing click outside viewport');
    return {x:rect.x+point[0],y:rect.y+point[1],before:pose};
   },[dx,dz]);
   await page.mouse.click(point.x,point.y);
   const samples=await page.evaluate(()=>new Promise(resolve=>{
    const samples=[],start=performance.now();function tick(){
     const game=globalThis.__worldProbeRoot.gameplay(),actor=globalThis.__facingActors?.find(a=>a.gid===game.localGid);
     if(actor)samples.push({pose:{...actor.pose},nativePose:{...game.pose},yaw:actor.pose.yaw,clip:actor.clip});
     if(performance.now()-start<2000)requestAnimationFrame(tick);else resolve(samples);
    }requestAnimationFrame(tick);
   }));
   let previous=samples[0]?.pose,checks=0,worst=1;
   for(const sample of samples){
    if(!previous){previous=sample.pose;continue;}
    const dx=sample.pose.x-previous.x+((sample.pose.regionId&255)-(previous.regionId&255))*1920;
    const dz=sample.pose.z-previous.z+((sample.pose.regionId>>>8)-(previous.regionId>>>8))*1920,length=Math.hypot(dx,dz);
    // A frame spanning a turn can contain travel under both headings. Compare
    // coherent presentation samples, not a newer worker pose with an older rig.
    if(length>.01&&previous.yaw===sample.yaw){const dot=(Math.sin(sample.yaw)*dx+Math.cos(sample.yaw)*dz)/length;worst=Math.min(worst,dot);checks++;}
    previous=sample.pose;
   }
   if(!checks||worst<.99)failures.push(`click ${index}: ${checks} movement samples, minimum forward alignment ${worst}`);
   rows.push({point,samples,checks,worst});await page.screenshot({path:`${directory}/facing-${index}.png`});
  }
 }finally{
  await page.evaluate(destination=>globalThis.__worldProbeRoot.session({kind:'gameplay',command:{kind:'move',destination}}),original);
  await page.waitForFunction(destination=>{const game=globalThis.__worldProbeRoot.gameplay();return game.pose.regionId===destination.regionId&&Math.hypot(game.pose.x-destination.x,game.pose.z-destination.z)<1;},original,{timeout:20000});
 }
 return {original,rows,failures};
}
