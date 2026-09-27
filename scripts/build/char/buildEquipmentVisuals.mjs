import {buildDefaultWear} from './buildDefaultWear.mjs';
import {defaultWearLanguage} from './defaultWearPolicy.mjs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {retailTextdataRoot,clientV150ResinfoRoot} from '../world/paths.mjs';
import {loadAvatarVisualOverrides} from './avatarVisualOverrides.mjs';
import {resolveRoster} from './resolveCharRoster.mjs';
import {resolveCrowdDressSets,resolveCrowdWeaponSets} from './resolveCrowdDress.mjs';
import {buildItemSetGlb,createDonorPool,buildAuxiliaryAvatarSets} from './buildRoster.mjs';
import {loadEquipmentRecords} from './equipmentVisualRecords.mjs';
import {equipmentGlowCatalog,equipmentGlowModelIds,equipmentGlowGlb} from './equipmentGlowMetadata.mjs';
import {publishEquipmentParticleMetadata} from './equipmentParticles.mjs';
import {publicRoot} from '../world/paths.mjs';
import {readPublishedAssetBytesSync} from '../../lib/publishedAsset.mjs';
import {publishBytesAtomically} from '../shared/atomicPublish.mjs';

export async function buildEquipmentVisuals(dress){
 dress.defaultWearLanguage=defaultWearLanguage();
 const rows=loadEquipmentRecords(retailTextdataRoot),getDonor=createDonorPool(resolveRoster(retailTextdataRoot).resolved),cache=new Map(),out={};
 // Separate native table: never inherit this from an item's linked model row.
 dress.avatarVisualOverrides=loadAvatarVisualOverrides(path.join(clientV150ResinfoRoot,'avataritemdata.txt'),rows);
 dress.avatarAuxiliary=await buildAuxiliaryAvatarSets(dress.avatarVisualOverrides);
 const cacheKey=(body,paths)=>body+':'+paths.join('|');
 // Reuse already converted resources by their SOURCE paths, never item names.
 for(const set of resolveCrowdDressSets(retailTextdataRoot,{CH:15,EU:15}))for(const [part,source] of set.parts){
  const entry=dress.sets[set.key];if(entry?.parts.includes(part))cache.set(cacheKey(`${set.race}_${set.gender}`,[source]),{...entry,parts:[part]});
 }
 for(const set of resolveCrowdWeaponSets(retailTextdataRoot,{CH:15,EU:15}))for(const sex of ['M','W']){
  const entry=dress.weapons[`${set.race}_${sex}_${set.kind}_${String(set.degree).padStart(2,'0')}`];
  if(entry)cache.set(cacheKey(`${set.race}_${sex}`,set.bsrPaths),entry);
 }
 let built=0;
 for(const row of rows.values()){
  const avatar=row.tid[0]===3&&row.tid[1]===1&&row.tid[2]===13;
  const record={slot:row.slot,armorClass:row.armorClass,thiefSuit:row.thiefSuit,visualMask:row.visualMask,visualPriority:row.visualPriority,source:row.modelSource,model:row.resolvedModel,...(avatar?{avatarSlot:row.tid[3]-1}:{}),bodies:{}};out[row.id]=record;
  if(row.slot===null&&!avatar)continue;
  for(const race of ['CH','EU'])for(const sex of ['M','W']){
   if(row.country!==3&&row.country!==(race==='CH'?0:1))continue;
   if(row.sex!==2&&row.sex!==(sex==='M'?1:0))continue;
   const body=`${race}_${sex}`,model=row.resolvedModel;
   if(!model){record.bodies[body]=null;continue;}
   // 870040: EU axes/daggers are paired; female harps use their authored _f resource.
   const dual=row.tid[2]===6&&[9,13].includes(row.tid[3]);
   const paths=dual?[model.replace(/\.bsr$/,'_r.bsr'),model.replace(/\.bsr$/,'_l.bsr')]:[row.tid[2]===6&&row.tid[3]===14&&sex==='W'?model.replace(/\.bsr$/,'_f.bsr'):model];
   const key=cacheKey(body,paths);let entry=cache.get(key)??(avatar?dress.cosmetics?.[`${body}_${row.id}`]:undefined);
   if(!entry){
    const donor=await getDonor(race,sex);if(!donor)throw Error(`Missing donor ${body}`);
    entry=await buildItemSetGlb({tag:'equipment',key:body+'_'+createHash('sha256').update(key).digest('hex').slice(0,20),...donor,pieces:paths.map((itemBsrPath,i)=>({part:`EQ${i}`,itemBsrPath})),outSubdir:'equipment'});
    if(!entry)throw Error(`Empty equipment conversion ${row.code}: ${paths}`);
    cache.set(key,entry);built++;
   }
   record.bodies[body]=entry;
  }
 }
 console.log(`[equipment] ${Object.keys(out).length} native item mappings; ${built} additional models`);
 await buildDefaultWear(dress);
 // Preserve native enhancement metadata in normal rebuilds as well as focused
 // material publication. Reused and freshly converted weapons share this gate.
 const glows=equipmentGlowCatalog();
 for(const [asset,ids]of equipmentGlowModelIds(out,glows))await publishBytesAtomically(path.join(publicRoot,asset),equipmentGlowGlb(readPublishedAssetBytesSync(asset,publicRoot),ids,glows));
 const metadata={...dress,equipment:out};await publishEquipmentParticleMetadata(metadata);
 dress.specialGlows=metadata.specialGlows;
 return out;
}
