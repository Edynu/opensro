import { REGION_SIZE } from "../constants.mjs";
import { regionIdFromSectorCoordinates } from "../paths.mjs";

/**
 * Derive the finite map-sector set crossed by a CPS camera path, expanded by
 * the native residency halo. Camera positions are sector-local and may leave
 * [0, REGION_SIZE), so floor division is intentional for negative coordinates.
 */
export function deriveTitleTerrainSectorCoverage(titleManifest, options = {}) {
  const seedSectorX = readSectorByte(options.sectorX, "sectorX");
  const seedSectorY = readSectorByte(options.sectorY, "sectorY");
  const margin = options.terrainSectorMargin ?? 0;

  if (!Number.isInteger(margin) || margin < 0) {
    throw new RangeError(`terrainSectorMargin must be a non-negative integer, received ${margin}`);
  }

  const cameraPathById = new Map();
  addSector(cameraPathById, seedSectorX, seedSectorY);

  for (const keyframe of readCameraKeyframes(titleManifest)) {
    const baseX = readSectorByte(keyframe.sectorX, "camera.sectorX");
    const baseY = readSectorByte(keyframe.sectorY, "camera.sectorY");
    const localX = readFiniteCoordinate(keyframe.position?.x, "camera.position.x");
    const localZ = readFiniteCoordinate(keyframe.position?.z, "camera.position.z");

    addSector(
      cameraPathById,
      baseX + Math.floor(localX / REGION_SIZE),
      baseY + Math.floor(localZ / REGION_SIZE)
    );
  }

  const cameraPathSectors = sortSectors([...cameraPathById.values()]);
  const coverageById = new Map();

  for (const center of cameraPathSectors) {
    for (let offsetY = -margin; offsetY <= margin; offsetY += 1) {
      for (let offsetX = -margin; offsetX <= margin; offsetX += 1) {
        addSector(coverageById, center.sectorX + offsetX, center.sectorY + offsetY);
      }
    }
  }

  const sectors = sortSectors([...coverageById.values()]);
  const minSectorX = Math.min(...sectors.map((sector) => sector.sectorX));
  const maxSectorX = Math.max(...sectors.map((sector) => sector.sectorX));
  const minSectorY = Math.min(...sectors.map((sector) => sector.sectorY));
  const maxSectorY = Math.max(...sectors.map((sector) => sector.sectorY));

  return {
    sectors,
    sectorGrid: {
      minSectorX,
      maxSectorX,
      minSectorY,
      maxSectorY,
      width: maxSectorX - minSectorX + 1,
      height: maxSectorY - minSectorY + 1,
      coverageMarginSectors: margin,
      cameraPathSectors
    }
  };
}

function readCameraKeyframes(titleManifest) {
  if (titleManifest == null) {
    return [];
  }
  if (!Array.isArray(titleManifest.camera)) {
    throw new TypeError("titleManifest.camera must be an array when a title manifest is supplied");
  }
  return titleManifest.camera;
}

function readSectorByte(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > 0xff) {
    throw new RangeError(`${label} must be an unsigned sector byte, received ${value}`);
  }
  return value;
}

function readFiniteCoordinate(value, label) {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label} must be finite, received ${value}`);
  }
  return value;
}

function addSector(target, sectorX, sectorY) {
  const x = readSectorByte(sectorX, "derived sectorX");
  const y = readSectorByte(sectorY, "derived sectorY");
  const sectorId = regionIdFromSectorCoordinates(x, y);

  target.set(sectorId, { sectorId, sectorX: x, sectorY: y });
}

function sortSectors(sectors) {
  return sectors.sort((left, right) => left.sectorY - right.sectorY || left.sectorX - right.sectorX);
}
