import path from "node:path";
import { TITLE_REGION_694E, TITLE_TERRAIN_SECTOR_MARGIN } from "./constants.mjs";
import { writeJson } from "./io.mjs";
import { publicRoot } from "./paths.mjs";
import { buildWorldRegionResources } from "./buildWorldRegionResources.mjs";
import { buildSkyEnvironmentCatalog } from "./assets/environment/index.mjs";

// Shared, map-agnostic sky environment catalog: every environment.ifo env entry's
// day/night sky curves keyed by env key, the region->env-key tree, and the time cycle.
// Any region resolves its env key from the tree, then looks up the curves here.
export async function buildSharedWorldEnvironmentCatalog() {
  const catalog = buildSkyEnvironmentCatalog();
  const targetPath = path.join(publicRoot, "assets", "world", "environment.json");
  await writeJson(targetPath, catalog);
  return {
    publicPath: "/assets/world/environment.json",
    outputPath: targetPath,
    environmentCount: Object.keys(catalog.environments).length,
    regionNodeCount: catalog.regions.length,
    loginEnvKey: catalog.loginEnvKey
  };
}

export async function buildTitleWorldRegionResources(titleManifest) {
  const seedRegion = titleManifest
    ? {
        area: titleManifest.area,
        sectorX: titleManifest.mapSector.sectorX,
        sectorY: titleManifest.mapSector.sectorY,
        sectorId: (titleManifest.mapSector.sectorY << 8) | titleManifest.mapSector.sectorX,
        titleManifest,
        terrainSectorMargin: TITLE_TERRAIN_SECTOR_MARGIN
      }
    : TITLE_REGION_694E;
  const resources = await buildWorldRegionResources(seedRegion);
  return {
    ...resources,
    publicPath: resources.regionBundlePublicPath
  };
}
