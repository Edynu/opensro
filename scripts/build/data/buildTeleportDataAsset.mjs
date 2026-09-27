// Publish the v1.150 teleportdata.txt + teleportlink.txt relation used by
// CIFNPCTalk_BuildTeleportDestinationMenu (sub_5d7040).  The native lookup is:
// bound runtime NPC gid -> RefObj id -> teleportdata source row -> linked
// destination rows.  Keep those identities explicit so the browser never
// substitutes a runtime gid for a media-table key.

import fs from "node:fs";
import path from "node:path";
import { exportDataAsset } from "../shared/dataAssetExport.mjs";
import { isMainScript } from "../shared/fsUtils.mjs";
import { readTextDataLinesSync, splitTextDataRow } from "../shared/textDataIo.mjs";
import { extractedRoot, gameRoot, publicRoot } from "../world/paths.mjs";

const textDataRoot = path.join(
  extractedRoot,
  "Media_extracted",
  "server_dep",
  "silkroad",
  "textdata"
);
const teleportDataPath = path.join(textDataRoot, "teleportdata.txt");
const teleportLinkPath = path.join(textDataRoot, "teleportlink.txt");
const teleportBuildingPath = path.join(textDataRoot, "teleportbuilding.txt");

function readRows(filePath) {
  return readTextDataLinesSync(filePath).map((line) => splitTextDataRow(line.trim()));
}

export function buildTeleportDataAsset() {
  if (
    !fs.existsSync(teleportDataPath) ||
    !fs.existsSync(teleportLinkPath) ||
    !fs.existsSync(teleportBuildingPath)
  ) {
    console.warn("[teleportdata] source table missing - skipping");
    return { written: false, teleportRows: 0, linkRows: 0 };
  }

  const fortressCodeByNpcRefObjId = new Map(
    readRows(teleportBuildingPath)
      .filter((columns) => Number(columns[0]) !== 0)
      .map((columns) => [
        Number(columns[1]) >>> 0,
        columns[55] === "xxx" ? "" : columns[55] ?? ""
      ])
  );
  const teleportRows = readRows(teleportDataPath)
    .filter((columns) => Number(columns[0]) !== 0)
    .map((columns) => ({
      id: Number(columns[1]) >>> 0,
      codeName: columns[2] ?? "",
      npcRefObjId: Number(columns[3]) >>> 0,
      fortressCode:
        fortressCodeByNpcRefObjId.get(Number(columns[3]) >>> 0) ?? "",
      nameSymbol: columns[4] ?? "",
      regionId: Number(columns[5]) & 0xffff
    }));
  const linkRows = readRows(teleportLinkPath)
    .filter((columns) => Number(columns[0]) !== 0)
    .map((columns) => ({
      sourceId: Number(columns[1]) >>> 0,
      destinationId: Number(columns[2]) >>> 0,
      fee: Number(columns[3]) | 0
    }));
  const catalog = {
    sourcePaths: [
      path.relative(gameRoot, teleportDataPath).replaceAll("\\", "/"),
      path.relative(gameRoot, teleportLinkPath).replaceAll("\\", "/"),
      path.relative(gameRoot, teleportBuildingPath).replaceAll("\\", "/")
    ],
    format: "sro-teleportdata",
    version: 1,
    teleportRows,
    linkRows
  };
  const { outPath } = exportDataAsset({ publicRoot, outputFileName: "teleportData.json", value: catalog });
  console.log(
    `[teleportdata] wrote ${teleportRows.length} teleport + ${linkRows.length} link row(s) -> ` +
      `${path.relative(publicRoot, outPath)}`
  );
  return {
    written: true,
    teleportRows: teleportRows.length,
    linkRows: linkRows.length,
    outPath
  };
}

if (isMainScript(import.meta.url)) {
  buildTeleportDataAsset();
}
