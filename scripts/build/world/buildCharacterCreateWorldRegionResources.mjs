import path from "node:path";
import {
  CHARACTER_CREATE_REGIONS,
  CHARACTER_CREATE_TERRAIN_SECTOR_MARGIN
} from "./constants.mjs";
import { writeJson } from "./io.mjs";
import { publicRoot } from "./paths.mjs";
import { buildWorldRegionResources } from "./buildWorldRegionResources.mjs";

const CHARACTER_CREATE_BACKGROUND_ROTATION_OFFSET_Y = 0.39095500111579895;
const CHARACTER_CREATE_BACKGROUND_CAMERA_DISTANCE = 0.100000001;

export async function buildCharacterCreateWorldRegionResources() {
  const entries = {};

  for (const raceKey of Object.keys(CHARACTER_CREATE_REGIONS)) {
    const descriptor = CHARACTER_CREATE_REGIONS[raceKey];
    const resources = await buildWorldRegionResources({
      area: descriptor.area,
      sectorId: descriptor.sectorId,
      sectorX: descriptor.sectorX,
      sectorY: descriptor.sectorY,
      terrainSectorMargin: CHARACTER_CREATE_TERRAIN_SECTOR_MARGIN
    });

    const manifest = buildCharacterCreateWorldManifest(
      descriptor,
      resources.bundle,
      resources.regionBundlePublicPath,
      resources.worldRegionsPublicPath
    );
    const manifestPublicPath = `/assets/character-select/create-world-${raceKey}-manifest.json`;
    const manifestPath = path.join(publicRoot, "assets", "character-select", `create-world-${raceKey}-manifest.json`);
    await writeJson(manifestPath, manifest);

    entries[raceKey] = {
      ...resources,
      manifestPublicPath,
      regionBundlePublicPath: resources.regionBundlePublicPath
    };
  }

  return entries;
}

function buildCharacterCreateWorldManifest(descriptor, bundle, regionBundlePublicPath, worldRegionsPublicPath) {
  const sectorX = bundle.source.sectorX;
  const sectorY = bundle.source.sectorY;
  const sectorIdHexDigits = bundle.source.sectorId.replace(/^0x/i, "");
  const camera = [
    {
      timeSeconds: 0,
      sourceTimeSeconds: 0,
      sectorX,
      sectorY,
      position: { ...descriptor.cameraAnchor },
      rotation: { x: 0, y: CHARACTER_CREATE_BACKGROUND_ROTATION_OFFSET_Y, z: 0 },
      mode: CHARACTER_CREATE_BACKGROUND_CAMERA_DISTANCE
    }
  ];

  const objects2 = bundle.source.objects2;
  return {
    sourcePath: descriptor.sourcePath,
    introName: `charactercreate-${bundle.source.sectorId.slice(2)}`,
    area: bundle.source.area,
    camera,
    cameraControllerTargetTimeSeconds: 0,
    mapSector: {
      sectorX,
      sectorY,
      mapFiles: {
        terrain: bundle.source.terrain,
        texture: bundle.source.terrainTexture,
        objects: objects2.replace(/\.o2$/i, ".o"),
        objects2
      },
      navmesh: `extracted/Data_extracted/navmesh/nv_${sectorIdHexDigits}.nvm`
    },
    regionBundlePublicPath,
    worldRegionsPublicPath,
    seedRegionId: bundle.source.sectorId,
    seedResources: []
  };
}
