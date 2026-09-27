import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { rebuildRoot } from "../world/paths.mjs";

const DEFAULT_ARCHIVE_ROOT = path.join(rebuildRoot, "temp", "archives", "generated-artifacts");

/*
================
archiveGeneratedArtifact

Move a superseded generated file out of a live publication tree without
discarding it. The destination retains its original relative path and carries
a small provenance sidecar. A collision gets a unique suffix; no existing
archive record is overwritten.
================
*/
export async function archiveGeneratedArtifact(sourcePath, options = {}) {
  const source = path.resolve(sourcePath);
  const scopeRoot = path.resolve(options.scopeRoot ?? rebuildRoot);
  const archiveRoot = path.resolve(options.archiveRoot ?? DEFAULT_ARCHIVE_ROOT);
  const relative = path.relative(scopeRoot, source);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`generated artifact archive source escapes ${scopeRoot}: ${source}`);
  }
  const sourceStat = await stat(source).catch((error) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (!sourceStat) return undefined;
  if (!sourceStat.isFile()) {
    throw new Error(`generated artifact archive source is not a file: ${source}`);
  }

  const now = new Date();
  const day = [
    String(now.getFullYear()).padStart(4, "0"),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0")
  ].join("-");
  const reason = normalizeReason(options.reason ?? "superseded");
  const baseDestination = path.join(archiveRoot, day, reason, relative);
  let destination = baseDestination;
  for (let collision = 1; await pathExists(destination); collision += 1) {
    destination = `${baseDestination}.archive-${collision}`;
  }
  await mkdir(path.dirname(destination), { recursive: true });
  await rename(source, destination);
  const record = {
    format: "sro-generated-artifact-archive-record",
    version: 1,
    archivedAt: now.toISOString(),
    reason,
    originalPath: relative.replaceAll("\\", "/"),
    archivedPath: path.relative(archiveRoot, destination).replaceAll("\\", "/"),
    bytes: sourceStat.size
  };
  await writeFile(`${destination}.archive.json`, `${JSON.stringify(record, null, 2)}\n`);
  return { destination, record };
}

/*
================
normalizeReason
================
*/
function normalizeReason(value) {
  const normalized = String(value).trim().toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "");
  if (!normalized) throw new Error("generated artifact archive reason is empty");
  return normalized;
}

/*
================
pathExists
================
*/
async function pathExists(filename) {
  return stat(filename).then(() => true, (error) => {
    if (error.code === "ENOENT") return false;
    throw error;
  });
}
