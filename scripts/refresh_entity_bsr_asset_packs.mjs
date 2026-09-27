import {buildSkillStageModelAssets} from './build/char/buildSkillStageModelAssets.mjs';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {withGeneratedAssetsLock} from './rebuildLock.mjs';
import {publishEntityBsrModifiers} from './build/char/publishEntityBsrModifiers.mjs';
import {buildEffectProgramsAsset} from './build/effects/buildEffectPrograms.mjs';
import {patchAssetPackGroupFromLooseFiles} from './build/sparseAssetPackGroupRefresh.mjs';
import {publishAssetPackManifest} from './build/assetPackPublication.mjs';
import {buildWebAssetManifest} from './build/webManifest.mjs';
import {refreshGeneratedManifestSidecars,refreshPrecompressedSidecars} from './build/generatedManifestSidecars.mjs';
import {publicRoot} from './build/world/paths.mjs';
await withGeneratedAssetsLock('Entity BSR dependency publication',async()=>{
 let manifests=await publishEntityBsrModifiers();
 if(process.argv.includes('--skillfx')){await buildSkillStageModelAssets();const stage=JSON.parse(await readFile(path.join(publicRoot,'assets/skillfx/manifest.json'),'utf8'));manifests.push('/assets/skillfx/manifest.json',...Object.values(stage.models).map(row=>row.glb));}
 await buildEffectProgramsAsset();
 if(process.argv.includes('--rebuilt-npc')){
  const npc=JSON.parse(await readFile(path.join(publicRoot,'assets/npc/manifest.json'),'utf8'));
  for(const row of Object.values(npc.models))manifests.push(row.glb,...Object.values(row.materialVariants??{}),...(row.vat?[row.vat.manifest,row.vat.bin]:[]));
  manifests.push('/assets/npc/animation-catalog.json');manifests=[...new Set(manifests)];
 }
 console.log('[entity-bsr-packs] Refreshing compressed sidecars for '+manifests.length+' dependencies.');
 await refreshPrecompressedSidecars(manifests.map(url=>path.join(publicRoot,url)),{onlyWhenStale:true});
 const programs=JSON.parse(await readFile(path.join(publicRoot,'assets/effects/programs.json'),'utf8'));
 const target=path.join(publicRoot,'assets/packs/manifest.json'),previous=JSON.parse(await readFile(target,'utf8')),deltas=new Map();
 // Preserve and refresh every existing logical representation. VAT JSON was
 // originally packed without gzip; refreshing only its sidecar leaves clients
 // which request the plain logical path on the old source identity.
 const existingPaths=new Set(previous.assets.map(row=>row.path));
 const jsonPaths=[...manifests.filter(url=>url.endsWith('.json')),'/assets/effects/programs.json'];
 const files=[...new Set([...manifests.filter(url=>!url.endsWith('.json')),...jsonPaths.flatMap(url=>existingPaths.has(url)?[url,url+'.gz']:[url+'.gz']),...Object.values(programs.textures)])];
 for(const file of files){const group=previous.assets.find(a=>a.path===file)?.group??(file.endsWith('.gz')?'game-data':file.endsWith('.glb')||file.endsWith('.vat.bin')?'game-models':'game-images');const rows=deltas.get(group)??[];rows.push(file);deltas.set(group,rows);}
 const updates=[];for(const [groupName,looseFiles] of deltas){console.log('[entity-bsr-packs] Updating '+groupName+' ('+looseFiles.length+' dependencies).');updates.push(await patchAssetPackGroupFromLooseFiles({publicRoot,previousIndex:previous,groupName,looseFiles,outputRoot:path.join(publicRoot,'assets/packs/incremental/entity-bsr',groupName)}));}
 const next={...previous,generatedAt:new Date().toISOString(),groups:[...previous.groups.filter(r=>!deltas.has(r.name)),...updates.flatMap(r=>r.groups)],assets:[...previous.assets.filter(r=>!deltas.has(r.group)),...updates.flatMap(r=>r.assets)].sort((a,b)=>a.path.localeCompare(b.path))};
 for(const file of files)if(next.assets.filter(r=>r.path===file).length!==1)throw Error('Entity BSR pack closure: '+file);
 await publishAssetPackManifest(publicRoot,target,Buffer.from(JSON.stringify(next)),{logLabel:'entity-bsr-packs'});
 await buildWebAssetManifest();await refreshGeneratedManifestSidecars({publicRoot,onlyWhenStale:true});
 console.log('Published '+files.length+' entity BSR dependencies'+(process.argv.includes('--rebuilt-npc')?' including rebuilt NPC model/VAT references.':' without rebuilding mesh/VAT payloads.'));
});
