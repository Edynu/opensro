import {publishAssetPackManifest} from './build/assetPackPublication.mjs';
import {readFile,copyFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {withGeneratedAssetsLock} from './rebuildLock.mjs';
import {buildAlarmSoundResource} from './build/shared/audioResources.mjs';
import {patchAssetPackGroupFromLooseFiles} from './build/sparseAssetPackGroupRefresh.mjs';
import {buildWebAssetManifest} from './build/webManifest.mjs';
import {refreshGeneratedManifestSidecars} from './build/generatedManifestSidecars.mjs';

const root=path.resolve(import.meta.dirname,'..'),publicRoot=path.join(root,'.generated/client-public');
await withGeneratedAssetsLock('Quick status and alarm asset publication',async()=>{
 const images=[];
 for(const kind of ['hp','mp']){
  const relative=`assets/images/Media_extracted/interface/ifcommon/quick_${kind}.png`;
  const target=path.join(publicRoot,relative);await mkdir(path.dirname(target),{recursive:true});
  await copyFile(path.join(root,relative),target);images.push('/'+relative);
 }
 const sound=await buildAlarmSoundResource(),manifestPath=path.join(publicRoot,'assets/packs/manifest.json');
 const previous=JSON.parse(await readFile(manifestPath,'utf8')),deltas=new Map();
 for(const file of [...images,sound]){
  const group=previous.assets.find(row=>row.path===file)?.group??(file===sound?'game-audio':'native-ui');
  const files=deltas.get(group)??[];files.push(file);deltas.set(group,files);
 }
 const updates=[];
 for(const [groupName,looseFiles] of deltas)updates.push(await patchAssetPackGroupFromLooseFiles({publicRoot,previousIndex:previous,groupName,looseFiles,outputRoot:path.join(publicRoot,'assets/packs/incremental/quick-status',groupName)}));
 const next={...previous,generatedAt:new Date().toISOString(),groups:[...previous.groups.filter(row=>!deltas.has(row.name)),...updates.flatMap(row=>row.groups)],assets:[...previous.assets.filter(row=>!deltas.has(row.group)),...updates.flatMap(row=>row.assets)].sort((a,b)=>a.path.localeCompare(b.path))};
 for(const file of [...images,sound])if(next.assets.filter(row=>row.path===file).length!==1)throw Error('Quick status publication closure: '+file);
 await publishAssetPackManifest(publicRoot, manifestPath,Buffer.from(JSON.stringify(next)),{logLabel:'quick-status-packs'});
 await buildWebAssetManifest();await refreshGeneratedManifestSidecars({publicRoot,onlyWhenStale:true});
 console.log('Published quick status HP/MP images and native alarm sound.');
});
