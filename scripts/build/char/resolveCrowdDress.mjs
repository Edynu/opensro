// Library module (not a build entrypoint): buildRoster.mjs calls these resolvers
// before publishing the roster's dress/weapon GLBs and manifest rows.
// Resolve the title-crowd random equipment ("dress") exactly the way the native client
// does it. RE (SRO_Client.exe v1.150, revtool + pseudocode):
//
//   SpawnEuropIntroCrowd (sub_4e26d0 @0x4e349d / @0x4e33b5) calls DressCrowdAvatar
//   (sub_4c0900) for every spawned pedestrian AND every mounted rider whose TypeID says
//   "player-avatar character" ((tid&0x1c)==4 && (tid&0x60)==0x20).
//
//   sub_4c0900 rolls:
//     armorType = rand()%3      -> 0:HEAVY(3) 1:LIGHT(2) 2:CLOTHES(1)
//     race byte (resource+0x9c) -> 0/3 = "CH", 1 = "EU"
//     CH: level = rand()%0x58+1 (1..88); weapon = rand()%5  -> {BLADE,SWORD,TBLADE,SPEAR,BOW}
//     EU: level = rand()%0xe+1  (1..14); weapon = rand()%8  -> {SWORD,TSWORD,AXE,STAFF,TSTAFF,
//                                                              CROSSBOW,DAGGER,HARP,(DARKSTAFF)}
//   then calls EquipRandomCrowdGear (sub_870f10 -> sub_8703f0):
//     degree = LevelToDegree(level)  (sub_86ea30 LUT below)
//     weapon: try "ITEM_%s_<KIND>_%02d_A" with degree, walking the degree down until the
//             codename resolves (sub_870040: RefObjItem lookup + model attach).
//     armor:  part-suffix table [head, "SA","BA","LA","AA","FA"] where head starts as "CA"
//             and FLIPS STICKILY to "HA" when rand()&1 (one-time-init global @0xcf0190 is
//             never reset - a native quirk we mirror). For each part, try
//             "ITEM_%s_%C_<CLOTHES|LIGHT|HEAVY>_%02d_<PART>_A" (%C = 'M'/'W'), walking the
//             degree down until an item with a model resolves.
//     shield: for one-hand weapon kinds, "ITEM_%s_SHIELD_%02d_A" the same way.
//   Race prefixes "CH"/"EU" @0xbc8eb4/0xbc8ebc; part suffixes "CA","SA","BA","LA","AA","FA"
//   @0xbcabbc..0xbcab94, "HA" @0xbcab8c. Each resolved item attaches its own skinned .bsr
//   (bound by Bip01 bone names) to the avatar compound - that is the "gear" on the crowd.
//
// This module resolves which armor pieces EXIST (itemdata codename -> model .bsr) so the
// build can bake one GLB per (race, gender, type, degree) set and the runtime can mirror
// the native rolls against a static manifest.

import path from "node:path";
import {
  listTextDataShardNamesSync,
  readTextDataLinesSync,
  splitTextDataRow
} from "../shared/textDataIo.mjs";

/** sub_86ea30: level -> item degree thresholds (degree = 1 + #thresholds <= level). */
export const NATIVE_LEVEL_DEGREE_LUT = [8, 16, 24, 32, 42, 52, 64, 76, 90, 104, 120, 141, 164];

export function nativeLevelToDegree(level) {
  let degree = 1;
  for (const threshold of NATIVE_LEVEL_DEGREE_LUT) {
    if (level < threshold || degree >= 0xe) break;
    degree += 1;
  }
  return degree;
}

/** Armor types in native roll order: rand()%3 -> 0:HEAVY 1:LIGHT 2:CLOTHES. */
export const NATIVE_ARMOR_TYPES = ["HEAVY", "LIGHT", "CLOTHES"];

/** Armor part suffixes in native table order (head slot first; "CA" flips stickily to "HA"). */
export const NATIVE_ARMOR_PARTS = ["CA", "HA", "SA", "BA", "LA", "AA", "FA"];

/** Native level roll ranges per race (CH rand()%0x58+1, EU rand()%0xe+1). */
export const NATIVE_LEVEL_RANGE = { CH: 0x58, EU: 0x0e };

/** Max degree the native rolls can reach per race (LUT over the level range). */
export const NATIVE_MAX_DEGREE = {
  CH: nativeLevelToDegree(NATIVE_LEVEL_RANGE.CH),
  EU: nativeLevelToDegree(NATIVE_LEVEL_RANGE.EU)
};

const DEFAULT_ITEM_CODENAME_COL = 2;

/**
 * Load every wearable-armor itemdata row the crowd dress can roll:
 * Map<codename, modelBsrPath ("res/item/.../xxx.bsr")>.
 */
export function loadCrowdArmorItems(textdataDir) {
  const pattern = /^ITEM_(CH|EU)_(M|W)_(CLOTHES|LIGHT|HEAVY)_(\d\d)_(CA|HA|SA|BA|LA|AA|FA)_A$/;
  const items = new Map();
  const files = listTextDataShardNamesSync(textdataDir, /^itemdata.*\.txt$/i);
  for (const file of files) {
    for (const line of readTextDataLinesSync(path.join(textdataDir, file))) {
      const cols = splitTextDataRow(line);
      const codename = cols[DEFAULT_ITEM_CODENAME_COL];
      if (!codename || !pattern.test(codename)) continue;
      // The worn model is the FIRST .bsr column (AssocFileObj); the second is the ground
      // drop model (item\etc\drop_*). Rows without a real model fail to resolve in native
      // (sub_870040 returns 0) and the degree walks down - mirror that by skipping them.
      const bsr = cols.find((c) => /\.bsr$/i.test(c) && !/[\\/]drop_/i.test(c));
      if (!bsr) continue;
      items.set(codename, `res/${bsr.replaceAll("\\", "/").toLowerCase()}`);
    }
  }
  return items;
}

export function armorCodename(race, gender, type, degree, part) {
  return `ITEM_${race}_${gender}_${type}_${String(degree).padStart(2, "0")}_${part}_A`;
}

// ---------------------------------------------------------------------------- weapons
// Native crowd weapon rolls (DressCrowdAvatar sub_4c0900 switch tables, in roll order):
//   CH: rand()%5 -> kind ids {3 BLADE, 2 SWORD, 5 TBLADE, 4 SPEAR, 6 BOW}
//   EU: rand()%8 -> kind ids {7 SWORD, 8 TSWORD, 9 AXE, 0xf STAFF, 0xb TSTAFF,
//                             0xc CROSSBOW, 0xd DAGGER, 0xe HARP}
// (EU DARKSTAFF kind 0xa exists in EquipRandomCrowdGear's format switch but its roll
// case (8) is unreachable with %8 - the native crowd never carries one.)
export const NATIVE_WEAPON_KINDS = {
  CH: ["BLADE", "SWORD", "TBLADE", "SPEAR", "BOW"],
  EU: ["SWORD", "TSWORD", "AXE", "STAFF", "TSTAFF", "CROSSBOW", "DAGGER", "HARP"]
};

/**
 * One-hand kinds that also roll a shield (EquipRandomCrowdGear lookup_table_870cbc:
 * value 0 at kind-2 indices 0,1,5,0xd = CH SWORD, CH BLADE, EU SWORD, EU STAFF).
 */
export const NATIVE_SHIELD_KINDS = new Set(["CH_SWORD", "CH_BLADE", "EU_SWORD", "EU_STAFF"]);

/**
 * Dual-wield kinds (CrowdEquip_AttachItemByCodename sub_870040: RefObjItem TypeID
 * hi-bits 9/0xd attach "<path>_l.bsr" THEN "<path>_r.bsr" instead of the row path -
 * the bare .bsr does not exist on disk for these). EU axe and dagger pairs.
 */
export const NATIVE_DUAL_WIELD_KINDS = new Set(["EU_AXE", "EU_DAGGER"]);

export function weaponCodename(race, kind, degree) {
  return `ITEM_${race}_${kind}_${String(degree).padStart(2, "0")}_A`;
}

/**
 * Load every weapon/shield itemdata row the crowd can roll:
 * Map<codename, modelBsrPath>. The row path is kept VERBATIM (dual-wield kinds point
 * at a non-existent bare .bsr; the caller derives _l/_r exactly like sub_870040).
 */
export function loadCrowdWeaponItems(textdataDir) {
  const kinds = [...new Set([...NATIVE_WEAPON_KINDS.CH, ...NATIVE_WEAPON_KINDS.EU])].join("|");
  const pattern = new RegExp(`^ITEM_(CH|EU)_(${kinds}|SHIELD)_(\\d\\d)_A$`);
  const items = new Map();
  const files = listTextDataShardNamesSync(textdataDir, /^itemdata.*\.txt$/i);
  for (const file of files) {
    for (const line of readTextDataLinesSync(path.join(textdataDir, file))) {
      const cols = splitTextDataRow(line);
      const codename = cols[DEFAULT_ITEM_CODENAME_COL];
      if (!codename || !pattern.test(codename)) continue;
      const bsr = cols.find((c) => /\.bsr$/i.test(c) && !/[\\/]drop_/i.test(c));
      if (!bsr) continue;
      items.set(codename, `res/${bsr.replaceAll("\\", "/").toLowerCase()}`);
    }
  }
  return items;
}

/**
 * Enumerate every weapon/shield the native crowd rolls can reach:
 * [{ race, kind, degree, key "CH_SWORD_01", bsrPaths: [..1 or 2 paths..], dual }].
 * Degrees run 1..NATIVE_MAX_DEGREE[race] (the native walk only ever goes DOWN from
 * the rolled degree, so nothing above the race's max level roll is reachable).
 */
export function resolveCrowdWeaponSets(textdataDir, maxDegrees=NATIVE_MAX_DEGREE) {
  const items = loadCrowdWeaponItems(textdataDir);
  const out = [];
  for (const race of ["CH", "EU"]) {
    for (const kind of [...NATIVE_WEAPON_KINDS[race], "SHIELD"]) {
      const dual = NATIVE_DUAL_WIELD_KINDS.has(`${race}_${kind}`);
      for (let degree = 1; degree <= maxDegrees[race]; degree += 1) {
        const rowPath = items.get(weaponCodename(race, kind, degree));
        if (!rowPath) continue;
        const bsrPaths = dual
          ? [rowPath.replace(/\.bsr$/, "_r.bsr"), rowPath.replace(/\.bsr$/, "_l.bsr")]
          : [rowPath];
        out.push({
          race,
          kind,
          degree,
          key: `${race}_${kind}_${String(degree).padStart(2, "0")}`,
          bsrPaths,
          dual
        });
      }
    }
  }
  return out;
}

export function dressSetKey(race, gender, type, degree) {
  return `${race}_${gender}_${type}_${String(degree).padStart(2, "0")}`;
}

/**
 * Enumerate every armor set the native rolls can reach, with the pieces that actually
 * resolve to a model: [{ race, gender, type, degree, key, parts: Map<part, bsrPath> }].
 */
export function resolveCrowdDressSets(textdataDir, maxDegrees=NATIVE_MAX_DEGREE) {
  const items = loadCrowdArmorItems(textdataDir);
  const sets = [];
  for (const race of ["CH", "EU"]) {
    for (const gender of ["M", "W"]) {
      for (const type of NATIVE_ARMOR_TYPES) {
        for (let degree = 1; degree <= maxDegrees[race]; degree += 1) {
          const parts = new Map();
          for (const part of NATIVE_ARMOR_PARTS) {
            const bsr = items.get(armorCodename(race, gender, type, degree, part));
            if (bsr) parts.set(part, bsr);
          }
          if (parts.size > 0) {
            sets.push({ race, gender, type, degree, key: dressSetKey(race, gender, type, degree), parts });
          }
        }
      }
    }
  }
  return sets;
}
