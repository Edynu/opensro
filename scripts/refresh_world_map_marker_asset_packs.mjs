import {publishAssetPackManifest} from './build/assetPackPublication.mjs';
import {readFile,copyFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {withGeneratedAssetsLock} from './rebuildLock.mjs';
import {patchAssetPackGroupFromLooseFiles} from './build/sparseAssetPackGroupRefresh.mjs';
import {buildWebAssetManifest} from './build/webManifest.mjs';
import {refreshGeneratedManifestSidecars,refreshPrecompressedSidecars} from './build/generatedManifestSidecars.mjs';
import {readFile as read,writeFile} from 'node:fs/promises';
import {worldMapMarkerRuntimeImageReferences} from './build/shared/cifRuntimeImageCatalog.mjs';
// CIFWorldMap_InitPageResources 576bd0 acquires its five marker sprites by
// literal path, so neither resinfo\ifworldmap.txt nor the data-driven
// worldmap_*.txt closure (refresh_world_map_asset_packs.mjs) can reach them.
// They ride the native-ui group with the rest of the code-selected CIF art.
const root=path.resolve(import.meta.dirname,'..'),publicRoot=path.join(root,'.generated/client-public');
await withGeneratedAssetsLock('Native world-map marker texture publication',async()=>{
 const files=[];
 for(const ref of worldMapMarkerRuntimeImageReferences){const relative='assets/images/Media_extracted/'+ref.replace('.ddj','.png');await mkdir(path.dirname(path.join(publicRoot,relative)),{recursive:true});await copyFile(path.join(root,relative),path.join(publicRoot,relative));files.push('/'+relative);}
 // buildCifResources registers every runtime reference in the shared sprite
 // catalog; a targeted publication has to keep that catalog closed too, or
 // cifSpriteCatalog.test.mjs reports a published sprite with no dimensions.
 const catalogPath=path.join(publicRoot,'assets/cif/cif-sprite-catalog.json'),catalog=JSON.parse(await read(catalogPath,'utf8'));
 for(const ref of worldMapMarkerRuntimeImageReferences){
  const key=ref,publicPath='/assets/images/Media_extracted/'+key.replace('.ddj','.png');
  const png=await read(path.join(publicRoot,publicPath.slice(1)));
  if(png.length<24||png[0]!==0x89||png.subarray(1,4).toString('ascii')!=='PNG')throw Error('World-map marker sprite is not a PNG: '+publicPath);
  catalog.resourcesByDdjPath[key]={sourcePath:key,publicPath,width:png.readUInt32BE(16),height:png.readUInt32BE(20)};
 }
 await writeFile(catalogPath,JSON.stringify(catalog));
 // The browser is served the precompressed representation, so a rewritten
 // catalog with stale .br/.gz/.zst sidecars would hide the new sprites.
 await refreshPrecompressedSidecars([catalogPath]);
 const manifestPath=path.join(publicRoot,'assets/packs/manifest.json'),previous=JSON.parse(await readFile(manifestPath,'utf8')),deltas=new Map();
 for(const file of files){const group=previous.assets.find(a=>a.path===file)?.group??'native-ui';const rows=deltas.get(group)??[];rows.push(file);deltas.set(group,rows);}
 const updates=[];for(const [groupName,looseFiles]of deltas)updates.push(await patchAssetPackGroupFromLooseFiles({publicRoot,previousIndex:previous,groupName,looseFiles,outputRoot:path.join(publicRoot,'assets/packs/incremental/world-map-markers',groupName)}));
 const next={...previous,generatedAt:new Date().toISOString(),groups:[...previous.groups.filter(r=>!deltas.has(r.name)),...updates.flatMap(r=>r.groups)],assets:[...previous.assets.filter(r=>!deltas.has(r.group)),...updates.flatMap(r=>r.assets)].sort((a,b)=>a.path.localeCompare(b.path))};
 for(const file of files)if(next.assets.filter(r=>r.path===file).length!==1)throw Error('World-map marker publication closure: '+file);
 await publishAssetPackManifest(publicRoot, manifestPath,Buffer.from(JSON.stringify(next)),{logLabel:'world-map-marker-packs'});await buildWebAssetManifest();await refreshGeneratedManifestSidecars({publicRoot,onlyWhenStale:true});console.log('Published '+files.length+' native world-map marker textures.');
});
