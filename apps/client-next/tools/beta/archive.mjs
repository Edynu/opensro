import {createReadStream} from 'node:fs';
import {open,readFile,statfs} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {safeName,verifyDirectory} from './policy.mjs';
// Narrow USTAR writer/reader: regular files only, no links, PAX, traversal,
// extraction or subprocesses. Archives are verified against the trusted manifest.
export async function archiveRelease(root,destination){
 const manifest=await verifyDirectory(root),entries=[{path:'release.json',length:(await readFile(path.join(root,'release.json'))).length},...manifest.files];
 const disk=await statfs(path.dirname(destination));
 if(disk.bavail*disk.bsize<entries.reduce((n,e)=>n+512+Math.ceil(e.length/512)*512,1024))throw Error('Insufficient space for release archive');
 const output=await open(destination,'wx');
 const write=async bytes=>{let offset=0;while(offset<bytes.length){const {bytesWritten}=await output.write(bytes,offset,bytes.length-offset);if(!bytesWritten)throw Error('Archive write made no progress');offset+=bytesWritten;}};
 try{for(const e of entries){
  safeName(e.path);const header=Buffer.alloc(512);let name=e.path,prefix='';
  if(Buffer.byteLength(name)>100){const cut=name.lastIndexOf('/');prefix=name.slice(0,cut);name=name.slice(cut+1);}
  if(Buffer.byteLength(name)>100||Buffer.byteLength(prefix)>155)throw Error('USTAR path too long: '+e.path);
  header.write(name,0,100);header.write(prefix,345,155);
  const octal=(n,at,width)=>header.write(n.toString(8).padStart(width-1,'0')+'\0',at,width);
  octal(0o644,100,8);octal(0,108,8);octal(0,116,8);octal(e.length,124,12);octal(0,136,12);header.fill(32,148,156);header[156]=48;header.write('ustar\0',257);header.write('00',263);octal(header.reduce((s,b)=>s+b,0),148,8);
  await write(header);for await(const chunk of createReadStream(path.join(root,e.path)))await write(chunk);
  await write(Buffer.alloc((512-e.length%512)%512));
 }await write(Buffer.alloc(1024));}finally{await output.close();}
 await verifyArchive(destination,root);return manifest;
}
export async function verifyArchive(archive,root){
 const manifest=await verifyDirectory(root),raw=await readFile(path.join(root,'release.json'));
 const expected=new Map([{path:'release.json',length:raw.length,sha256:createHash('sha256').update(raw).digest('hex')},...manifest.files].map(e=>[e.path,e]));
 const input=createReadStream(archive),it=input[Symbol.asyncIterator]();let pending=Buffer.alloc(0);
 async function take(n){const pieces=[];while(n){if(!pending.length){const next=await it.next();if(next.done)throw Error('Truncated archive');pending=next.value;}const count=Math.min(n,pending.length);pieces.push(pending.subarray(0,count));pending=pending.subarray(count);n-=count;}return Buffer.concat(pieces);}
 const string=(b,a,n)=>b.subarray(a,a+n).toString().split('\0')[0];
 try{while(true){const header=await take(512);if(header.every(b=>b===0)){if(!(await take(512)).every(b=>b===0)||expected.size)throw Error('Incomplete archive');if(pending.some(b=>b!==0))throw Error('Trailing archive data');for await(const b of { [Symbol.asyncIterator]:()=>it })if(b.some(v=>v!==0))throw Error('Trailing archive data');break;}
  const stored=parseInt(string(header,148,8),8);const copy=Buffer.from(header);copy.fill(32,148,156);if(copy.reduce((s,b)=>s+b,0)!==stored||header[156]!==48||string(header,257,6)!=='ustar')throw Error('Unsupported/corrupt archive entry');
  const prefix=string(header,345,155),name=safeName((prefix?prefix+'/':'')+string(header,0,100)),size=parseInt(string(header,124,12),8),e=expected.get(name);
  if(!e||e.length!==size)throw Error('Unmanifested/duplicate archive entry: '+name);expected.delete(name);
  const hash=createHash('sha256');let left=size;while(left){const b=await take(Math.min(left,1<<20));hash.update(b);left-=b.length;}if(hash.digest('hex')!==e.sha256)throw Error('Archive payload mismatch: '+name);
  if(!(await take((512-size%512)%512)).every(b=>b===0))throw Error('Invalid archive padding');
 }}finally{input.destroy();}
 return manifest;
}
