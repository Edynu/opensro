import {readFile,copyFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {withGeneratedAssetsLock} from './rebuildLock.mjs';
import {runtimeCifImageReferences} from './build/shared/cifRuntimeImageCatalog.mjs';
import {patchAssetPackGroupFromLooseFiles} from './build/sparseAssetPackGroupRefresh.mjs';
import {mergeAssetPackGroupUpdates,publishAssetPackManifest} from './build/assetPackPublication.mjs';
import {buildWebAssetManifest} from './build/webManifest.mjs';
import {refreshGeneratedManifestSidecars} from './build/generatedManifestSidecars.mjs';

// The renderer's terrain dependency must be published, not merely present in
// the converted-image tree. Preserve all unrelated installed pack members.
const root=path.resolve(import.meta.dirname,'..'),publicRoot=path.join(root,'.generated/client-public');
await withGeneratedAssetsLock('Terrain footprint texture publication',async()=>{
 const references=runtimeCifImageReferences.filter(file=>/^effect\/footstep_(sand|snow)\.ddj$/.test(file));
 if(new Set(references).size!==2)throw Error('Footprint catalog must contain sand and snow');
 const files=[];
 for(const reference of references){
  const relative='assets/images/Media_extracted/'+reference.replace(/\.ddj$/,'.png');
  const target=path.join(publicRoot,relative);await mkdir(path.dirname(target),{recursive:true});
  await copyFile(path.join(root,relative),target);files.push('/'+relative);
 }
 const manifestPath=path.join(publicRoot,'assets/packs/manifest.json');
 const previous=JSON.parse(await readFile(manifestPath,'utf8')),deltas=new Map();
 for(const file of files){
  const group=previous.assets.find(row=>row.path===file)?.group??'game-images';
  const rows=deltas.get(group)??[];rows.push(file);deltas.set(group,rows);
 }
 const updates=[];
 for(const [groupName,looseFiles]of deltas)updates.push(await patchAssetPackGroupFromLooseFiles({publicRoot,previousIndex:previous,groupName,looseFiles,outputRoot:path.join(publicRoot,'assets/packs/incremental/footprints',groupName)}));
 const next=mergeAssetPackGroupUpdates(previous,updates,[...deltas.keys()]);
 for(const file of files)if(next.assets.filter(row=>row.path===file).length!==1)throw Error('Footprint publication closure: '+file);
 await publishAssetPackManifest(publicRoot,manifestPath,Buffer.from(JSON.stringify(next)),{logLabel:'footprint-packs'});
 await buildWebAssetManifest();await refreshGeneratedManifestSidecars({publicRoot,onlyWhenStale:true});
 console.log('Published sand and snow footprint textures.');
});
