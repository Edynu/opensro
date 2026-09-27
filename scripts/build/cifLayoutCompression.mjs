import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  formatOptimizationSummary,
  optimizeJsonAssets
} from "./jsonAssetCompression.mjs";
import { withGeneratedAssetsLock } from "../rebuildLock.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rebuildRoot = path.resolve(scriptDir, "..", "..");
const publicRoot = path.join(rebuildRoot, ".generated", "client-public");
const layoutsRoot = path.join(publicRoot, "assets", "cif", "layouts");

await withGeneratedAssetsLock("CIF layout JSON optimization", async () => {
  const summary = await optimizeJsonAssets({
    root: layoutsRoot,
    publicRoot,
    force: process.argv.includes("--force")
  });
  console.log(formatOptimizationSummary(summary));
});
