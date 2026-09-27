import {parseJmxResourceBsr} from '../world/objects/formats.mjs';

// 861B00 -> 8E7D10 -> 87B260 -> A9E310 -> A3C880 selects a BMT
// slot, not an animation set. Keep the authored slot identities intact.
export function characterMaterialVariants(buffer, source) {
  const {setIds, paths} = parseJmxResourceBsr(buffer, source).materialSection;
  const result = new Map();
  for (let i = 0; i < setIds.length; i++) {
    const id = setIds[i];
    if (!Number.isInteger(id) || id < 0 || id > 4 || result.has(id)) {
      throw Error(`Invalid character material slot ${id}: ${source}`);
    }
    result.set(id, paths[i]);
  }
  return result;
}
