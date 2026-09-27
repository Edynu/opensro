import {validateAssetDelivery} from '../build/assetDelivery.mjs';
import {validatePackedFontAtlases} from '../build/assetPackPublication.mjs';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gunzip} from 'node:zlib';
import {promisify} from 'node:util';
import {readPublishedAssetBytesSync} from '../lib/publishedAsset.mjs';
const root=path.resolve(import.meta.dirname,'../..'),publicRoot=path.join(root,'.generated/client-public'),decode=promisify(gunzip);
const hash=b=>createHash('sha256').update(b).digest('hex');
const index=JSON.parse(await readFile(path.join(publicRoot,'assets/packs/manifest.json'),'utf8')),verified=new Map();
validateAssetDelivery(index,JSON.parse(await readFile(path.join(publicRoot,'assets/packs/delivery.json'),'utf8')));
await validatePackedFontAtlases(index,publicRoot);
// Effect records are runtime inputs, including the named table loaded on the
// first item/cure event. Loose files are not evidence of worker delivery.
for(const path of ['/assets/skill/effectRecords.json','/assets/skill/namedEffectRecords.json','/assets/effects/programs.json']){
 if(!index.assets.some(e=>e.path===path||e.path===path+'.gz'))throw Error('Missing runtime effect catalog in asset publication: '+path);
}

let members=0,identityBytes=0,compressedBytes=0,animationManifests=0;
for(const e of index.assets){
 if(e.transport){
  const t=e.transport;if(t.path!==`/assets/packs/transport/${t.sha256}.gz`||t.encoding!=='gzip')throw Error('Invalid transport descriptor: '+e.path);
  let row=verified.get(t.sha256);
  if(!row){const encoded=await readFile(path.join(publicRoot,t.path));if(encoded.length!==t.length||hash(encoded)!==t.sha256)throw Error('Compressed integrity: '+e.path);const raw=await decode(encoded,{maxOutputLength:64<<20});row={length:raw.length,sha256:hash(raw)};verified.set(t.sha256,row);}
  if(row.length!==e.length||row.sha256!==e.sha256||t.length>e.length*0.9)throw Error('Lossless compression contract: '+e.path);
  members++;identityBytes+=e.length;compressedBytes+=t.length;
 }
 if(/^\/assets\/world\/[^/]+\/animated-objects\.json(?:\.gz)?$/.test(e.path)){
  let bytes=readPublishedAssetBytesSync(e.path,publicRoot);if(e.path.endsWith('.gz'))bytes=await decode(bytes);
  const actual=Object.keys(JSON.parse(bytes.toString('utf8')).objects).sort();
  if(e.animationDigest!==e.sha256||JSON.stringify(actual)!==JSON.stringify(e.animationSources))throw Error('Animation index drift: '+e.path);animationManifests++;
 }
}
const report={assets:index.assets.length,members,uniqueCompressedPayloads:verified.size,identityBytes,compressedBytes,animationManifests,lossless:true};
const output=path.join(root,'apps/client-next/temp/artifacts/asset-delivery');await mkdir(output,{recursive:true});await writeFile(path.join(output,'publication.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
