import path from 'node:path';
import {resolveRoster} from './resolveCharRoster.mjs';
import {resolveCrowdDressSets,resolveCrowdWeaponSets} from './resolveCrowdDress.mjs';
import {parseJmxResourceBsr} from '../world/objects/formats.mjs';
import {loadDataAsset,loadMaterialTextures} from '../shared/jmxAssetIO.mjs';
import {retailTextdataRoot} from '../world/paths.mjs';
import {listTextDataShardNamesSync,readTextDataLinesSync,splitTextDataRow} from '../shared/textDataIo.mjs';

// The item's own BSR owns its modifiers; a skeleton donor never does.
export async function characterMaterialBindings(roster){
 const result=new Map(),cache=new Map();
 async function source(bsrPath){
  if(cache.has(bsrPath))return cache.get(bsrPath);
  const bsr=parseJmxResourceBsr(await loadDataAsset(bsrPath),bsrPath),materials=await loadMaterialTextures(bsr.materialPaths);
  const value={bsrPath,materials,environmentModifiers:bsr.modifiers?.environmentModifiers??[]};cache.set(bsrPath,value);return value;
 }
 const {resolved,missing}=resolveRoster(retailTextdataRoot);if(missing.length)throw Error('Unresolved character sources');
 const models=new Map(resolved.map(row=>[row.codename,row]));
 for(const row of roster.models){const native=models.get(row.codename);if(!native)throw Error('Missing model '+row.codename);const binding=new Map([['*',await source(native.bsrPath)]]);result.set(row.glb,binding);if(row.previewGlb)result.set(row.previewGlb,binding);}
 for(const set of resolveCrowdDressSets(retailTextdataRoot,{CH:9,EU:9})){const row=roster.dress.sets[set.key];if(!row)continue;const binding=new Map();for(const [part,bsr]of set.parts)binding.set('part:'+part,await source(bsr));result.set(row.glb,binding);}
 for(const set of resolveCrowdWeaponSets(retailTextdataRoot,{CH:9,EU:9}))for(const gender of ['M','W']){const key=`${set.race}_${gender}_${set.kind}_${String(set.degree).padStart(2,'0')}`,row=roster.dress.weapons[key];if(!row)continue;const binding=new Map();for(const [i,bsr]of set.bsrPaths.entries())binding.set('part:'+(i?'WL':'WA'),await source(bsr));result.set(row.glb,binding);}
 const cosmeticSources=new Map();
 for(const file of listTextDataShardNamesSync(retailTextdataRoot,/^itemdata.*\.txt$/i))for(const line of readTextDataLinesSync(path.join(retailTextdataRoot,file))){const cols=splitTextDataRow(line);if(cols[2]?.startsWith('ITEM_MALL_AVATAR_')&&cols[52]?.toLowerCase().endsWith('.bsr'))cosmeticSources.set(Number(cols[1]),'res/'+cols[52].replaceAll('\\','/').toLowerCase());}
 for(const row of Object.values(roster.dress.cosmetics??{})){const bsr=cosmeticSources.get(row.refObjId);if(!bsr)throw Error('Missing cosmetic source '+row.refObjId);result.set(row.glb,new Map([['part:AV'+row.slot,await source(bsr)]]));}
 for(const [id,row]of Object.entries(roster.dress.avatarAuxiliary??{})){const bsr=roster.dress.avatarVisualOverrides?.[id]?.additionalBsr;if(!bsr)throw Error('Missing auxiliary avatar source '+id);result.set(row.glb,new Map([['*',await source(bsr)]]));}
 for(const row of [...Object.values(roster.dress.sets),...Object.values(roster.dress.weapons),...Object.values(roster.dress.cosmetics??{})])if(!result.has(row.glb))throw Error('Unbound published item '+row.glb);
 return result;
}

export function resolveCharacterMaterialBinding(bindings,meshName,materialName){
 const source=bindings.get(meshName)??bindings.get('*');if(!source)throw Error('Missing native part '+meshName);
 const entry=[...source.materials].find(([name])=>name.toLowerCase()===materialName.toLowerCase());
 if(!entry)throw Error('Missing native material '+source.bsrPath+':'+materialName);
 return {flags:entry[1].flags,environmentModifiers:source.environmentModifiers,bsrPath:source.bsrPath};
}
