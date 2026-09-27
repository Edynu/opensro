import { ensureAvailable, readJmxSignature } from "../../shared/jmxBinaryReader.mjs";
import { toHex16 } from "../paths.mjs";

export { ensureAvailable, readJmxSignature as readSignature };

export function cleanFloat(value) {
  return Object.is(value, -0) ? 0 : value;
}

export function parseDdsMetadata(buffer, offset, byteLength, sourcePath) {
  if (byteLength < 128) {
    throw new Error(`${sourcePath}: embedded MAPT texture at ${offset} is too small for a DDS header`);
  }
  ensureAvailable(buffer, offset, 128, sourcePath);

  const magic = buffer.subarray(offset, offset + 4).toString("ascii");
  if (magic !== "DDS ") {
    throw new Error(`${sourcePath}: embedded MAPT texture at ${offset} is not a DDS payload`);
  }

  const headerSize = buffer.readUInt32LE(offset + 4);
  const pixelFormatSize = buffer.readUInt32LE(offset + 76);
  const fourCC = buffer.subarray(offset + 84, offset + 88).toString("ascii").replace(/\0+$/, "");

  return {
    magic,
    headerSize,
    flags: buffer.readUInt32LE(offset + 8),
    height: buffer.readUInt32LE(offset + 12),
    width: buffer.readUInt32LE(offset + 16),
    linearSize: buffer.readUInt32LE(offset + 20),
    depth: buffer.readUInt32LE(offset + 24),
    mipMapCount: buffer.readUInt32LE(offset + 28),
    pixelFormatSize,
    pixelFormatFlags: buffer.readUInt32LE(offset + 80),
    fourCC
  };
}

export function decodeRegionId(regionId) {
  return {
    id: toHex16(regionId),
    sectorX: regionId & 0xff,
    sectorY: (regionId >>> 8) & 0x7f,
    dungeonBit: (regionId & 0x8000) !== 0
  };
}
