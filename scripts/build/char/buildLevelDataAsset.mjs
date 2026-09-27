// Publish the CLevelData table as a browser-fetchable asset: the
// leveldata.txt rows the native loads into the map at data_cec870+0x39c
// (loader case 8 @0x7f2eed), which the WIP exp/level-up fold reads through
// sub_7e0f20 GlobalDataManager_GetLevelDataRecord.
//
// Column map (sub_80cf00 parser, offsets relative to the +0x8-biased
// record the getter returns): col1 level, col2 expRequired (i64, ret+0x8),
// col3 the mastery-train SP cost (u32, ret+0x10 - the CIFSkillBoard
// level-up affordability compare sub_5841d0 @0x584389 reads it against
// the live skill points), col6 the exp-orb fraction divisor (u32,
// ret+0x28), cols 7/8/9 the tri-job exp requirements (u32 at
// ret+0x1c/+0x20/+0x24 = trader/thief/hunter - the CIFPlayerInfo job
// block sub_59ffa0 gauge divisor and the sub_75f0c0 0x35EE exp-walk
// deltas). The other columns are not read by any current WIP fold and
// are not published.
//
// Output: .generated/client-public/assets/data/levelData.json
// The WIP loader host (bridge/data/levelDataHost.ts) fetches it and fills
// g_refObjDataManager.levelDataByLevel39c at mission-bridge init.

import fs from "node:fs";
import path from "node:path";
import { exportDataAsset } from "../shared/dataAssetExport.mjs";
import { isMainScript } from "../shared/fsUtils.mjs";
import { readTextDataLinesSync, splitTextDataRow } from "../shared/textDataIo.mjs";

import { extractedRoot, publicRoot } from "../world/paths.mjs";

const levelDataPath = path.join(
  extractedRoot,
  "Media_extracted",
  "server_dep",
  "silkroad",
  "textdata",
  "leveldata.txt"
);

export function buildLevelDataAsset() {
  if (!fs.existsSync(levelDataPath)) {
    console.warn(`[level-data] source missing (${levelDataPath}) - skipping`);
    return { written: false, records: 0 };
  }

  const table = {};
  let rows = 0;
  for (const [lineIndex, line] of readTextDataLinesSync(levelDataPath).entries()) {
    // Strict single-tab split preserving empty cells (the buildSkillDataAsset
    // discipline): \t+ collapsed an empty field and shifted every later
    // column into the wrong slot with no error.
    const cols = splitTextDataRow(line.trim());
    if (cols.length !== 9) {
      throw new Error(
        `[level-data] ${levelDataPath}:${lineIndex + 1}: expected exactly 9 native columns, received ${cols.length}`
      );
    }
    const level = Number(cols[0]);
    // expRequired peaks at 34,900,085,783 (level 140) - inside the exact
    // JSON/f64 integer range, no string encoding needed.
    const expRequired = Number(cols[1]);
    const masteryTrainSpCost = Number(cols[2]);
    const expOrbDivisor = Number(cols[5]);
    // The tri-job exp columns (7/8/9, u32 at ret+0x1c/+0x20/+0x24).
    const jobExpTrader = Number(cols[6]);
    const jobExpThief = Number(cols[7]);
    const jobExpHunter = Number(cols[8]);
    const numericFields = [
      level,
      expRequired,
      masteryTrainSpCost,
      expOrbDivisor,
      jobExpTrader,
      jobExpThief,
      jobExpHunter
    ];
    if (numericFields.some((value) => !Number.isFinite(value))) {
      throw new Error(`[level-data] ${levelDataPath}:${lineIndex + 1}: native numeric field is invalid`);
    }
    table[level] = {
      expRequired,
      masteryTrainSpCost,
      expOrbDivisor,
      jobExpTrader,
      jobExpThief,
      jobExpHunter
    };
    rows += 1;
  }

  const { outPath } = exportDataAsset({ publicRoot, outputFileName: "levelData.json", value: table });

  console.log(
    `[level-data] wrote ${rows} level rows -> ${path.relative(publicRoot, outPath)}`
  );
  return { written: true, records: rows, outPath };
}

// Run directly (node scripts/build/char/buildLevelDataAsset.mjs) or via the
// resource build aggregator.
if (isMainScript(import.meta.url)) {
  buildLevelDataAsset();
}
