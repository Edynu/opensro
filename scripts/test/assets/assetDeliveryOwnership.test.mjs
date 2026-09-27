import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {prepareAssetDelivery,validateAssetDelivery} from '../../build/assetDelivery.mjs';
test('partial publication cannot replace the complete delivery catalog',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'sro-delivery-owner-'));
 try{
  await mkdir(path.join(root,'assets/packs/incremental/hawk'),{recursive:true});
  const bytes=Buffer.alloc(70000,12),sha256=createHash('sha256').update(bytes).digest('hex');
  await writeFile(path.join(root,'assets/hawk.glb'),bytes);await writeFile(path.join(root,'assets/terrain.glb'),bytes);
  const entry=name=>({path:`/assets/${name}.glb`,packPath:'/assets/packs/base.bin',offset:0,length:bytes.length,sha256});
  const complete={groups:[],assets:[entry('hawk'),entry('terrain')]};await prepareAssetDelivery(complete,root);
  const globalPath=path.join(root,'assets/packs/delivery.json'),before=await readFile(globalPath);
  const partial={groups:[],assets:[entry('hawk')]},partialPath=path.join(root,'assets/packs/incremental/hawk/delivery.json');await prepareAssetDelivery(partial,root,partialPath);
  assert.deepEqual(await readFile(globalPath),before);validateAssetDelivery(complete,JSON.parse(before));
  const local=JSON.parse(await readFile(partialPath,'utf8'));assert.equal(local.assets.length,1);validateAssetDelivery(partial,local);
  await assert.rejects(prepareAssetDelivery(partial,root,path.join(root,'../escaped.json')),/escaped publication/);
 }finally{assert.equal(path.dirname(root),path.resolve(tmpdir()));assert.ok(path.basename(root).startsWith('sro-delivery-owner-'));await rm(root,{recursive:true,force:true});}
});
