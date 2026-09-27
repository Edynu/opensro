import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyDirectory,sha} from './policy.mjs';
import {verifyArchive} from './archive.mjs';
export const forbiddenRoutes=['/src/bootstrap.ts','/@fs/etc/passwd','/@vite/client','/@id/test','/.env','/.git/config','/private/source.json','/release-sources.json','/execution-map.json','/__client-next-dev-session','/api/development/passive-critical-fixture'];
export async function verifyServed(root,origin){
 const m=await verifyDirectory(root),base=new URL(origin);if(base.pathname!=='/')throw Error('Expected release origin');
 const failures=[];const get=(url,options)=>fetch(new URL(url,base),{redirect:'manual',signal:AbortSignal.timeout(30000),...options});
 for(const url of [...forbiddenRoutes,...m.routes.filter(r=>r.url.endsWith('.js')).map(r=>r.url+'.map')]){const r=await get(url);if(![403,404].includes(r.status))failures.push(url+': '+r.status);await r.arrayBuffer();}
 const records=new Map(m.files.map(e=>[e.path,e]));
 for(const r of m.routes.filter(r=>r.file.startsWith('application/')||r.url==='/assets/packs/manifest.json')){
  const response=await get(r.url),bytes=Buffer.from(await response.arrayBuffer()),e=records.get(r.file);
  if(response.status!==200||sha(bytes)!==e.sha256)failures.push('Served bytes differ: '+r.url);
 }
 if(failures.length)throw Error(failures.join('\n'));return {releaseId:m.releaseId,status:'PASS',origin:base.origin};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [root,archive,origin]=process.argv.slice(2);if(!root)throw Error('Usage: verify.mjs PACKAGE [ARCHIVE|-] [ORIGIN]');
 const m=archive&&archive!=='-'?await verifyArchive(archive,root):await verifyDirectory(root);if(origin)console.log(await verifyServed(root,origin));else console.log('PASS',m.releaseId,m.files.length,'files',m.routes.length,'routes');
}
