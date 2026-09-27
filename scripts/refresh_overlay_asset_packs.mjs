import {publishAssetPackManifest} from './build/assetPackPublication.mjs';
import {readFile,copyFile,mkdir,readdir} from 'node:fs/promises';
import path from 'node:path';
import {withGeneratedAssetsLock} from './rebuildLock.mjs';
import {patchAssetPackGroupFromLooseFiles} from './build/sparseAssetPackGroupRefresh.mjs';
import {buildWebAssetManifest} from './build/webManifest.mjs';
import {refreshGeneratedManifestSidecars} from './build/generatedManifestSidecars.mjs';

const root=path.resolve(import.meta.dirname,'..'),publicRoot=path.join(root,'.generated/client-public');
await withGeneratedAssetsLock('Party status and fortress overlay asset publication',async()=>{
 const images=[];
 for(const directory of ['icon','icon/stateodd','icon/etc','interface/ifcommon']){
  for(const file of await readdir(path.join(root,'assets/images/Media_extracted',directory))){
   if(directory==='icon'&&file!=='buf_effect.png')continue;
   if(directory==='icon/etc'&&!file.startsWith('mark_')&&file!=='fort_jangan.png')continue;
   if(directory==='interface/ifcommon'&&!file.startsWith('quickparty_move_')&&!file.startsWith('com_kindred_'))continue;
   if(!file.endsWith('.png'))continue;
   const relative='assets/images/Media_extracted/'+directory+'/'+file,target=path.join(publicRoot,relative);await mkdir(path.dirname(target),{recursive:true});await copyFile(path.join(root,relative),target);images.push('/'+relative);
  }
 }
 const manifestPath=path.join(publicRoot,'assets/packs/manifest.json');
 const previous=JSON.parse(await readFile(manifestPath,'utf8')),deltas=new Map();
 for(const file of images){
  const group=previous.assets.find(row=>row.path===file)?.group??'native-ui';
  const files=deltas.get(group)??[];files.push(file);deltas.set(group,files);
 }
 const updates=[];
 for(const [groupName,looseFiles] of deltas)updates.push(await patchAssetPackGroupFromLooseFiles({publicRoot,previousIndex:previous,groupName,looseFiles,outputRoot:path.join(publicRoot,'assets/packs/incremental/overlays',groupName)}));
 const next={...previous,generatedAt:new Date().toISOString(),groups:[...previous.groups.filter(row=>!deltas.has(row.name)),...updates.flatMap(row=>row.groups)],assets:[...previous.assets.filter(row=>!deltas.has(row.group)),...updates.flatMap(row=>row.assets)].sort((a,b)=>a.path.localeCompare(b.path))};
 for(const file of images)if(next.assets.filter(row=>row.path===file).length!==1)throw Error('Quick status publication closure: '+file);
 await publishAssetPackManifest(publicRoot, manifestPath,Buffer.from(JSON.stringify(next)),{logLabel:'quick-status-packs'});
 await buildWebAssetManifest();await refreshGeneratedManifestSidecars({publicRoot,onlyWhenStale:true});
 console.log('Published party status, fortress and party control assets.');
});
