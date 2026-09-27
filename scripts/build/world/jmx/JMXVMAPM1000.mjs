import {
  MAP_BLOCKS_PER_AXIS,
  MAPM_BLOCK_BYTES,
  MAPM_SIGNATURE,
  MAPM_TEXTURE_ATTRIBUTE_SHIFT,
  MAPM_TEXTURE_ID_MASK,
  MAPM_TILES_PER_AXIS,
  MAPM_VERTICES_PER_AXIS,
  SIGNATURE_BYTES
} from "../constants.mjs";
import { cleanFloat, readSignature } from "./common.mjs";

export function parseJmxMapTerrain(buffer, sourcePath = "<memory>") {
  const signature = readSignature(buffer, MAPM_SIGNATURE, sourcePath);
  const expectedLength = SIGNATURE_BYTES + MAP_BLOCKS_PER_AXIS * MAP_BLOCKS_PER_AXIS * MAPM_BLOCK_BYTES;

  if (buffer.length !== expectedLength) {
    throw new Error(`${sourcePath}: expected ${expectedLength} bytes for ${MAPM_SIGNATURE}, got ${buffer.length}`);
  }

  let offset = SIGNATURE_BYTES;
  const blocks = [];

  for (let blockZ = 0; blockZ < MAP_BLOCKS_PER_AXIS; blockZ += 1) {
    for (let blockX = 0; blockX < MAP_BLOCKS_PER_AXIS; blockX += 1) {
      const blockOffset = offset;
      const flag = buffer.readUInt32LE(offset);
      offset += 4;
      const environmentId = buffer.readUInt16LE(offset);
      offset += 2;

      const heights = [];
      const textureData = [];
      const textureIds = [];
      const textureScales = [];
      const brightness = [];

      for (let vertexIndex = 0; vertexIndex < MAPM_VERTICES_PER_AXIS * MAPM_VERTICES_PER_AXIS; vertexIndex += 1) {
        heights.push(cleanFloat(buffer.readFloatLE(offset)));
        offset += 4;

        const textureValue = buffer.readUInt16LE(offset);
        offset += 2;
        textureData.push(textureValue);
        textureIds.push(textureValue & MAPM_TEXTURE_ID_MASK);
        textureScales.push(textureValue >>> MAPM_TEXTURE_ATTRIBUTE_SHIFT);

        brightness.push(buffer.readUInt8(offset));
        offset += 1;
      }

      const waterType = buffer.readInt8(offset);
      offset += 1;
      const waterWaveType = buffer.readUInt8(offset);
      offset += 1;
      const waterHeight = cleanFloat(buffer.readFloatLE(offset));
      offset += 4;

      const tileFlags = [];
      for (let tileIndex = 0; tileIndex < MAPM_TILES_PER_AXIS * MAPM_TILES_PER_AXIS; tileIndex += 1) {
        tileFlags.push(buffer.readUInt16LE(offset));
        offset += 2;
      }

      const heightMax = cleanFloat(buffer.readFloatLE(offset));
      offset += 4;
      const heightMin = cleanFloat(buffer.readFloatLE(offset));
      offset += 4;
      const reservedHex = buffer.subarray(offset, offset + 20).toString("hex");
      offset += 20;

      blocks.push({
        blockX,
        blockZ,
        byteOffset: blockOffset,
        flag,
        environmentId,
        heights,
        textureData,
        textureIds,
        textureScales,
        brightness,
        water: {
          type: waterType,
          waveType: waterWaveType,
          height: waterHeight
        },
        tileFlags,
        heightMax,
        heightMin,
        reservedHex
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
    blockSizeBytes: MAPM_BLOCK_BYTES,
    blocks
  };
}
