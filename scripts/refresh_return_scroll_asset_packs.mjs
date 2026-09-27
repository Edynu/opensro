import {publishAssetPackManifest} from './build/assetPackPublication.mjs';
import {readFile,copyFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {withGeneratedAssetsLock} from './rebuildLock.mjs';
import {patchAssetPackGroupFromLooseFiles} from './build/sparseAssetPackGroupRefresh.mjs';
import {buildWebAssetManifest} from './build/webManifest.mjs';
import {refreshGeneratedManifestSidecars} from './build/generatedManifestSidecars.mjs';
import {returnScrollRuntimeImageReferences} from './build/shared/cifRuntimeImageCatalog.mjs';
const root=path.resolve(import.meta.dirname,'..'),publicRoot=path.join(root,'.generated/client-public');
await withGeneratedAssetsLock('Native return-scroll texture publication',async()=>{
 const refs=[...returnScrollRuntimeImageReferences,...['','_focus','_press'].map(state=>'interface/ifcommon/com_casting_cancel'+state+'.ddj')],files=[];
 for(const ref of refs){const relative='assets/images/Media_extracted/'+ref.replace('.ddj','.png');await mkdir(path.dirname(path.join(publicRoot,relative)),{recursive:true});await copyFile(path.join(root,relative),path.join(publicRoot,relative));files.push('/'+relative);}
 const manifestPath=path.join(publicRoot,'assets/packs/manifest.json'),previous=JSON.parse(await readFile(manifestPath,'utf8')),deltas=new Map();
 for(const file of files){const group=previous.assets.find(a=>a.path===file)?.group??'native-ui';const rows=deltas.get(group)??[];rows.push(file);deltas.set(group,rows);}
 const updates=[];for(const [groupName,looseFiles]of deltas)updates.push(await patchAssetPackGroupFromLooseFiles({publicRoot,previousIndex:previous,groupName,looseFiles,outputRoot:path.join(publicRoot,'assets/packs/incremental/return-scrolls',groupName)}));
 const next={...previous,generatedAt:new Date().toISOString(),groups:[...previous.groups.filter(r=>!deltas.has(r.name)),...updates.flatMap(r=>r.groups)],assets:[...previous.assets.filter(r=>!deltas.has(r.group)),...updates.flatMap(r=>r.assets)].sort((a,b)=>a.path.localeCompare(b.path))};
 for(const file of files)if(next.assets.filter(r=>r.path===file).length!==1)throw Error('Return Scroll publication closure: '+file);
 await publishAssetPackManifest(publicRoot, manifestPath,Buffer.from(JSON.stringify(next)),{logLabel:'return-scroll-packs'});await buildWebAssetManifest();await refreshGeneratedManifestSidecars({publicRoot,onlyWhenStale:true});console.log('Published '+files.length+' native return-scroll textures.');
});
