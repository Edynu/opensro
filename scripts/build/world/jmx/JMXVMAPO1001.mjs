import {
  MAP_BLOCKS_PER_AXIS,
  MAPO2_LOD_GROUPS,
  MAPO2_PLACEMENT_BYTES,
  MAPO_SIGNATURE,
  SIGNATURE_BYTES
} from "../constants.mjs";
import { cleanFloat, decodeRegionId, ensureAvailable, readSignature } from "./common.mjs";
import { toHex16 } from "../paths.mjs";

export function parseJmxMapObjectPlacementO2(buffer, sourcePath = "<memory>") {
  const signature = readSignature(buffer, MAPO_SIGNATURE, sourcePath);
  let offset = SIGNATURE_BYTES;
  const blocks = [];
  const placements = [];
  const slotCounts = Array.from({ length: MAPO2_LOD_GROUPS }, () => 0);

  for (let blockZ = 0; blockZ < MAP_BLOCKS_PER_AXIS; blockZ += 1) {
    for (let blockX = 0; blockX < MAP_BLOCKS_PER_AXIS; blockX += 1) {
      const slots = [];

      for (let lodGroupIndex = 0; lodGroupIndex < MAPO2_LOD_GROUPS; lodGroupIndex += 1) {
        ensureAvailable(buffer, offset, 2, sourcePath);
        const count = buffer.readUInt16LE(offset);
        offset += 2;
        slotCounts[lodGroupIndex] += count;

        const firstPlacementIndex = placements.length;
        for (let placementIndex = 0; placementIndex < count; placementIndex += 1) {
          ensureAvailable(buffer, offset, MAPO2_PLACEMENT_BYTES, sourcePath);
          const recordOffset = offset;
          const objectId = buffer.readUInt32LE(offset);
          offset += 4;
          const x = cleanFloat(buffer.readFloatLE(offset));
          offset += 4;
          const y = cleanFloat(buffer.readFloatLE(offset));
          offset += 4;
          const z = cleanFloat(buffer.readFloatLE(offset));
          offset += 4;
          const isStatic = buffer.readInt16LE(offset);
          offset += 2;
          const yaw = cleanFloat(buffer.readFloatLE(offset));
          offset += 4;
          const uid = buffer.readInt16LE(offset);
          offset += 2;
          const short0 = buffer.readInt16LE(offset);
          offset += 2;
          const isBigRaw = buffer.readUInt8(offset);
          offset += 1;
          const isStructRaw = buffer.readUInt8(offset);
          offset += 1;
          const regionId = buffer.readUInt16LE(offset);
          offset += 2;

          placements.push({
            index: placements.length,
            blockX,
            blockZ,
            lodGroupIndex,
            blockPlacementIndex: placementIndex,
            recordOffset,
            objectId,
            position: {
              x,
              y,
              z
            },
            isStatic,
            yaw,
            uid,
            short0,
            isBig: isBigRaw !== 0,
            isStruct: isStructRaw !== 0,
            isBigRaw,
            isStructRaw,
            regionId: toHex16(regionId),
            region: decodeRegionId(regionId)
          });
        }

        slots.push({
          lodGroupIndex,
          count,
          firstPlacementIndex,
          lastPlacementIndex: count > 0 ? placements.length - 1 : null
        });
      }

      blocks.push({
        blockX,
        blockZ,
        slots,
        placementCount: slots.reduce((sum, slot) => sum + slot.count, 0)
      });
    }
  }

  if (offset !== buffer.length) {
    throw new Error(`${sourcePath}: consumed ${offset} bytes but file has ${buffer.length}`);
  }

  return {
    sourcePath,
    signature,
    byteLength: buffer.length,
    consumedBytes: offset,
    blockGrid: {
      width: MAP_BLOCKS_PER_AXIS,
      height: MAP_BLOCKS_PER_AXIS
    },
    placementRecordBytes: MAPO2_PLACEMENT_BYTES,
    slotCounts,
    uniqueObjectIds: [...new Set(placements.map((placement) => placement.objectId))].sort((a, b) => a - b),
    regionIds: [...new Set(placements.map((placement) => placement.regionId))].sort(),
    blocks,
    placements
  };
}
