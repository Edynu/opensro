import {loadMaterialTextures} from '../shared/jmxAssetIO.mjs';
import {parseJmxResourceBsr} from '../world/objects/formats.mjs';
import {characterMaterialVariants} from './materialVariants.mjs';

// Replace only the JSON chunk; geometry, BAN/VAT accessors and embedded images
// retain their original binary bytes and offsets.
export async function entityMaterialMetadata(bytes,source,bsrPath,slot){
 const bsr=parseJmxResourceBsr(source,bsrPath);
 const selected=slot===undefined?bsr.materialPaths:[characterMaterialVariants(source,bsrPath).get(slot)];
 if(selected.some(path=>!path))throw Error('Missing native material variant '+bsrPath+':'+slot);
 const materials=await loadMaterialTextures(selected,{onWarning:message=>{throw Error(message);}});
 if(bytes.readUInt32LE(0)!==0x46546c67||bytes.readUInt32LE(4)!==2||bytes.readUInt32LE(8)!==bytes.length||bytes.readUInt32LE(16)!==0x4e4f534a)throw Error('Invalid entity GLB');
 const end=20+bytes.readUInt32LE(12),document=JSON.parse(bytes.subarray(20,end));
 for(const material of document.materials??[]){
  const native=materials.get(material.name)??[...materials].find(([name])=>name.toLowerCase()===material.name.toLowerCase())?.[1];
  if(!native)throw Error('Unbound entity material '+bsrPath+':'+material.name);
  material.extras={...material.extras,sroMaterialIndex:native.materialIndex,sroMaterialSet:native.materialSetPath,sroBsrModifiers:{materialModifiers:bsr.modifiers.materialModifiers,textureModifiers:bsr.modifiers.textureModifiers}};
 }
 const json=Buffer.from(JSON.stringify(document)),padded=Buffer.alloc((json.length+3)&~3,0x20);json.copy(padded);
 const header=Buffer.from(bytes.subarray(0,20));header.writeUInt32LE(20+padded.length+bytes.length-end,8);header.writeUInt32LE(padded.length,12);
 return Buffer.concat([header,padded,bytes.subarray(end)]);
}
