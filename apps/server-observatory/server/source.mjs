import {readFile} from 'node:fs/promises';

export async function loadShards(path){
 const {shards}=JSON.parse(await readFile(path,'utf8'));
 return shards.filter(s=>s.enabled).map(s=>{
  const url=new URL(s.controlUrl);
  if(url.protocol!=='http:'||!['127.0.0.1','[::1]'].includes(url.hostname)||url.username||url.password||url.pathname!=='/')throw Error('Dashboard requires loopback control URLs');
  return {id:s.id,name:s.name,capacity:s.capacity,test:s.test,url:new URL('/internal/diagnostics/observatory',url).href};
 });
}

// One in-flight read per shard, shared by every dashboard tab. Rejections are
// cached too; a disconnected shard cannot create an unbounded retry fan-out.
export function createSource(shards,fetcher=fetch,clock=Date.now){
 const cache=new Map();
 async function read(shard){
  const prior=cache.get(shard.id);if(prior&&clock()-prior.at<2000)return prior.promise;
  const promise=(async()=>{
   try{
    const response=await fetcher(shard.url,{headers:{'X-SRO-Local-Diagnostics':'1'},signal:AbortSignal.timeout(5000),redirect:'error'});
    if(!response.ok)throw Error('Control API returned HTTP '+response.status);
    const reader=response.body.getReader();let size=0;const chunks=[];
    try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>24*1024*1024)throw Error('Snapshot exceeded 24 MiB');chunks.push(value);}}finally{await reader.cancel();}
    const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if(data.version!==1||data.shard!==shard.id||!Array.isArray(data.players)||!Array.isArray(data.population?.monsters)||!Number.isFinite(Date.parse(data.capturedAt)))throw Error('Invalid snapshot contract');
    return {id:shard.id,name:shard.name,capacity:shard.capacity,test:shard.test,connected:true,data};
   }catch(error){return {id:shard.id,name:shard.name,capacity:shard.capacity,test:shard.test,connected:false,error:error.name==='TimeoutError'?'Control API timed out':error.message};}
  })();
  // Keep the pending request resident until it finishes, including timeout.
  const entry={at:Infinity,promise};cache.set(shard.id,entry);promise.finally(()=>{entry.at=clock();});return promise;
 }
 return {async snapshot(){return {receivedAt:new Date(clock()).toISOString(),shards:await Promise.all(shards.map(read))};}};
}
