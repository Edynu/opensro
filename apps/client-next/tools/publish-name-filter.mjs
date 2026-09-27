import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {withGeneratedAssetsLock} from '../../../scripts/rebuildLock.mjs';
import {patchAssetPackGroupFromLooseFiles} from '../../../scripts/build/sparseAssetPackGroupRefresh.mjs';
import {publishBytesAtomically} from '../../../scripts/build/shared/atomicPublish.mjs';
import {buildWebAssetManifest} from '../../../scripts/build/webManifest.mjs';
import {refreshGeneratedManifestSidecars} from '../../../scripts/build/generatedManifestSidecars.mjs';
const publicRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../.generated/client-public');
await withGeneratedAssetsLock('native character name filter publication',async()=>{
 const file=path.join(publicRoot,'assets/packs/manifest.json'),previous=JSON.parse(await readFile(file,'utf8'));
 const updated=await patchAssetPackGroupFromLooseFiles({publicRoot,outputRoot:path.join(publicRoot,'assets/packs/incremental/name-filter'),previousIndex:previous,groupName:'game-data',looseFiles:['/assets/textdata/abusefilter.txt']});
 const merged={...previous,generatedAt:new Date().toISOString(),groups:[...previous.groups.filter(g=>g.name!=='game-data'),...updated.groups].sort((a,b)=>a.name.localeCompare(b.name)),assets:[...previous.assets.filter(a=>a.group!=='game-data'),...updated.assets].sort((a,b)=>a.path.localeCompare(b.path))};
 await publishBytesAtomically(file,Buffer.from(JSON.stringify(merged)),{logLabel:'native-name-filter'});
 await buildWebAssetManifest();await refreshGeneratedManifestSidecars({publicRoot,onlyWhenStale:true,brotliQuality:4,gzipLevel:3,zstdLevel:3});
 console.log('Native name filter published through the asset pack authority.');
});
