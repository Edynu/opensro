import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildNativeSkyStarPrimitive} from '../../../scripts/build/world/assets/copySkyImages.mjs';
import {withGeneratedAssetsLock} from '../../../scripts/rebuildLock.mjs';
import {publishBytesAtomically} from '../../../scripts/build/shared/atomicPublish.mjs';
import {refreshPrecompressedSidecars} from '../../../scripts/build/generatedManifestSidecars.mjs';
import {patchAssetPackGroupFromLooseFiles} from '../../../scripts/build/sparseAssetPackGroupRefresh.mjs';
import {validateAssetPackIndex} from '../../../scripts/build/assetPacks.mjs';
import {buildWebAssetManifest,webAssetManifestPath} from '../../../scripts/build/webManifest.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../.generated/client-public/assets/world');
await withGeneratedAssetsLock('star RNG continuation publication',async()=>{
 const primitive=buildNativeSkyStarPrimitive(),vertices=JSON.stringify(primitive.vertices),changes=[],published=[];
 for(const name of await fs.readdir(root,{recursive:true})){
  if(!name.endsWith('.json'))continue;
  const file=path.join(root,name),value=JSON.parse(await fs.readFile(file,'utf8')),stars=value.sky?.starPrimitive;
  if(!stars)continue;
  if(JSON.stringify(stars.vertices)!==vertices||stars.nativeRand?.seed!==primitive.nativeRand.seed)throw Error('Star geometry does not match the continuation producer: '+file);
  published.push(file);
  if(stars.nativeRand.stateAfterConstruction===primitive.nativeRand.stateAfterConstruction&&stars.nativeRand.calls===primitive.nativeRand.calls)continue;
  stars.nativeRand={...stars.nativeRand,stateAfterConstruction:primitive.nativeRand.stateAfterConstruction,calls:primitive.nativeRand.calls};changes.push([file,JSON.stringify(value)]);
 }
 // Validate the entire publication set before replacing any asset.
 for(const [file,json]of changes)await publishBytesAtomically(file,Buffer.from(json));
 // Include unchanged logical files: this also repairs an interrupted publication
 // between JSON replacement and sidecar/pack commit without rewriting geometry.
 await refreshPrecompressedSidecars(published,{onlyWhenStale:true,brotliQuality:4,gzipLevel:3,zstdLevel:3});
 const publicRoot=path.resolve(root,'../..'),manifestPath=path.join(publicRoot,'assets/packs/manifest.json');
 const previous=JSON.parse(await fs.readFile(manifestPath,'utf8')),deltas=new Map();
 for(const file of published){const logical='/'+path.relative(publicRoot,file).replaceAll('\\','/');
  for(const row of previous.assets.filter(row=>row.path===logical||row.path===logical+'.gz')){
   const files=deltas.get(row.group)??[];files.push(row.path);deltas.set(row.group,files);
  }
 }
 const refreshed=new Map();
 for(const [groupName,looseFiles]of deltas)refreshed.set(groupName,await patchAssetPackGroupFromLooseFiles({publicRoot,outputRoot:path.join(publicRoot,'assets/packs/incremental/star-rng',groupName),previousIndex:previous,groupName,looseFiles}));
 const next={...previous,groups:previous.groups.map(group=>refreshed.get(group.name)?.groups[0]??group),assets:previous.assets.filter(row=>!refreshed.has(row.group)).concat([...refreshed.values()].flatMap(value=>value.assets)).sort((a,b)=>a.path.localeCompare(b.path))};
 validateAssetPackIndex(next);
 if(JSON.stringify(next)!==JSON.stringify(previous))await publishBytesAtomically(manifestPath,Buffer.from(JSON.stringify(next)));
 await buildWebAssetManifest();
 await refreshPrecompressedSidecars([manifestPath,webAssetManifestPath],{onlyWhenStale:true,brotliQuality:4,gzipLevel:3,zstdLevel:3});
 console.log(JSON.stringify({updated:changes.length,verified:published.length,packsBuilt:[...refreshed.values()].reduce((n,v)=>n+v.builtPackCount,0),random:primitive.nativeRand}));
});
