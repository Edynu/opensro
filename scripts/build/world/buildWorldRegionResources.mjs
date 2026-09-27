import path from "node:path";
import { writeJson } from "./io.mjs";
import { publicRoot } from "./paths.mjs";
import { buildJmxWorldRegionBundle } from "./maploader/buildMapLoaderRegionBundle.mjs";
import { buildWorldRegionIndex } from "./buildWorldRegionIndex.mjs";

export async function buildWorldRegionResources(options) {
  const bundle = await buildJmxWorldRegionBundle(options);
  const bundleFileName = `region-${bundle.source.sectorId.slice(2)}.json`;
  const regionBundlePublicPath = `/assets/world/${bundle.source.area}/${bundleFileName}`;
  const outputPath = path.join(publicRoot, "assets", "world", bundle.source.area, bundleFileName);
  await writeJson(outputPath, bundle);

  const regionIndex = await buildWorldRegionIndex(bundle, regionBundlePublicPath);

  return {
    bundle,
    outputPath,
    regionBundlePublicPath,
    worldRegionsPublicPath: regionIndex.publicPath,
    seedRegionId: regionIndex.seedRegionId,
    regionCount: regionIndex.regionCount,
    regionIndexDescriptor: regionIndex.descriptor,
    placementCount: bundle.objects.placementCount,
    uniqueObjectCount: bundle.objects.uniqueObjectCount,
    terrainBlockCount: bundle.terrain.blockCount,
    terrainSectorCount: bundle.terrain.sectors.length,
    terrainCoverage: bundle.terrain.sectorGrid,
    terrainTextureSectorCount: bundle.terrainTextures.sectors.length,
    terrainTextureCount: bundle.terrainTextures.tileCatalog.referencedTileCount
  };
}
