import { readFile } from "node:fs/promises";
import path from "node:path";

// Dedicated lazy model groups, owned by focused publishers
// (build/char/publish{Equipment,Cosmetics,Hwan,CosEmotes}.mjs) AND by the full
// pack build (assetPackGroups.mjs). Both sides derive the member list from this
// module, so a full build and a focused publish always agree on which group
// owns a file. Before this, the full build swept every .glb into game-models
// while each publisher appended its own group over the same paths. Whichever
// ran second produced a duplicate-owner index that the client rejects
// wholesale (2026-09-23).
//
// Membership comes from the published authority documents (roster.json, the
// NPC manifest), never from directory sweeps. A stale GLB on disk that no
// document references stays in the generic game-models sweep.

const unique = (paths) => [...new Set(paths.filter((value) => typeof value === "string" && value))];

/** Equipment bodies, default wear and avatar auxiliaries under /assets/char/equipment/. */
export function equipmentModelFiles(dress) {
  const entries = [
    ...Object.values(dress?.equipment ?? {}).flatMap((row) => Object.values(row?.bodies ?? {}).filter(Boolean)),
    ...Object.values(dress?.defaultWear ?? {}),
    ...Object.values(dress?.avatarAuxiliary ?? {})
  ];
  return unique(entries.map((entry) => entry?.glb)).filter((glb) => glb.includes("/equipment/"));
}

export function cosmeticModelFiles(dress) {
  return unique(Object.values(dress?.cosmetics ?? {}).map((entry) => entry?.glb));
}

export function hwanModelFiles(dress) {
  return unique(Object.values(dress?.hwan ?? {}).map((entry) => entry?.glb));
}

/** COS (pet/transport) models and their VAT artifacts from the NPC manifest. */
export function cosModelFiles(npcManifest) {
  const rows = Object.values(npcManifest?.models ?? {}).filter((row) => row?.kind === "cos");
  return unique(rows.flatMap((row) => [row.glb, ...(row.vat ? [row.vat.manifest, row.vat.bin] : [])]));
}

/** Group name -> member derivation. Order is precedence if two documents ever overlap. */
export const DEDICATED_MODEL_GROUPS = [
  { name: "equipment-models", source: "roster", files: (docs) => equipmentModelFiles(docs.roster?.dress) },
  { name: "cosmetic-models", source: "roster", files: (docs) => cosmeticModelFiles(docs.roster?.dress) },
  { name: "hwan-models", source: "roster", files: (docs) => hwanModelFiles(docs.roster?.dress) },
  { name: "mission-cos-models", source: "npc", files: (docs) => cosModelFiles(docs.npc) }
];

async function readJsonIfPresent(filename) {
  try {
    return JSON.parse(await readFile(filename, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

/**
 * Resolve the dedicated groups for a full pack build. `available` is the
 * case-folded set of files that actually exist in the listing. A member the
 * documents name but the tree lacks is left to the focused publisher's own
 * "missing from pack" check instead of failing the whole build here.
 */
export async function collectDedicatedModelGroups(publicRoot, available) {
  const docs = {
    roster: await readJsonIfPresent(path.join(publicRoot, "assets", "char", "roster.json")),
    npc: await readJsonIfPresent(path.join(publicRoot, "assets", "npc", "manifest.json"))
  };
  const claimed = new Set();
  const groups = [];
  for (const declaration of DEDICATED_MODEL_GROUPS) {
    const files = declaration
      .files(docs)
      .filter((file) => available.has(file.toLowerCase()) && !claimed.has(file.toLowerCase()));
    for (const file of files) claimed.add(file.toLowerCase());
    if (files.length) groups.push({ name: declaration.name, load: "lazy", files });
  }
  return { groups, claimed };
}
