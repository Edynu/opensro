import {mkdir,readFile,writeFile,link} from 'node:fs/promises';
import path from 'node:path';
import {compressRoutes} from './compression.mjs';
import {buildApplication} from './build.mjs';
import {files,sha,releaseIdentity,verifyDirectory} from './policy.mjs';
// Validation artifact only. Baseline uses the exact beta source snapshot, with
// normal production diagnostics defaults, and identical immutable asset bytes.
const [generation,destination]=process.argv.slice(2);if(!generation||!destination)throw Error('Usage: baseline.mjs BETA_GENERATION FRESH_DESTINATION');
const original=path.resolve(generation,'package'),root=path.resolve(destination,'package');const manifest=await verifyDirectory(original);
await mkdir(destination,{recursive:false});await mkdir(root);const source=JSON.parse(await readFile(path.join(generation,'private/source.json'),'utf8'));
await buildApplication({directory:path.join(root,'application'),source,mode:'production'});
for(const e of manifest.files.filter(e=>e.kind!=='application')){await mkdir(path.dirname(path.join(root,e.path)),{recursive:true});await link(path.join(original,e.path),path.join(root,e.path));}
const result={...manifest,files:manifest.files.filter(e=>e.kind!=='application'),routes:manifest.routes.filter(r=>!r.file.startsWith('application/'))};
for(const name of await files(path.join(root,'application'))){const bytes=await readFile(path.join(root,'application',name)),file='application/'+name;result.files.push({path:file,kind:'application',length:bytes.length,sha256:sha(bytes)});result.routes.push({url:'/'+name,file,offset:0,length:bytes.length,mime:name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html'});}
await compressRoutes(root,result);
result.files.sort((a,b)=>a.path.localeCompare(b.path));result.routes.sort((a,b)=>a.url.localeCompare(b.url));result.releaseId=releaseIdentity(result);await writeFile(path.join(root,'release.json'),JSON.stringify(result,null,2));await verifyDirectory(root);
console.log(JSON.stringify({baseline:root,sourceHash:result.sourceHash,releaseId:result.releaseId,identicalApplicationChunks:result.files.filter(e=>e.kind==='application'&&manifest.files.some(f=>f.sha256===e.sha256)).map(e=>e.path)},null,2));
