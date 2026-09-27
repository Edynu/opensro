import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {retailMinimapArt} from '../../build/world/assets/copyMissionMinimapTileImages.mjs';
test('retail coverage refuses absent conversion and foreign converted art',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'sro-minimap-'));
 try{
  await mkdir(path.join(root,'minimap'));await mkdir(path.join(root,'minimap_d'));
  await writeFile(path.join(root,'minimap','10x20.ddj'),'source');
  const tile={publicPath:'/assets/images/Media_extracted/minimap/10x20.png'};
  assert.deepEqual(await retailMinimapArt([tile],root),[tile.publicPath]);
  await assert.rejects(retailMinimapArt([],root),/conversion missing/);
  await assert.rejects(retailMinimapArt([tile,{publicPath:'/assets/images/Media_extracted/minimap/10x21.png'}],root),/no retail source/);
 }finally{await rm(root,{recursive:true,force:true});}
});
