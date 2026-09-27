// Build the browser-owned presentation projection used to enrich semantic
// EnterWorld v2 rows. The GameWorld sends stable RefObj/item identities and
// gameplay records; native resource paths stay in this client artifact.

import fs from "node:fs";
import path from "node:path";
import { isMainScript } from "../shared/fsUtils.mjs";
import { writeJsonIfChangedSync } from "../shared/jsonOut.mjs";
import {
  listTextDataShardNamesSync,
  readTextDataRowsSync
} from "../shared/textDataIo.mjs";
import { publicRoot, retailTextdataRoot } from "../world/paths.mjs";

const npcManifestPath = path.join(publicRoot, "assets", "npc", "manifest.json");
const outputPath = path.join(publicRoot, "assets", "data", "missionPresentation.json");

export function buildMissionPresentationAsset(options = {}) {
  const textdataRoot = options.textdataRoot ?? retailTextdataRoot;
  const sourceNpcManifest = options.npcManifestPath ?? npcManifestPath;
  const targetPath = options.outputPath ?? outputPath;
  const npcManifest = JSON.parse(fs.readFileSync(sourceNpcManifest, "utf8"));

  const charactersByCodename = {};
  for (const [codename, model] of Object.entries(npcManifest.models ?? {}).sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    const modelPath = normalizeGamePath(model?.bsr);
    if (modelPath) {
      charactersByCodename[codename] = { modelPath };
    }
  }

  const itemsByRefObjId = {};
  const recoveryByCodename = {};
  // 808670 parses RefObjChar; its common-data base is allocation +4.
  // Column 88 -> allocation +210 -> common base +20c, read by 8E6720.
  for(const shard of listTextDataShardNamesSync(textdataRoot,/^characterdata.*\.txt$/i)){
    for(const columns of readTextDataRowsSync(path.join(textdataRoot,shard))){
      if(columns[0]!=="1")continue;
      const name=columns[2]?.trim(),period=Number(columns[88]);
      if(!name||!Number.isInteger(period)||period<0||period>0x7fffffff-500)throw Error(`Invalid native recovery period ${name}`);
      recoveryByCodename[name]=period;
    }
  }
  const shardNames = listTextDataShardNamesSync(textdataRoot, /^itemdata.*\.txt$/i)
    .sort((left, right) => left.localeCompare(right));
  for (const shardName of shardNames) {
    for (const columns of readTextDataRowsSync(path.join(textdataRoot, shardName))) {
      const refObjId = Number.parseInt(columns[1]?.trim() ?? "", 10);
      const codename = columns[2]?.trim() ?? "";
      if (!Number.isSafeInteger(refObjId) || refObjId <= 0 || !codename.startsWith("ITEM_")) {
        continue;
      }
      let iconDdjPath;
      let dropModelPath;
      for (const rawValue of columns) {
        const value = rawValue.trim();
        if (!iconDdjPath && /\.ddj$/i.test(value)) {
          iconDdjPath = normalizeGamePath(`icon/${value}`);
        }
        if (/\.bsr$/i.test(value)) {
          dropModelPath = normalizeGamePath(value);
        }
      }
      itemsByRefObjId[String(refObjId)] = {
        codename,
        // Native RefObjCommon worn resource, distinct from field53 ground-drop resource.
        // Preserve authored absence; it is not a failed conversion.
        wornModelPath: readWornModelPath(columns[52]),
        ...(iconDdjPath ? { iconDdjPath } : {}),
        ...(dropModelPath ? { dropModelPath } : {})
      };
    }
  }

  const value = {
    format: "sro-mission-presentation",
    version: 1,
    protocolVersion: 2,
    charactersByCodename,
    recoveryByCodename,
    itemsByRefObjId
  };
  writeJsonIfChangedSync(targetPath, value);
  console.log(
    `[mission-presentation] wrote ${Object.keys(charactersByCodename).length} character and ` +
      `${Object.keys(itemsByRefObjId).length} item presentation row(s)`
  );
  return {
    outPath: targetPath,
    characterCount: Object.keys(charactersByCodename).length,
    itemCount: Object.keys(itemsByRefObjId).length
  };
}

function readWornModelPath(value) {
  const path = String(value ?? "").trim();
  if (!path || path.toLowerCase() === "xxx") return null;
  if (!/\.bsr$/i.test(path)) throw Error(`Invalid worn model resource: ${path}`);
  return normalizeGamePath(path);
}

function normalizeGamePath(value) {
  const normalized = String(value ?? "").trim().replaceAll("\\", "/").replace(/^\/+/, "");
  return normalized || undefined;
}

if (isMainScript(import.meta.url)) {
  buildMissionPresentationAsset();
}
