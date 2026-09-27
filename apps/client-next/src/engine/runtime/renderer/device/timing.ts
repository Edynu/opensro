// Optional device-owned diagnostics. Readback never delays frame submission.
// Low-level GPU adapter uses an explicit slot phase; it has no application
// lifecycle actor dependency. Disposal invalidates every asynchronous completion.
export function createGpuTiming(device:GPUDevice){
 const slots=Array.from({length:3},()=>({phase:'free' as 'free'|'recording'|'mapping',query:device.createQuerySet({type:'timestamp',count:32}),resolve:device.createBuffer({size:256,usage:GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC}),read:device.createBuffer({size:256,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ})}));
 let disposed=false,skipped=0,failed=0,sequence=0;
 const samples:{sequence:number;frameId?:number;passes:readonly {name:string;ms:number}[]}[]=[];
 return {
  begin(frameId?:number){
   if(disposed)return undefined;
   const slot=slots.find(s=>s.phase==='free');if(!slot){skipped++;return undefined;}
   slot.phase='recording';const names:string[]=[],id=++sequence;let resolved=false,submitted=false;
   return {
    pass(name:string):GPURenderPassTimestampWrites|undefined{
     if(disposed||resolved)throw Error('Stale GPU timing frame');
     if(names.length===16)return undefined;const index=names.length*2;names.push(name);
     return {querySet:slot.query,beginningOfPassWriteIndex:index,endOfPassWriteIndex:index+1};
    },
    resolve(){
     if(disposed||resolved)throw Error('Stale GPU timing resolve');resolved=true;
     return names.length?{query:slot.query,count:names.length*2,resolve:slot.resolve,read:slot.read}:undefined;
    },
    submitted(){
     if(disposed||!resolved||submitted)throw Error('Invalid GPU timing submission');submitted=true;
     if(!names.length){slot.phase='free';return;}slot.phase='mapping';
     void slot.read.mapAsync(GPUMapMode.READ,0,names.length*16).then(()=>{
      if(disposed)return;
      const values=new BigUint64Array(slot.read.getMappedRange(0,names.length*16));
      const passes=names.map((name,i)=>({name,ms:Number(values[i*2+1]!-values[i*2]!)/1e6}));
      slot.read.unmap();slot.phase='free';
      if(passes.some(p=>p.ms<0||!Number.isFinite(p.ms))){failed++;return;}
      samples.push({sequence:id,frameId,passes});if(samples.length>240)samples.shift();
     }).catch(()=>{if(!disposed){failed++;slot.phase='free';}});
    }
   };
  },
  stats(){return {supported:true,skipped,failed,samples:samples.map(s=>({...s,passes:s.passes.map(p=>({...p}))}))};},
  dispose(){if(disposed)return;disposed=true;for(const slot of slots){slot.query.destroy();slot.resolve.destroy();slot.read.destroy();}samples.length=0;}
 };
}
