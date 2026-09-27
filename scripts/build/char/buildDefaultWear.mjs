import {retailTextdataRoot} from '../world/paths.mjs';
import {resolveRoster} from './resolveCharRoster.mjs';
import {buildItemSetGlb,createDonorPool} from './buildRoster.mjs';

// 8E91C0's table includes EU defaults for ownerless/nonplayer models;
// live EU players are rejected by the caller. 8E8EF0 uses material IDs 0/3/4.
export async function buildDefaultWear(dress){
 const donorFor=createDonorPool(resolveRoster(retailTextdataRoot).resolved);
 dress.defaultWear={};dress.fortressWear={};
 for(const race of ['CH','EU'])for(const sex of ['M','W']){
  const donor=await donorFor(race,sex);if(!donor)throw Error(`Missing clothing donor ${race}/${sex}`);
  for(const family of ['clothes','light'])for(const part of ['BA','LA']){
   const key=`${race}_${sex}_${family}_${part}`;
   const entry=await buildItemSetGlb({tag:'default-wear',key,...donor,pieces:[{part,itemBsrPath:`res/item/${race==='CH'?'china':'europe'}/${sex==='M'?'man':'woman'}_item/${family}_${race==='CH'?'00':'01'}_${part.toLowerCase()}.bsr`}],outSubdir:'equipment'});
   if(!entry)throw Error(`Missing default wear ${key}`);dress.defaultWear[key]=entry;
  }
  // EU players never attach this resource; EU ownerless character previews can.
  for(const materialSetId of [0,3,4]){
   const key=`${race}_${sex}_${materialSetId}`;
   const entry=await buildItemSetGlb({tag:'fortress-wear',key:'fortress_'+key,...donor,pieces:[{part:'FORT',itemBsrPath:`res/item/etc/fort_${sex==='M'?'man':'woman'}.bsr`,materialSetId}],outSubdir:'equipment'});
   if(!entry)throw Error(`Missing fortress wear ${key}`);dress.fortressWear[key]=entry;
  }
 }
}
