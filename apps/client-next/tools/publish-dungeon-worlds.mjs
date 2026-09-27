import fs from 'node:fs/promises';
import path from 'node:path';
import {withGeneratedAssetsLock} from '../../../scripts/rebuildLock.mjs';
import {buildDungeonResourceManifest,DUNGEON_RESOURCE_PUBLIC_PATH} from '../../../scripts/build/world/assets/buildDungeonResources.mjs';
import {buildDungeonWorlds} from '../../../scripts/build/world/assets/buildDungeonWorlds.mjs';
import {publicRoot} from '../../../scripts/build/world/paths.mjs';
import {publishBytesAtomically} from '../../../scripts/build/shared/atomicPublish.mjs';
import {refreshPrecompressedSidecars} from '../../../scripts/build/generatedManifestSidecars.mjs';
import {patchAssetPackGroupFromLooseFiles} from '../../../scripts/build/sparseAssetPackGroupRefresh.mjs';
import {validateAssetPackIndex} from '../../../scripts/build/assetPacks.mjs';
import {buildWebAssetManifest,webAssetManifestPath} from '../../../scripts/build/webManifest.mjs';

await withGeneratedAssetsLock('dungeon rendering publication',async()=>{
 await buildDungeonResourceManifest();
 const providerFile=path.join(publicRoot,DUNGEON_RESOURCE_PUBLIC_PATH);
 const provider=JSON.parse(await fs.readFile(providerFile,'utf8'));
 const result=await buildDungeonWorlds(provider),files=[providerFile,...result.files];
 await refreshPrecompressedSidecars(files,{onlyWhenStale:true,brotliQuality:4,gzipLevel:3,zstdLevel:3});
 const manifestPath=path.join(publicRoot,'assets/packs/manifest.json'),previous=JSON.parse(await fs.readFile(manifestPath,'utf8'));
 const groupName=previous.assets.find(row=>row.path===DUNGEON_RESOURCE_PUBLIC_PATH||row.path===DUNGEON_RESOURCE_PUBLIC_PATH+'.gz')?.group;
 if(!groupName)throw Error('Dungeon provider has no published pack owner');
 const looseFiles=[...files.flatMap(file=>{const name='/'+path.relative(publicRoot,file).replaceAll('\\','/');return [name,name+'.gz'];}),...result.textures];
 const deltas=new Map();
 for(const file of looseFiles){const owner=previous.assets.find(row=>row.path===file)?.group??groupName;const list=deltas.get(owner)??[];list.push(file);deltas.set(owner,list);}
 const refreshed=new Map();
 for(const [owner,paths] of deltas)refreshed.set(owner,await patchAssetPackGroupFromLooseFiles({publicRoot,outputRoot:path.join(publicRoot,'assets/packs/incremental/dungeon-world',owner),previousIndex:previous,groupName:owner,looseFiles:paths}));
 const next={...previous,groups:previous.groups.map(group=>refreshed.get(group.name)?.groups[0]??group),assets:previous.assets.filter(row=>!refreshed.has(row.group)).concat([...refreshed.values()].flatMap(value=>value.assets)).sort((a,b)=>a.path.localeCompare(b.path))};
 validateAssetPackIndex(next);
 await publishBytesAtomically(manifestPath,Buffer.from(JSON.stringify(next)));
 await buildWebAssetManifest();
 await refreshPrecompressedSidecars([manifestPath,webAssetManifestPath],{onlyWhenStale:true,brotliQuality:4,gzipLevel:3,zstdLevel:3});
 console.log(JSON.stringify({regions:result.files.length,textures:result.textures.length,packs:[...refreshed.values()].reduce((n,v)=>n+v.builtPackCount,0)}));
});
