import { existsSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { toPublicImagePath } from "../../shared/assetPaths.mjs";
import { exists } from "../io.mjs";
import { imagePublicRoot, imageSourceRoot, normalizeAssetPath, toGameRelative } from "../paths.mjs";

// A global outdoor build visits thousands of sectors but only a small shared
// tile catalog. Coalesce concurrent copies and never recopy the same converted
// tile during one build process.
const terrainTileCopyJobs = new Map();

export function resolveReferencedTerrainTiles(textureIds, tileCatalog, sourceExtractedRoot, sourceGameRoot) {
  return textureIds.map((textureId) => {
    const entry = tileCatalog.entriesById[String(textureId)];
    if (!entry) {
      throw new Error(`Map_extracted/tile2d.ifo is missing terrain texture id ${textureId}`);
    }

    const ddjPath = path.join(sourceExtractedRoot, "Map_extracted", "tile2d", entry.ddjFileName);
    return {
      textureId: entry.id,
      flags: entry.flags,
      category: entry.category,
      ddjFileName: entry.ddjFileName,
      sourcePath: toGameRelative(ddjPath, sourceGameRoot),
      imagePublicPath: terrainTileImagePublicPath(entry.ddjFileName),
      metadata: entry.metadata
    };
  });
}

export async function copyReferencedTerrainTileImages(referencedTiles) {
  for (const tile of referencedTiles) {
    const pngFileName = terrainTileImageFileName(tile.ddjFileName);
    const source = path.join(imageSourceRoot, "Map_extracted", "tile2d", pngFileName);
    const target = path.join(imagePublicRoot, "Map_extracted", "tile2d", pngFileName);
    const copyKey = target.toLowerCase();
    let copyJob = terrainTileCopyJobs.get(copyKey);
    if (!copyJob) {
      copyJob = copyTerrainTileImage(source, target, tile.sourcePath).catch((error) => {
        terrainTileCopyJobs.delete(copyKey);
        throw error;
      });
      terrainTileCopyJobs.set(copyKey, copyJob);
    }
    await copyJob;
  }
}

async function copyTerrainTileImage(source, target, sourcePath) {
  if (!(await exists(source))) {
    throw new Error(
      `Missing converted terrain texture ${source} for ${sourcePath}; run the DDJ image conversion first.`
    );
  }

  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(source, target);
}

export function terrainTileImagePublicPath(ddjFileName) {
  return toPublicImagePath("Map_extracted/tile2d", terrainTileImageFileName(ddjFileName), {
    replaceExtension: false
  });
}

export function terrainTileImageFileName(ddjFileName) {
  const normalizedName = normalizeAssetPath(ddjFileName).split("/").at(-1) ?? "";
  const primaryPng = normalizedName.replace(/\.[^.]+$/, ".png");
  const primaryPath = path.join(imageSourceRoot, "Map_extracted", "tile2d", primaryPng);
  if (existsSync(primaryPath)) {
    return primaryPng;
  }

  return normalizedName.replace(/\.[^.]+$/, ".ddj.png");
}
