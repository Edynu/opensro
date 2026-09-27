import {publishAssetPackManifest} from './build/assetPackPublication.mjs';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {withGeneratedAssetsLock} from './rebuildLock.mjs';
import {buildGuideImageResources} from './build/shared/cifResources.mjs';
import {buildTextResources} from './build/shared/textResources.mjs';
import {buildQuestDataAsset} from './build/data/buildQuestDataAsset.mjs';
import {refreshPrecompressedSidecars,refreshGeneratedManifestSidecars} from './build/generatedManifestSidecars.mjs';
import {patchAssetPackGroupFromLooseFiles} from './build/sparseAssetPackGroupRefresh.mjs';
import {buildWebAssetManifest} from './build/webManifest.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const publicRoot=path.join(root,'.generated/client-public'),manifestPath=path.join(publicRoot,'assets/packs/manifest.json');
await withGeneratedAssetsLock('Native guide data and inline-image publication',async()=>{
 await buildTextResources();
 buildQuestDataAsset();
 const images=await buildGuideImageResources();
 const catalog=path.join(publicRoot,'assets/data/event-guide-catalog.json');
 await refreshPrecompressedSidecars([catalog,path.join(publicRoot,'assets/data/questData.json'),path.join(publicRoot,'assets/text/texthelp.en.json'),path.join(publicRoot,'assets/text/textdataname.en.json')],{onlyWhenStale:true});
 const previous=JSON.parse(await readFile(manifestPath,'utf8')),existing=new Map(previous.assets.map(a=>[a.path,a.group]));
 // The guide reads both catalogs and the localized menu dictionary. Publishing
 // only the catalogs leaves Help labels and item descriptions on an old revision.
 const deltas=new Map([['game-data',['/assets/data/event-guide-catalog.json.gz','/assets/data/questData.json.gz','/assets/text/texthelp.en.json.gz','/assets/text/textdataname.en.json.gz']]]);
 for(const image of images.copiedImages){const group=existing.get(image)??'native-ui';if(!deltas.has(group))deltas.set(group,[]);deltas.get(group).push(image);}
 const refreshed=[];
 for(const [groupName,looseFiles]of deltas)refreshed.push(await patchAssetPackGroupFromLooseFiles({publicRoot,outputRoot:path.join(publicRoot,'assets/packs/incremental/guide',groupName),previousIndex:previous,groupName,looseFiles}));
 const groups=new Set(deltas.keys()),next={...previous,generatedAt:new Date().toISOString(),groups:[...previous.groups.filter(g=>!groups.has(g.name)),...refreshed.flatMap(r=>r.groups)].sort((a,b)=>a.name.localeCompare(b.name)),assets:[...previous.assets.filter(a=>!groups.has(a.group)),...refreshed.flatMap(r=>r.assets)].sort((a,b)=>a.path.localeCompare(b.path))};
 for(const [group,files]of deltas)for(const file of files)if(!next.assets.some(a=>a.path===file&&a.group===group))throw Error('Guide pack closure missing '+file);
 await publishAssetPackManifest(publicRoot, manifestPath,Buffer.from(JSON.stringify(next)),{logLabel:'guide-packs'});
 await buildWebAssetManifest();
 await refreshGeneratedManifestSidecars({publicRoot,onlyWhenStale:true});
 console.log(`Guide publication complete: ${images.references.length} inline image references, ${refreshed.reduce((n,r)=>n+r.builtPackCount,0)} packs rebuilt.`);
});
