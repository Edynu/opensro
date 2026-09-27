import fs from 'node:fs/promises';
import path from 'node:path';
import {characterMaterialBindings,resolveCharacterMaterialBinding} from './characterMaterialBindings.mjs';
import {applyCharacterMaterialState} from '../shared/characterMaterialState.mjs';
import {embedCharacterEnvironment} from '../shared/characterEnvironment.mjs';
import {equipmentGlowCatalog,embedEquipmentGlows} from './equipmentGlowMetadata.mjs';
import {publicRoot} from '../world/paths.mjs';
import {readPublishedAssetBytesSync} from '../../lib/publishedAsset.mjs';
import {withGeneratedAssetsLock} from '../../rebuildLock.mjs';
import {publishBytesAtomically} from '../shared/atomicPublish.mjs';
import {refreshPrecompressedSidecars} from '../generatedManifestSidecars.mjs';
import {reconcileAssetPackGroupFromLooseAuthority} from '../assetPackGroupAuthority.mjs';
import {publishAssetPackManifest} from '../assetPackPublication.mjs';
import {buildWebAssetManifest} from '../webManifest.mjs';

await withGeneratedAssetsLock('character material publication',async()=>{
 const rosterPath=path.join(publicRoot,'assets/char/roster.json'),roster=JSON.parse(await fs.readFile(rosterPath,'utf8'));
 const indexPath=path.join(publicRoot,'assets/packs/manifest.json'),previous=JSON.parse(await fs.readFile(indexPath,'utf8'));
 const bindings=await characterMaterialBindings(roster),prepared=[],coverage=[];
 const glowCatalog=equipmentGlowCatalog(),glowModels=new Map();
 for(const [id,row]of Object.entries(roster.dress.equipment??{}))if((row.slot===6||row.slot===7)&&glowCatalog.has(Number(id)))for(const body of Object.values(row.bodies)){if(!body)continue;if(!glowModels.has(body.glb))glowModels.set(body.glb,new Set());glowModels.get(body.glb).add(id);}
 for(const asset of new Set([...bindings.keys(),...glowModels.keys()])){
  const sources=bindings.get(asset);
  const old=readPublishedAssetBytesSync(asset,publicRoot),jsonLength=old.readUInt32LE(12),j=JSON.parse(old.subarray(20,20+jsonLength)),assigned=new Map();
  const binaryOffset=28+jsonLength,binary=[old.subarray(binaryOffset)],environmentCache=new Map();let binaryLength=binary[0].length;
  const appendView=bytes=>{const pad=(4-binaryLength%4)%4;if(pad){binary.push(Buffer.alloc(pad));binaryLength+=pad;}const index=j.bufferViews.length;j.bufferViews.push({buffer:0,byteOffset:binaryLength,byteLength:bytes.length});binary.push(bytes);binaryLength+=bytes.length;return index;};
  if(sources)for(const mesh of j.meshes??[])for(const primitive of mesh.primitives){
   const m=j.materials[primitive.material],binding=resolveCharacterMaterialBinding(sources,mesh.name,m.name);
   const next=applyCharacterMaterialState(structuredClone(m),binding.flags,binding.environmentModifiers),signature=JSON.stringify(next);
   if(assigned.has(primitive.material)&&assigned.get(primitive.material)!==signature)throw Error('Shared material crosses native part states: '+asset);
   assigned.set(primitive.material,signature);j.materials[primitive.material]=next;
   embedCharacterEnvironment(j,next,appendView,environmentCache);
   coverage.push({asset,mesh:mesh.name,material:m.name,source:binding.bsrPath,flags:binding.flags,environmentCount:binding.environmentModifiers.length,alphaCutoff:next.alphaCutoff??0,doubleSided:next.doubleSided});
  }
  embedEquipmentGlows(j,glowModels.get(asset)??[],glowCatalog,appendView);
  j.buffers[0].byteLength=binaryLength;
  const raw=Buffer.from(JSON.stringify(j)),chunk=Buffer.alloc((raw.length+3)&~3,32);raw.copy(chunk);
  const bin=Buffer.concat(binary),tail=Buffer.alloc(8+((bin.length+3)&~3));tail.writeUInt32LE(tail.length-8,0);tail.writeUInt32LE(0x004e4942,4);bin.copy(tail,8);
  const header=Buffer.from(old.subarray(0,20));header.writeUInt32LE(20+chunk.length+tail.length,8);header.writeUInt32LE(chunk.length,12);
  prepared.push({asset,bytes:Buffer.concat([header,chunk,tail])});
 }
 const changed=new Set(['/assets/char/roster.json']);
 for(const {asset,bytes}of prepared){await publishBytesAtomically(path.join(publicRoot,asset),bytes);changed.add(asset);for(const row of roster.models){if(row.glb===asset)row.bytes=bytes.length;if(row.previewGlb===asset)row.previewBytes=bytes.length;}}
 await publishBytesAtomically(rosterPath,Buffer.from(JSON.stringify(roster)));await refreshPrecompressedSidecars([rosterPath],{onlyWhenStale:true});
 const groups=new Set(previous.assets.filter(a=>changed.has(a.path)).map(a=>a.group)),updates=[];
 for(const groupName of groups)updates.push(await reconcileAssetPackGroupFromLooseAuthority({publicRoot,outputRoot:path.join(publicRoot,'assets/packs/incremental/character-materials',groupName),previousIndex:previous,groupName}));
 const next={...previous,generatedAt:new Date().toISOString(),groups:[...previous.groups.filter(g=>!groups.has(g.name)),...updates.flatMap(u=>u.groups)],assets:[...previous.assets.filter(a=>!groups.has(a.group)),...updates.flatMap(u=>u.assets)].sort((a,b)=>a.path.localeCompare(b.path))};
 await publishAssetPackManifest(publicRoot,indexPath,Buffer.from(JSON.stringify(next)));await buildWebAssetManifest();await refreshPrecompressedSidecars([indexPath,path.join(publicRoot,'assets/manifest.json')],{onlyWhenStale:true});
 const evidence=path.join(publicRoot,'../../client-next/temp/artifacts/character-texture/material-publication.json');await fs.writeFile(evidence,JSON.stringify({models:prepared.length,coverage},null,2));
 console.log('Published native material coverage for '+prepared.length+' models');
});
