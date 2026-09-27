// Precompressed sidecars (.br/.gz/.zst) for generated manifests.
//
// WHY FRESHNESS IS NOT COSMETIC. The client-next dev/preview asset middleware
// (apps/client-next/tools/published-assets.mjs) serves
// `<asset>.br` to any client that accepts brotli - which is every browser -
// WITHOUT comparing mtimes. So a sidecar that is older than its asset does not
// merely miss an optimisation: it silently REPLACES the asset for every real
// user while curl and Node's fs still see the fresh bytes, which makes the
// resulting bug look impossible.
//
// That happened: assets/anim/manifest.json gained its motion-0x26 pickup
// entries on 2026-07-24, its sidecars were left at 2026-07-08, and every
// browser therefore fetched a manifest with NO pick clip. The pickup animation
// silently fell back to a placeholder for sixteen days, and because that
// placeholder length also drives the 0x2476 busy-motion gate it surfaced as a
// multi-second input lockout after picking an item up.
//
// So: whatever writes a generated manifest must refresh its sidecars in the
// same pass.

import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  compressBrotliSync,
  compressGzipSync,
  compressZstdSync,
  PRECOMPRESSED_ASSET_SUFFIXES
} from "./shared/compressionUtils.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rebuildRoot = path.resolve(scriptDir, "..", "..");
const publicRoot = path.join(rebuildRoot, ".generated", "client-public");

/**
 * Shared compression helpers keep these byte-comparable with the bulk optimizer.
 */
const ENCODINGS = [
  {
    suffix: PRECOMPRESSED_ASSET_SUFFIXES[0],
    compress: (bytes, options) => compressBrotliSync(bytes, { quality: options.brotliQuality })
  },
  {
    suffix: PRECOMPRESSED_ASSET_SUFFIXES[1],
    compress: (bytes, options) => compressGzipSync(bytes, { level: options.gzipLevel })
  },
  {
    suffix: PRECOMPRESSED_ASSET_SUFFIXES[2],
    compress: (bytes, options) => compressZstdSync(bytes, { level: options.zstdLevel })
  }
];

async function mtimeMs(filePath) {
  try {
    return (await stat(filePath)).mtimeMs;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Rewrite the .br/.gz/.zst sidecars of each given asset from its CURRENT bytes.
 * Returns one record per asset describing what was written.
 *
 * `onlyWhenStale` skips assets whose sidecars are all at least as new as the
 * asset, which makes this cheap enough to call unconditionally at the end of a
 * build step.
 */
/**
 * @param {string[]} assetPaths
 * @param {{ onlyWhenStale?: boolean, brotliQuality?: number, gzipLevel?: number, zstdLevel?: number }} [options]
 */
export async function refreshPrecompressedSidecars(assetPaths, options = {}) {
  const {
    onlyWhenStale = false,
    brotliQuality,
    gzipLevel,
    zstdLevel
  } = options;
  const results = [];
  for (const assetPath of assetPaths) {
    const assetMs = await mtimeMs(assetPath);
    if (assetMs === null) {
      results.push({ assetPath, skipped: "missing" });
      continue;
    }
    if (onlyWhenStale) {
      const sidecarTimes = await Promise.all(
        ENCODINGS.map(({ suffix }) => mtimeMs(`${assetPath}${suffix}`))
      );
      const allFresh = sidecarTimes.every((ms) => ms !== null && ms >= assetMs);
      if (allFresh) {
        results.push({ assetPath, skipped: "fresh" });
        continue;
      }
    }
    const bytes = await readFile(assetPath);
    const written = [];
    for (const { suffix, compress } of ENCODINGS) {
      const compressed = compress(bytes, { brotliQuality, gzipLevel, zstdLevel });
      await writeFile(`${assetPath}${suffix}`, compressed);
      written.push({ suffix, bytes: compressed.byteLength });
    }
    results.push({ assetPath, sourceBytes: bytes.byteLength, written });
  }
  return results;
}

/**
 * @param {{ publicRoot?: string, onlyWhenStale?: boolean, brotliQuality?: number, gzipLevel?: number, zstdLevel?: number }} [options]
 */
export async function refreshGeneratedManifestSidecars(options = {}) {
  const root = options.publicRoot ?? publicRoot;
  await refreshPrecompressedSidecars(
    [
      path.join(root, "assets", "packs", "manifest.json"),
      path.join(root, "assets", "manifest.json")
    ],
    options
  );
}
