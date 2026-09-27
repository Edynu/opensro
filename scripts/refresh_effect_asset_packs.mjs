import {publishAssetPackManifest} from './build/assetPackPublication.mjs';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {withGeneratedAssetsLock} from './rebuildLock.mjs';
import {patchAssetPackGroupFromLooseFiles} from './build/sparseAssetPackGroupRefresh.mjs';
import {buildWebAssetManifest} from './build/webManifest.mjs';
import {refreshGeneratedManifestSidecars,refreshPrecompressedSidecars} from './build/generatedManifestSidecars.mjs';
import {publicRoot} from './build/world/paths.mjs';
// Publish the complete generated EFP dependency closure through the same pack
// authority the asset worker reads. Updating a loose JSON file alone is stale.
await withGeneratedAssetsLock('Effect program pack publication',async()=>{
 const catalog=JSON.parse(await readFile(path.join(publicRoot,'assets/effects/programs.json'),'utf8'));
 const records=['/assets/skill/effectRecords.json','/assets/skill/namedEffectRecords.json','/assets/effects/programs.json'];
 await refreshPrecompressedSidecars(records.map(file=>path.join(publicRoot,file)),{onlyWhenStale:true});
 const files=[...records.map(file=>file+'.gz'),...new Set(Object.values(catalog.textures))];
 const target=path.join(publicRoot,'assets/packs/manifest.json'),previous=JSON.parse(await readFile(target,'utf8')),deltas=new Map();
 for(const file of files){const group=previous.assets.find(a=>a.path===file)?.group??(file.endsWith('.gz')?'game-data':'game-images');const rows=deltas.get(group)??[];rows.push(file);deltas.set(group,rows);}
 const updates=[];for(const [groupName,looseFiles]of deltas)updates.push(await patchAssetPackGroupFromLooseFiles({publicRoot,previousIndex:previous,groupName,looseFiles,outputRoot:path.join(publicRoot,'assets/packs/incremental/effects',groupName)}));
 const next={...previous,generatedAt:new Date().toISOString(),groups:[...previous.groups.filter(r=>!deltas.has(r.name)),...updates.flatMap(r=>r.groups)],assets:[...previous.assets.filter(r=>!deltas.has(r.group)),...updates.flatMap(r=>r.assets)].sort((a,b)=>a.path.localeCompare(b.path))};
 for(const file of files)if(next.assets.filter(r=>r.path===file).length!==1)throw Error('Effect pack publication closure: '+file);
 await publishAssetPackManifest(publicRoot, target,Buffer.from(JSON.stringify(next)),{logLabel:'effect-packs'});await buildWebAssetManifest();await refreshGeneratedManifestSidecars({publicRoot,onlyWhenStale:true});console.log('Published '+files.length+' effect resources.');
});
