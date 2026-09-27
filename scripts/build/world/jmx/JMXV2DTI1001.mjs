import { readFile } from "node:fs/promises";
import { TILE2D_SIGNATURE } from "../constants.mjs";
import { normalizeAssetPath } from "../paths.mjs";
import { decodeJmxText } from "../../shared/jmxBinaryReader.mjs";

export async function readJmxMapTileCatalog(sourcePath) {
  const bytes = await readFile(sourcePath);
  return parseJmxMapTileCatalog(decodeJmxText(bytes), sourcePath);
}

export function parseJmxMapTileCatalog(raw, sourcePath = "<memory>") {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const signature = lines[0];

  if (signature !== TILE2D_SIGNATURE) {
    throw new Error(`${sourcePath}: expected ${TILE2D_SIGNATURE}, got ${signature || "<empty>"}`);
  }

  const declaredCount = Number.parseInt(lines[1], 10);
  if (!Number.isInteger(declaredCount)) {
    throw new Error(`${sourcePath}: invalid tile2d.ifo count line: ${lines[1] ?? "<missing>"}`);
  }

  const entries = [];
  for (const [lineIndex, line] of lines.slice(2).entries()) {
    const match = /^(\d+)\s+(0x[0-9a-fA-F]+|\d+)\s+"([^"]*)"\s+"([^"]*)"(?:\s+((?:\{[^}]*\}\s*)+))?$/.exec(line);
    if (!match) {
      throw new Error(`${sourcePath}:${lineIndex + 3}: invalid tile2d.ifo row: ${line}`);
    }

    const id = Number.parseInt(match[1], 10);
    entries.push({
      id,
      flags: Number.parseInt(match[2], 0),
      category: match[3],
      ddjFileName: normalizeAssetPath(match[4]),
      metadata: parseTileCatalogMetadata(match[5])
    });
  }

  if (entries.length !== declaredCount) {
    throw new Error(`${sourcePath}: tile2d.ifo declared ${declaredCount} rows but parsed ${entries.length}`);
  }

  return {
    sourcePath,
    signature,
    declaredCount,
    entries,
    entriesById: Object.fromEntries(entries.map((entry) => [String(entry.id), entry]))
  };
}

function parseTileCatalogMetadata(value) {
  if (!value) {
    return null;
  }

  const braceMatches = [...value.matchAll(/\{([^}]*)\}/g)];
  if (braceMatches.length > 0) {
    const entries = braceMatches.map((match) => parseTileCatalogMetadataPair(match[1]));
    return entries.length === 1 ? entries[0] : { entries };
  }

  return parseTileCatalogMetadataPair(value);
}

function parseTileCatalogMetadataPair(value) {
  const parts = value.split(",").map((part) => Number.parseInt(part.trim(), 10));
  if (parts.length !== 2 || parts.some((part) => !Number.isInteger(part))) {
    return {
      raw: value
    };
  }

  return {
    x: parts[0],
    y: parts[1]
  };
}
