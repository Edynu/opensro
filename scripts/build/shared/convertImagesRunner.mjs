// Async, serialized runner for scripts/convert_images.py.
//
// The old call sites used spawnSync, which blocks the Node event loop and
// stalls every other parallel build lane for the whole Python run. This runner
// spawns asynchronously so the other lanes keep making progress, but keeps all
// convert_images.py invocations in this process strictly serialized:
// convert_images.py rewrites rebuild/assets/image-manifest.csv from scratch on
// every run (open mode "w"), so two concurrent invocations would truncate or
// interleave each other's manifest rows.
//
// Contract mirrors spawnSync("py", [script, ...args], { stdio: "inherit" }):
// resolves with { status } where status is the exit code, or null when the
// process could not be spawned or died from a signal — callers keep their
// existing warn-and-continue exit-code checks. Never rejects, like spawnSync
// never throws for these failure modes.

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rebuildRoot = path.resolve(scriptDir, "..", "..", "..");
const convertImagesScript = path.join(rebuildRoot, "scripts", "convert_images.py");

// Tail of the serialization chain. Each invocation appends itself, so two runs
// can never overlap even if future lanes call in concurrently.
let queueTail = Promise.resolve();
let fullConversionComplete = false;

function spawnConvertImages(args) {
  return new Promise((resolve) => {
    const child = spawn("py", [convertImagesScript, ...args], { stdio: "inherit" });
    let settled = false;
    const settle = (status) => {
      if (settled) return;
      settled = true;
      resolve({ status });
    };
    child.on("error", () => settle(null));
    child.on("close", (code) => settle(code));
  });
}

/** Run convert_images.py with the given CLI filters. Resolves { status }. */
export function runConvertImages(args) {
  const run = queueTail.then(async () => {
    // A successful unfiltered pass covers every filtered tree. The full
    // resource entry point runs that pass first so compacted workspaces can
    // recreate their disposable staging cache; later model builders should
    // not rescan the same extracted corpus.
    if (fullConversionComplete && args.length > 0) {
      return { status: 0 };
    }

    const result = await spawnConvertImages(args);
    if (args.length === 0 && result.status === 0) {
      fullConversionComplete = true;
    }
    return result;
  });
  queueTail = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}
