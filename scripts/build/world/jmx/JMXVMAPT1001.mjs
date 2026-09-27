import {
  MAP_BLOCKS_PER_AXIS,
  MAPM_TILES_PER_AXIS,
  MAPT_NATIVE_LIGHT_BYTES,
  MAPT_SIGNATURE,
  SIGNATURE_BYTES
} from "../constants.mjs";
import { ensureAvailable, parseDdsMetadata, readSignature } from "./common.mjs";

export function parseJmxMapTerrainTexture(buffer, sourcePath = "<memory>") {
  const signature = readSignature(buffer, MAPT_SIGNATURE, sourcePath);
  const lightBytesEnd = SIGNATURE_BYTES + MAPT_NATIVE_LIGHT_BYTES;
  ensureAvailable(buffer, SIGNATURE_BYTES, MAPT_NATIVE_LIGHT_BYTES, sourcePath);

  let offset = SIGNATURE_BYTES;
  const blocks = [];

  for (let blockZ = 0; blockZ < MAP_BLOCKS_PER_AXIS; blockZ += 1) {
    for (let blockX = 0; blockX < MAP_BLOCKS_PER_AXIS; blockX += 1) {
      const blockOffset = offset;
      const tileLight = [];
      let lightMin = 0xff;
      let lightMax = 0;

      for (let tileIndex = 0; tileIndex < MAPM_TILES_PER_AXIS * MAPM_TILES_PER_AXIS; tileIndex += 1) {
        const light = buffer.readUInt8(offset);
        offset += 1;
        tileLight.push(light);
        lightMin = Math.min(lightMin, light);
        lightMax = Math.max(lightMax, light);
      }

      blocks.push({
        blockX,
        blockZ,
        byteOffset: blockOffset,
        tileLight,
        lightMin,
        lightMax
      });
    }
  }

  if (offset !== lightBytesEnd) {
    throw new Error(`${sourcePath}: consumed ${offset} bytes but expected ${lightBytesEnd} MAPT light bytes`);
  }

  ensureAvailable(buffer, offset, 8, sourcePath);
  const embeddedTextureOffset = offset;
  const embeddedTextureByteLength = buffer.readUInt32LE(offset);
  if (embeddedTextureByteLength < 8) {
    throw new Error(`${sourcePath}: embedded MAPT texture record at ${offset} is smaller than its header`);
  }
  offset += 4;
  const embeddedTextureType = buffer.readUInt32LE(offset);
  offset += 4;
  const ddsPayloadOffset = offset;
  const embeddedTexturePayloadByteLength = embeddedTextureByteLength - 8;
  ensureAvailable(buffer, ddsPayloadOffset, embeddedTexturePayloadByteLength, sourcePath);
  const dds = parseDdsMetadata(buffer, ddsPayloadOffset, embeddedTexturePayloadByteLength, sourcePath);
  offset += embeddedTexturePayloadByteLength;

  const parsed = {
    sourcePath,
    signature,
    byteLength: buffer.length,
    consumedBytes: offset,
    trailingByteLength: buffer.length - offset,
    blockGrid: {
      width: MAP_BLOCKS_PER_AXIS,
      height: MAP_BLOCKS_PER_AXIS
    },
    nativeLightByteCount: MAPT_NATIVE_LIGHT_BYTES,
    embeddedTexture: {
      byteOffset: embeddedTextureOffset,
      byteLength: embeddedTextureByteLength,
      textureType: embeddedTextureType,
      payloadOffset: ddsPayloadOffset,
      payloadByteLength: embeddedTexturePayloadByteLength,
      dds
    },
    blocks
  };
  Object.defineProperty(parsed, "embeddedTexturePayload", {
    value: buffer.subarray(ddsPayloadOffset, ddsPayloadOffset + embeddedTexturePayloadByteLength),
    enumerable: false
  });

  return parsed;
}
