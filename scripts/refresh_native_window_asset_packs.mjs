import {publishAssetPackManifest} from './build/assetPackPublication.mjs';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {withGeneratedAssetsLock} from './rebuildLock.mjs';
import {patchAssetPackGroupFromLooseFiles} from './build/sparseAssetPackGroupRefresh.mjs';
import {buildWebAssetManifest} from './build/webManifest.mjs';
import {refreshGeneratedManifestSidecars} from './build/generatedManifestSidecars.mjs';
const root=path.resolve(import.meta.dirname,'..'),publicRoot=path.join(root,'.generated/client-public'),manifestPath=path.join(publicRoot,'assets/packs/manifest.json');
await withGeneratedAssetsLock('Native window texture publication',async()=>{
 const files=JSON.parse(execFileSync('python',[path.join(root,'scripts/tools/refresh_native_window_images.py')],{encoding:'utf8',env:process.env}));
 const previous=JSON.parse(await readFile(manifestPath,'utf8')),existing=new Map(previous.assets.map(a=>[a.path,a.group])),deltas=new Map();
 for(const file of files){const group=existing.get(file)??'native-ui';if(!deltas.has(group))deltas.set(group,[]);deltas.get(group).push(file);}
 const refreshed=[];for(const [groupName,looseFiles]of deltas)refreshed.push(await patchAssetPackGroupFromLooseFiles({publicRoot,outputRoot:path.join(publicRoot,'assets/packs/incremental/native-window',groupName),previousIndex:previous,groupName,looseFiles}));
 const groups=new Set(deltas.keys()),next={...previous,generatedAt:new Date().toISOString(),groups:[...previous.groups.filter(g=>!groups.has(g.name)),...refreshed.flatMap(r=>r.groups)].sort((a,b)=>a.name.localeCompare(b.name)),assets:[...previous.assets.filter(a=>!groups.has(a.group)),...refreshed.flatMap(r=>r.assets)].sort((a,b)=>a.path.localeCompare(b.path))};
 for(const file of files)if(!next.assets.some(a=>a.path===file))throw Error('Native window texture pack closure missing '+file);
 await publishAssetPackManifest(publicRoot, manifestPath,Buffer.from(JSON.stringify(next)),{logLabel:'native-window-packs'});
 await buildWebAssetManifest();await refreshGeneratedManifestSidecars({publicRoot,onlyWhenStale:true});
 console.log(`Published ${files.length} native RGB16 window textures.`);
});
