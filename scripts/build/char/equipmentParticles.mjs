import fs from 'node:fs';
import path from 'node:path';
import {clientV150ResinfoRoot,retailTextdataRoot} from '../world/paths.mjs';
import {loadEquipmentRecords} from './equipmentVisualRecords.mjs';
import {loadDataAsset} from '../shared/jmxAssetIO.mjs';
import {parseCharacterBsr,parseBsk} from './formats.mjs';

export function equipmentParticleCatalog(records=loadEquipmentRecords(retailTextdataRoot)){
 const byCode=new Map([...records.values()].map(r=>[r.code,r])),out={};
 for(const line of fs.readFileSync(path.join(clientV150ResinfoRoot,'itemrare.txt'),'utf8').split(/\r?\n/)){
  if(!line.trim()||line.trim().startsWith('//'))continue;
  const c=line.trim().split(/\s+/),item=byCode.get(c[0]);if(!item||item.specialState!==2)continue;
  if(c.length!==5||!Number.isFinite(Number(c[2]))||Number(c[2])<=0||c[4]!=='none')throw Error('Unsupported itemrare row '+line);
  const effectPath=c[1].replaceAll('\\','/').toLowerCase();if(!effectPath.endsWith('.efp')||effectPath.includes('..'))throw Error('Invalid special-state effect');
  (out[item.id]??=[]).push({effectPath,bone:c[3],scale:Math.fround(Number(c[2])/100),offset:[0,0,0],root:false});
 }
 return out;
}

/** Native ABC680 -> AB5870/AB68C0. Keep the private local hierarchy, including
 * sockets that no mesh weights reference. A namesake in the body is not this bone. */
export async function publishEquipmentParticleMetadata(dress){
 const records=loadEquipmentRecords(retailTextdataRoot),particles=equipmentParticleCatalog(records),cache=new Map();
 dress.specialGlows=particles;
 for(const [id,effects]of Object.entries(particles)){
  const record=records.get(Number(id)),visual=dress.equipment[id];if(!visual)continue;
  for(const [body,entry]of Object.entries(visual.bodies)){
   if(!entry)continue;
   const dual=record.tid[2]===6&&[9,13].includes(record.tid[3]);
   const model=record.resolvedModel,paths=dual?[model.replace(/\.bsr$/,'_r.bsr'),model.replace(/\.bsr$/,'_l.bsr')]:[record.tid[2]===6&&record.tid[3]===14&&body.endsWith('_W')?model.replace(/\.bsr$/,'_f.bsr'):model];
   if(entry.parts.length!==paths.length)throw Error('Equipment private branch/part mismatch '+id);
   entry.branches=[];
   for(let i=0;i<paths.length;i++){
    const source=paths[i];let branch=cache.get(source);
    if(!branch){
     const bsr=parseCharacterBsr(await loadDataAsset(source),source);
     if(!bsr.skeletonPath||!bsr.skeletonAttachBone||bsr.animationPaths.length)throw Error('Unresolved special-state private branch '+source);
     const skeleton=parseBsk(await loadDataAsset(bsr.skeletonPath),bsr.skeletonPath);
     branch={attachBone:bsr.skeletonAttachBone,nodes:skeleton.bones.map(b=>({name:b.name,parent:b.parentIndex,translation:[b.local.t[0],b.local.t[1],-b.local.t[2]],rotation:[-b.local.q[0],-b.local.q[1],b.local.q[2],b.local.q[3]],scale:[1,1,1]}))};cache.set(source,branch);
    }
    for(const effect of effects)if(!branch.nodes.some(n=>n.name===effect.bone))throw Error('Missing native special-state socket '+source+':'+effect.bone);
    entry.branches.push({...branch,part:entry.parts[i]});
   }
  }
 }
 return {items:Object.keys(particles).length,sources:cache.size};
}
