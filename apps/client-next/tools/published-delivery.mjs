import {createReadStream} from 'node:fs';
import {readFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
// Metadata, never compressed payloads, is retained here. Publication digests
// and source stat identity prevent stale precompression from replacing edits.
export function createPublishedDelivery(root){
 let stamp='',pending=null,index=new Map();const verified=new Map();
 async function registry(){
  const filename=path.join(root,'assets/packs/delivery.json');
  let s;try{s=await stat(filename);}catch(error){if(error.code==='ENOENT')return new Map();throw error;}
  const key=[s.size,s.mtimeMs,s.ctimeMs].join(':');
  if(stamp===key)return index;if(pending)return pending;
  pending=(async()=>{const document=JSON.parse(await readFile(filename,'utf8')),next=new Map();for(const e of document.assets??[])if(e.transport&&e.sourceSha256)next.set(e.path.toLowerCase(),e);index=next;stamp=key;verified.clear();return index;})();
  try{return await pending;}finally{pending=null;}
 }
 return {async gzip(pathname,source){
  const entry=(await registry()).get(pathname.toLowerCase()),t=entry?.transport,s=entry?.sourceStat;
  if(!t||!s||s.size!==source.size||s.mtimeMs!==source.mtimeMs||s.ctimeMs!==source.ctimeMs)return null;
  if(t.encoding!=='gzip'||!/^\/assets\/packs\/transport\/[a-f0-9]{64}\.gz$/.test(t.path)||!t.path.endsWith(t.sha256+'.gz'))throw Error('Invalid published gzip identity');
  const filename=path.join(root,t.path),actual=await stat(filename).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(!actual||actual.size!==t.length)return null;
  const key=[actual.size,actual.mtimeMs,actual.ctimeMs].join(':');
  if(verified.get(filename)!==key){const digest=createHash('sha256');for await(const chunk of createReadStream(filename))digest.update(chunk);if(digest.digest('hex')!==t.sha256)throw Error('Published gzip integrity mismatch');verified.set(filename,key);}
  return {filename,length:t.length};
 }};
}
