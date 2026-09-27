import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeAssetPath } from "../shared/assetPaths.mjs";

export { normalizeAssetPath } from "../shared/assetPaths.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

export const rebuildRoot = path.resolve(scriptDir, "..", "..", "..");
export const gameRoot = path.resolve(rebuildRoot, "..");
export const extractedRoot = path.join(gameRoot, "extracted");
/**
 * Native client-owned table root loaded through `%stextdata\\...` format
 * strings. Keep this distinct from `Media_extracted/resinfo`: resinfo may
 * contain older UI-facing mirrors and is not a substitute for retail table
 * ownership.
 */
export const retailTextdataRoot = path.join(
	extractedRoot,
	"Media_extracted",
	"server_dep",
	"silkroad",
	"textdata"
);
/** The supplied v1.150 client archive's matching skilleffect mirror. It is
 * corroborating evidence for newer server rows, not a replacement for the
 * complete server textdata corpus. */
export const clientV150ResinfoRoot = path.join(
	extractedRoot,
	"Media_extracted",
	"resinfo"
);
export const publicRoot = path.join(rebuildRoot, ".generated", "client-public");
export const imageSourceRoot = path.join(rebuildRoot, ".generated", "intermediate", "images");
export const imagePublicRoot = path.join(publicRoot, "assets", "images");

export function toGameRelative(value, sourceGameRoot = gameRoot) {
  return path.relative(sourceGameRoot, value).replaceAll("\\", "/");
}

export function toHex16(value) {
  return `0x${value.toString(16).padStart(4, "0")}`;
}

/** Normalize a numeric or hexadecimal text region id to the 0xXXXX form. */
export function normalizeRegionId(value) {
  if (typeof value === "number") {
    return toHex16(value & 0xffff);
  }
  const text = String(value).trim().replace(/^0x/i, "");
  if (!/^[0-9a-f]{1,4}$/i.test(text)) {
    throw new Error(`Invalid 16-bit region id ${JSON.stringify(value)}`);
  }
  return `0x${text.toLowerCase().padStart(4, "0")}`;
}

/** Compose the retail region id from its unsigned sector bytes. */
export function regionIdFromSectorCoordinates(sectorX, sectorY) {
  return toHex16(((sectorY & 0xff) << 8) | (sectorX & 0xff));
}
