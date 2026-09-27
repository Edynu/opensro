import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {resolveSkyTextures,copyReferencedSkyImages} from '../../../scripts/build/world/assets/copySkyImages.mjs';
import {withGeneratedAssetsLock} from '../../../scripts/rebuildLock.mjs';
import {publishBytesAtomically} from '../../../scripts/build/shared/atomicPublish.mjs';
import {refreshPrecompressedSidecars} from '../../../scripts/build/generatedManifestSidecars.mjs';
import {patchAssetPackGroupFromLooseFiles} from '../../../scripts/build/sparseAssetPackGroupRefresh.mjs';
import {validateAssetPackIndex} from '../../../scripts/build/assetPacks.mjs';
import {buildWebAssetManifest,webAssetManifestPath} from '../../../scripts/build/webManifest.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../.generated/client-public/assets/world');
await withGeneratedAssetsLock('live flare texture publication',async()=>{
 const sky=resolveSkyTextures(),changes=[],published=[];
 await copyReferencedSkyImages(sky);console.log("Flare sources copied; checking published world references.");
 for(const name of await fs.readdir(root,{recursive:true})){
  if(!name.endsWith('.json'))continue;
  const file=path.join(root,name),value=JSON.parse(await fs.readFile(file,'utf8')),current=value.sky;
  if(!current)continue;
  published.push(file);
  if(JSON.stringify(current.flareTexturePublicPaths)===JSON.stringify(sky.flareTexturePublicPaths)&&JSON.stringify(current.starPrimitive)===JSON.stringify(sky.starPrimitive))continue;
  current.flareTexturePublicPaths=sky.flareTexturePublicPaths;current.starPrimitive=sky.starPrimitive;changes.push([file,JSON.stringify(value)]);
 }
 // Validate the entire publication set before replacing any asset.
 for(const [file,json]of changes)await publishBytesAtomically(file,Buffer.from(json));
 // Include unchanged logical files: this also repairs an interrupted publication
 // between JSON replacement and sidecar/pack commit without rewriting geometry.
 console.log(JSON.stringify({phase:"world-sidecars",changed:changes.length,verified:published.length}));
 await refreshPrecompressedSidecars(published,{onlyWhenStale:true,brotliQuality:4,gzipLevel:3,zstdLevel:3});
 const publicRoot=path.resolve(root,'../..'),manifestPath=path.join(publicRoot,'assets/packs/manifest.json');
 const previous=JSON.parse(await fs.readFile(manifestPath,'utf8')),deltas=new Map();
 for(const file of published){const logical='/'+path.relative(publicRoot,file).replaceAll('\\','/');
  for(const row of previous.assets.filter(row=>row.path===logical||row.path===logical+'.gz')){
   const files=deltas.get(row.group)??[];files.push(row.path);deltas.set(row.group,files);
  }
 }
 const imageGroup=previous.assets.find(row=>row.path===sky.sunTexturePublicPath)?.group;if(!imageGroup)throw Error('Sun texture has no authoritative pack group');
 const imageFiles=deltas.get(imageGroup)??[];imageFiles.push(...sky.flareTexturePublicPaths,...sky.textures.filter(row=>row.role==='weather').map(row=>row.publicPath));deltas.set(imageGroup,imageFiles);
 const refreshed=new Map();
 for(const [groupName,looseFiles]of deltas){console.log(JSON.stringify({phase:"patch-pack-group",group:groupName,files:looseFiles.length}));refreshed.set(groupName,await patchAssetPackGroupFromLooseFiles({publicRoot,outputRoot:path.join(publicRoot,'assets/packs/incremental/live-flares',groupName),previousIndex:previous,groupName,looseFiles}));}
 const next={...previous,groups:previous.groups.map(group=>refreshed.get(group.name)?.groups[0]??group),assets:previous.assets.filter(row=>!refreshed.has(row.group)).concat([...refreshed.values()].flatMap(value=>value.assets)).sort((a,b)=>a.path.localeCompare(b.path))};
 validateAssetPackIndex(next);
 if(JSON.stringify(next)!==JSON.stringify(previous))await publishBytesAtomically(manifestPath,Buffer.from(JSON.stringify(next)));
 await buildWebAssetManifest();
 await refreshPrecompressedSidecars([manifestPath,webAssetManifestPath],{onlyWhenStale:true,brotliQuality:4,gzipLevel:3,zstdLevel:3});
 console.log(JSON.stringify({updated:changes.length,verified:published.length,packsBuilt:[...refreshed.values()].reduce((n,v)=>n+v.builtPackCount,0),textures:sky.flareTexturePublicPaths}));
});
