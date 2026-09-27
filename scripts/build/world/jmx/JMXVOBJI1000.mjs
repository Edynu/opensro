import { readFile } from "node:fs/promises";
import { VOBJI_SIGNATURE } from "../constants.mjs";
import { normalizeAssetPath } from "../paths.mjs";
import { decodeJmxText } from "../../shared/jmxBinaryReader.mjs";

export async function readJmxMapObjectInfo(sourcePath) {
  const bytes = await readFile(sourcePath);
  return parseJmxMapObjectInfo(decodeJmxText(bytes), sourcePath);
}

export function parseJmxMapObjectInfo(raw, sourcePath = "<memory>") {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const signature = lines[0];

  if (signature !== VOBJI_SIGNATURE) {
    throw new Error(`${sourcePath}: expected ${VOBJI_SIGNATURE}, got ${signature || "<empty>"}`);
  }

  const declaredCount = Number.parseInt(lines[1], 10);
  if (!Number.isInteger(declaredCount)) {
    throw new Error(`${sourcePath}: invalid object.ifo count line: ${lines[1] ?? "<missing>"}`);
  }

  const entries = [];
  for (const [lineIndex, line] of lines.slice(2).entries()) {
    const match = /^(\d+)\s+(0x[0-9a-fA-F]+|\d+)\s+"([^"]*)"\s*$/.exec(line);
    if (!match) {
      throw new Error(`${sourcePath}:${lineIndex + 3}: invalid object.ifo row: ${line}`);
    }

    const id = Number.parseInt(match[1], 10);
    entries.push({
      id,
      flags: Number.parseInt(match[2], 0),
      sourcePath: normalizeAssetPath(match[3])
    });
  }

  if (entries.length !== declaredCount) {
    throw new Error(`${sourcePath}: object.ifo declared ${declaredCount} rows but parsed ${entries.length}`);
  }

  return {
    sourcePath,
    signature,
    declaredCount,
    entries,
    entriesById: Object.fromEntries(entries.map((entry) => [String(entry.id), entry]))
  };
}
