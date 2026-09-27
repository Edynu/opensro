import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {readFileSync, existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {zstdDecompressSync} from 'node:zlib';
import {build} from 'esbuild';
import {readPublishedAssetBytesSync, readPublishedAssetJsonSync} from '../../../../scripts/lib/publishedAsset.mjs';
const entry='src/engine/runtime/assets/worker/model/model.ts';
const built=await build({entryPoints:[entry],bundle:true,platform:'node',format:'esm',write:false,footer:{js:`//# sourceURL=${entry}`}});
const {createModelDecoder}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].contents).toString('base64'));
test('every published NPC model passes the production character decoder',()=>{
 const publicRoot=path.resolve('../../.generated/client-public'),manifest=readPublishedAssetJsonSync('/assets/npc/manifest.json',publicRoot);
 const paths=new Set(Object.values(manifest.models).map(model=>model.glb));
 assert.ok(paths.size>0,'NPC manifest must contain models');
 const decoder=createModelDecoder();
 for(const resource of paths){
  assert.equal(typeof resource,'string');
  assert.doesNotThrow(()=>decoder.character(decoder.decode(readPublishedAssetBytesSync(resource,publicRoot))),resource);
 }
});
test('packed NPC models match their published authority and pass the production decoder',()=>{
 const publicRoot=path.resolve('../../.generated/client-public'),index=JSON.parse(readFileSync(path.join(publicRoot,'assets/packs/manifest.json'),'utf8'));
 const manifest=readPublishedAssetJsonSync('/assets/npc/manifest.json',publicRoot),paths=new Set(Object.values(manifest.models).map(model=>model.glb));
 const grouped=new Map();
 for(const resource of paths){
  const member=index.assets.find(asset=>asset.path===resource);assert.ok(member,`Unpacked NPC ${resource}`);
  if(!grouped.has(member.packPath))grouped.set(member.packPath,[]);grouped.get(member.packPath).push(member);
 }
 const decoder=createModelDecoder();
 for(const [packPath,members] of grouped){
  const pack=index.groups.flatMap(group=>group.packs).find(pack=>pack.path===packPath),identity=path.join(publicRoot,packPath);
  const bytes=existsSync(identity)?readFileSync(identity):zstdDecompressSync(readFileSync(path.join(publicRoot,pack.zstdPath??`${packPath}.zst`)));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),pack.sha256);
  const start=12+bytes.readUInt32LE(8);
  for(const member of members){
   const model=bytes.subarray(start+member.offset,start+member.offset+member.length);
   assert.equal(createHash('sha256').update(model).digest('hex'),member.sha256,member.path);
   assert.deepEqual(model,readPublishedAssetBytesSync(member.path,publicRoot),`Stale packed NPC ${member.path}`);
   assert.doesNotThrow(()=>decoder.character(decoder.decode(model)),member.path);
  }
 }
});

test('special COS references share authored state-50 models and matching VAT clips',()=>{
 const root=path.resolve('../../.generated/client-public'),manifest=readPublishedAssetJsonSync('/assets/npc/manifest.json',root);
 const rows=Object.values(manifest.models).filter(row=>row.kind==='cos');
 assert.equal(rows.length,1130);assert.equal(new Set(rows.map(row=>row.glb)).size,22);
 for(const row of rows){assert.equal(row.animationStates.emote0.stateId,50);assert.ok(row.clips.includes('emote0'));assert.ok(row.vat.clips.includes('emote0'),row.codename);}
});

test('every authored item drop passes the production model decoder',()=>{
 const publicRoot=path.resolve('../../.generated/client-public'),manifest=readPublishedAssetJsonSync('/assets/itemdrop/manifest.json',publicRoot),decoder=createModelDecoder();
 const entries=Object.values(manifest.models);assert.equal(entries.length,38);
 for(const row of entries){const model=decoder.character(decoder.decode(readPublishedAssetBytesSync(row.glb,publicRoot)));assert.ok(model.primitives.length,row.glb);for(const clip of row.clips)assert.ok(model.clips.some(c=>c.name===clip),row.glb+': '+clip);}
});

test('all published cosmetic attachments are packed and accepted by the production decoder',()=>{
 const publicRoot=path.resolve('../../.generated/client-public'),roster=readPublishedAssetJsonSync('/assets/char/roster.json',publicRoot),index=readPublishedAssetJsonSync('/assets/packs/manifest.json',publicRoot),decoder=createModelDecoder();
 const rows=Object.values(roster.dress.cosmetics);assert.equal(rows.length,52);
 for(const row of rows){const bytes=readPublishedAssetBytesSync(row.glb,publicRoot),members=index.assets.filter(a=>a.path===row.glb);assert.equal(members.length,1,row.glb);assert.equal(createHash('sha256').update(bytes).digest('hex'),members[0].sha256,row.glb);assert.ok(decoder.character(decoder.decode(bytes)).primitives.length,row.glb);}
});

for(const enabled of [false,true])test(`ordinary clothing ambient uses ${enabled?'native actor':'compatibility BMT'} input`,async()=>{
 const variant=await build({entryPoints:[entry],bundle:true,platform:'node',format:'esm',write:false,plugins:enabled?[{name:'native-lighting-test',setup(build){build.onLoad({filter:/video-options\.ts$/},args=>({contents:readFileSync(args.path,'utf8').replace('NATIVE_CHARACTER_LIGHTING = false','NATIVE_CHARACTER_LIGHTING = true'),loader:'ts'}));}}]:[]});
 const {createModelDecoder}=await import('data:text/javascript;base64,'+Buffer.from(variant.outputFiles[0].contents).toString('base64'));
 const decoder=createModelDecoder(),doc=decoder.decode(readPublishedAssetBytesSync('/assets/char/dress/ch_m_heavy_01.glb',path.resolve('../../.generated/client-public'))),model=decoder.character(doc);
 assert.ok(model.primitives.length);
 const altered=structuredClone(doc);for(const m of altered.json.materials){m.extras={sroAmbientFactor:[.13,.29,.47,1]};m.pbrMetallicRoughness.baseColorFactor=[.71,.83,.97,1];}
 for(const p of decoder.character(altered).primitives){assert.equal(p.geometry.material.stageFactor,2);assert.equal(p.geometry.material.objectLight,1);assert.deepEqual(p.geometry.material.ambient,enabled?[.6,.6,.6]:[.13,.29,.47]);assert.deepEqual(p.geometry.material.color,[.71,.83,.97,1]);}
 altered.json.materials[0].extras.sroAmbientFactor=[1,2];assert.throws(()=>decoder.character(altered),/ambient/);
});
