import {listTextDataShardNamesSync,readTextDataLinesSync,splitTextDataRow} from '../shared/textDataIo.mjs';
// Batch-build the title crowd roster: resolve every codename to its model, assemble
// the skinned mesh + skeleton + walk/run clips, export a .glb, and emit a roster manifest.
//
// Faithful to the native pipeline (SpawnEuropIntroCrowd sub_4e26d0): the crowd picks a
// random codename from the 60-entry roster, resolves it through CharacterData to a model
// (.bsr) loaded ONCE and shared across instances. Mirror that here -> one GLB per model,
// instanced at runtime. Output mirrors the native res/ layout:
//   res/char/<region>/<name>.bsr -> public/assets/char/<region>/<name>.glb
//   res/cos/<name>.bsr           -> public/assets/cos/<name>.glb
// plus public/assets/char/roster.json (codename -> glb + region + speeds + isMount).
//
// Texture .ddj -> .png conversion is delegated to scripts/convert_images.py (run it once
// before/with this script; pass --skip-textures to skip). We pass prim/mtrl so every
// material tree (char, cos, item, mob, ??) is covered without listing categories.

import fs from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  NATIVE_ATTACK_STATE_CLIPS,
  NATIVE_CHARACTER_SELECT_STATE_IDS,
  NATIVE_CREATE_PREVIEW_ANIMATION_SET_NAMES,
  NATIVE_DEATH_STATE_CLIPS,
  NATIVE_REACTION_STATE_CLIPS,
  NATIVE_IDLE_STATE_CLIPS,
  NATIVE_EMOTE_STATE_CLIPS,
  assembleAvatar,
  characterSelectAnimationRoleForStateId,
  previewAnimationRoleForSetName,
  weaponAttackAnimationRoleForSetName,
  primSlot
} from "./buildAvatar.mjs";
import { avatarToGlb } from "./exportGlb.mjs";
import { resolveRoster } from "./resolveCharRoster.mjs";
import {
  NATIVE_ARMOR_PARTS,
  NATIVE_ARMOR_TYPES,
  NATIVE_DUAL_WIELD_KINDS,
  NATIVE_LEVEL_DEGREE_LUT,
  NATIVE_LEVEL_RANGE,
  NATIVE_SHIELD_KINDS,
  NATIVE_WEAPON_KINDS,
  resolveCrowdDressSets,
  resolveCrowdWeaponSets
} from "./resolveCrowdDress.mjs";
import { parseJmxResourceBsr } from "../world/objects/formats.mjs";
import { parseAttachPartLink, parseBsk, parseCharacterBsr } from "./formats.mjs";
import { loadDataAsset } from "../shared/jmxAssetIO.mjs";
import { writeJsonIfChangedSync } from "../shared/jsonOut.mjs";
import { runConvertImages } from "../shared/convertImagesRunner.mjs";
import { isMainScript } from "../shared/fsUtils.mjs";
import { quatMultiply, quatRotateVector } from "../shared/math3d.mjs";
import { refreshPrecompressedSidecars } from "../generatedManifestSidecars.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const gameRoot = path.resolve(scriptDir, "..", "..", "..", "..");
const rebuildRoot = path.join(gameRoot, "rebuild");
const textdataDir = path.join(gameRoot, "extracted", "Media_extracted", "server_dep", "silkroad", "textdata");
const publicAssets = path.join(rebuildRoot, ".generated", "client-public", "assets");
// "pick" = the ground-item pickup scoop (motion 0x26 / ANI_PICK): the mission
// local player renders from this GLB, and the 0x35C7 -> state-10 chain plays
// the scoop once with a 200ms blend.
// The charselect-state13/14/15 roles are the .bsr default-set sit trio
// (sit-down / sit / stand-up - the same states the char-select campfire
// uses): the mission 0x7017/0x3122 motion-state round trip plays them via
// state-6 (sub_8e6a90) and Stall3 (sub_8e6980), so the mission GLB must
// carry the groups. The attack1-4 roles are native default-set states
// 2/5/0x10/0x11; death/deathloop/deathquick are the state-1
// motion 4/0x24/0x42 trio. The mission actor needs both families.
const WEAPON_ATTACK_CLIP_ROLES = NATIVE_CREATE_PREVIEW_ANIMATION_SET_NAMES.flatMap((setName) =>
  NATIVE_ATTACK_STATE_CLIPS.map(({ role }) => weaponAttackAnimationRoleForSetName(role, setName))
);
const CROWD_CLIP_ROLES = new Set([
  // Mission inventory borrows this model and plays native weapon-set state 0.
  ...NATIVE_CREATE_PREVIEW_ANIMATION_SET_NAMES.map(previewAnimationRoleForSetName),
  ...NATIVE_EMOTE_STATE_CLIPS.map(({ role }) => role),
  ...NATIVE_IDLE_STATE_CLIPS.map(({ role }) => role),
  "walk",
  "run",
  "stand",
  "ride",
  "pick",
  ...NATIVE_ATTACK_STATE_CLIPS.map(({ role }) => role),
  ...NATIVE_REACTION_STATE_CLIPS.map(({ role }) => role),
  ...WEAPON_ATTACK_CLIP_ROLES,
  ...NATIVE_DEATH_STATE_CLIPS.map(({ role }) => role),
  ...NATIVE_CHARACTER_SELECT_STATE_IDS.map(characterSelectAnimationRoleForStateId)
]);
const CREATE_PREVIEW_CLIP_ROLES = new Set([
  "stand",
  ...NATIVE_ATTACK_STATE_CLIPS.map(({ role }) => role),
  ...NATIVE_REACTION_STATE_CLIPS.map(({ role }) => role),
  ...NATIVE_DEATH_STATE_CLIPS.map(({ role }) => role),
  ...NATIVE_CREATE_PREVIEW_ANIMATION_SET_NAMES.map(previewAnimationRoleForSetName),
  ...WEAPON_ATTACK_CLIP_ROLES,
  ...NATIVE_CHARACTER_SELECT_STATE_IDS.map(characterSelectAnimationRoleForStateId)
]);

/** Rider seat dummy bone present in every trade-transport skeleton (Bionic_MountRider). */
const SEAT_BONE = "saddle";

/**
 * Absolute bind position (SRO model space, Y-up) of the seat bone via FK over the
 * skeleton's parent-local transforms - the same space the GLB exporter bakes vertices in
 * (the runtime flips Z to match the right-handed GLB). Returns null if no seat bone.
 */
function seatOffset(skeleton) {
  const idx = skeleton.byName.get(SEAT_BONE);
  if (idx === undefined) return null;
  const worldQ = new Array(skeleton.bones.length);
  const worldT = new Array(skeleton.bones.length);
  for (const b of skeleton.bones) {
    if (b.parentIndex < 0) {
      worldQ[b.index] = b.local.q.slice();
      worldT[b.index] = b.local.t.slice();
    } else {
      const pq = worldQ[b.parentIndex];
      const pp = worldT[b.parentIndex];
      const rt = quatRotateVector(pq, b.local.t);
      worldT[b.index] = [pp[0] + rt[0], pp[1] + rt[1], pp[2] + rt[2]];
      worldQ[b.index] = quatMultiply(pq, b.local.q);
    }
  }
  const t = worldT[idx];
  return [Number(t[0].toFixed(3)), Number(t[1].toFixed(3)), Number(t[2].toFixed(3))];
}

/** Public output path (and on-disk path) for a resolved model, mirroring native res/. */
function glbOutput(model) {
  // model.bsrPath = "res/char/europe/foo.bsr" | "res/cos/t_horse1.bsr"
  const rel = model.bsrPath.replace(/^res\//i, "").replace(/\.bsr$/i, ".glb");
  return { publicPath: `/assets/${rel}`, diskPath: path.join(publicAssets, ...rel.split("/")) };
}

/** Create-screen avatars use the same default live stand state as CIFCharacterWnd. */
function previewGlbOutput(model) {
  const rel = model.bsrPath.replace(/^res\/char\//i, "").replace(/\.bsr$/i, ".glb");
  return {
    publicPath: `/assets/char/preview/${rel}`,
    diskPath: path.join(publicAssets, "char", "preview", ...rel.split("/"))
  };
}

/** Convert material textures via convert_images.py (all prim/mtrl/* trees). */
async function convertTextures() {
  if (process.env.SRO_SKIP_TEXTURE_CONVERT === "1") {
    console.log("[roster] skipping texture conversion (SRO_SKIP_TEXTURE_CONVERT=1)");
    return;
  }
  console.log("[roster] converting textures (prim/mtrl) ...");
  const res = await runConvertImages(["prim/mtrl"]);
  if (res.status !== 0) {
    throw new Error(`[roster] texture conversion exited ${res.status}`);
  }
}

/**
 * Build one GLB per crowd-dress armor set (native random equipment, sub_4c0900 ->
 * sub_8703f0; see resolveCrowdDress.mjs for the full RE). Each set GLB carries a
 * same-race/gender donor skeleton plus one named mesh per part ("part:BA", ...),
 * skinned by Bip01 bone names. Joint ORDER is donor-local and carries no meaning
 * across models: human skeletons vary (41/43/45 bones), so the runtime re-binds each
 * piece to its actual wearer BY BONE NAME (bindDressMeshToWearerSkeleton, the native
 * CRTBranch_Build architecture) before reusing the wearer's baked VAT matrices.
 * No clips are embedded.
 *
 * Skin hiding is NATIVE DATA, not heuristics: every item .bsr ends with a part-link
 * table listing the cover KEYS the item covers, and every char .bsr ends with its
 * {coverKey -> skin prim index} map (CResAttachable::Load sub_a508a0; applied on equip
 * by CCompChar sub_a89bd0 - see parseAttachPartLink). The manifest stores each part's
 * key list (`covers`); the runtime intersects it with the wearer's own cover map.
 */
/**
 * Same-bone test across two skeleton files: the name alone is NOT identity (item-private
 * dangle bones reuse generic names like "Bone01"); the bind world pose must agree too.
 * Genuinely shared bones come from the same rig export, so the tolerance is loose only
 * against fp noise (0.1 SRO unit = 1cm).
 */
function bindWorldsMatch(a, b) {
  if (!a?.world || !b?.world) return false;
  const at = a.world.t, bt = b.world.t;
  if (Math.hypot(at[0] - bt[0], at[1] - bt[1], at[2] - bt[2]) > 0.1) return false;
  const aq = a.world.q, bq = b.world.q;
  const dot = aq[0] * bq[0] + aq[1] * bq[1] + aq[2] * bq[2] + aq[3] * bq[3];
  return Math.abs(dot) > 0.995; // q and -q are the same rotation
}

/**
 * Skeleton donor per (race, gender). Bone NAMES are the only contract between an
 * item GLB and its wearers (the runtime re-binds indices per wearer by name -
 * bindDressMeshToWearerSkeleton, mirroring native CRTBranch_Build), but the donor
 * must still KNOW the item's bone names to keep their animation, and CH/EU
 * skeletons differ - so pick a donor of the item's own race.
 */
export function createDonorPool(resolvedRoster) {
  const donorFor = (race, gender) =>
    resolvedRoster.find(
      (m) => !m.isMount && m.codename.includes(`_${race}_${gender === "M" ? "MAN" : "WOMAN"}_`)
    ) ?? resolvedRoster.find((m) => !m.isMount && (gender === "M" ? /_MAN_/ : /_WOMAN_/).test(m.codename));
  const donors = new Map();
  const donorSkeletons = new Map(); // donor.bsrPath -> parsed BSK (byName)
  return async (race, gender) => {
    const donorKey = `${race}|${gender}`;
    if (!donors.has(donorKey)) donors.set(donorKey, donorFor(race, gender));
    const donor = donors.get(donorKey);
    if (!donor) return null;
    let donorSkel = donorSkeletons.get(donor.bsrPath);
    if (!donorSkel) {
      const donorChar = parseCharacterBsr(await loadDataAsset(donor.bsrPath), donor.bsrPath);
      donorSkel = parseBsk(await loadDataAsset(donorChar.skeletonPath), donorChar.skeletonPath);
      donorSkeletons.set(donor.bsrPath, donorSkel);
    }
    return { donor, donorSkel };
  };
}

/**
 * Build one item-set GLB (armor pieces OR weapon/shield parts - natively both are
 * the same CRes attachable on the same CRTBranch mechanism) on a donor body skeleton.
 * pieces: [{ part, itemBsrPath }]; returns a manifest entry { glb, parts, covers }
 * or null when nothing was bindable. `tag` is the log prefix ("dress"/"weapon").
 */
export async function buildItemSetGlb({ tag, key, donor, donorSkel, pieces, outSubdir }) {
  // Resolve every piece's item .bsr -> skinned mesh paths + material set + cover keys.
  const meshPaths = [];
  const materialSetPaths = [];
  const partByMesh = new Map();
  const environmentByMesh = new Map();
  // Per-mesh view of the ITEM's OWN skeleton (.bsk): parent links for the ancestor
  // walk, full bones (incl. bind world) for bind-pose validation. Native item bone
  // hierarchies resolve inside the item's own CRTBranch only - a wearer bone with the
  // same generic name ("Bone01"...) is a different bone entirely, so a name match is
  // only trusted when the BIND POSES agree.
  const itemSkelByMesh = new Map();
  // Per-mesh wearer attach bone from the item .bsr skeleton section ("Bip01 Neck1"
  // on shoulder ornaments, "Bip01 R HandMid" on weapons, "Bip01 L Hand" on bows and
  // shields): the bone the item's whole private branch is parented to
  // (CRTBranch_LinkToParentBranch sub_abc680).
  const attachByMesh = new Map();
  const covers = {};
  for (const { part, itemBsrPath, materialSetId } of pieces) {
    let itemBsr;
    let itemBuf;
    try {
      itemBuf = await loadDataAsset(itemBsrPath);
      itemBsr = parseJmxResourceBsr(itemBuf, itemBsrPath);
    } catch (error) {
      console.warn(`[${tag}] ${key} ${part}: ${error?.message ?? error}`);
      continue;
    }
    if (itemBsr.meshPaths.length === 0) continue;
    let itemSkelInfo = null;
    let attachBone = "";
    try {
      const itemChar = parseCharacterBsr(itemBuf, itemBsrPath);
      attachBone = itemChar.skeletonAttachBone ?? "";
      if (itemChar.skeletonPath) {
        const itemSkel = parseBsk(await loadDataAsset(itemChar.skeletonPath), itemChar.skeletonPath);
        itemSkelInfo = {
          parents: new Map(itemSkel.bones.map((b) => [b.name, b.parent])),
          byName: new Map(itemSkel.bones.map((b) => [b.name, b]))
        };
      }
    } catch {
      itemSkelInfo = null; // item has no own skeleton; unbound bones stay unresolvable
    }
    for (const meshPath of itemBsr.meshPaths) {
      meshPaths.push(meshPath);
      partByMesh.set(meshPath, part);
      environmentByMesh.set(meshPath,itemBsr.modifiers?.environmentModifiers??[]);
      if (itemSkelInfo) itemSkelByMesh.set(meshPath, itemSkelInfo);
      if (attachBone) attachByMesh.set(meshPath, attachBone);
    }
    const selectedMaterials=materialSetId===undefined?itemBsr.materialPaths:itemBsr.materialSection.paths.filter((_,i)=>itemBsr.materialSection.setIds[i]===materialSetId);
    if(materialSetId!==undefined&&selectedMaterials.length!==1)throw Error(`Missing/ambiguous material set ${materialSetId}: ${itemBsrPath}`);
    for (const mtl of selectedMaterials) {
      if (!materialSetPaths.includes(mtl)) materialSetPaths.push(mtl);
    }
    // Native cover keys from the item BSR tail. The apply gate is the THIRD header
    // dword (`c`, this[0xc5]) == 1 - CCompChar_ApplyItemCovers sub_a89bd0 checks
    // result_2[2], NOT the first dword. c is the cover MODE: 1 = replacement armor
    // (hide matching skin prims; bows are c=1 too), 2 = layered accessory (bracers/
    // shoulder pads/most weapons drawn OVER the skin - hide nothing). Gating on `a`
    // (always 1) hid the bare-hand skin prim under every c=2 bracer.
    const link = parseAttachPartLink(itemBuf);
    covers[part] = link && link.c === 1 ? link.pairs.map((p) => p.key) : [];
  }
  if (meshPaths.length === 0) return null;

  const fileName = `${key.toLowerCase()}.glb`;
  const diskPath = path.join(publicAssets, "char", outSubdir, fileName);
  const publicPath = `/assets/char/${outSubdir}/${fileName}`;
  const avatar = await assembleAvatar(donor.bsrPath, {
        name: key,
        meshPaths,
        materialSetPaths,
        environmentModifiersForMesh:meshPath=>environmentByMesh.get(meshPath)??[],
        noClips: true,
        // A direct name match is only genuine if the item's own .bsk agrees with the
        // donor on that bone's BIND POSE (same rig family). Item-private bones with
        // generic names would otherwise teleport onto an unrelated wearer bone.
        acceptBone: (bone, meshPath) => {
          const info = itemSkelByMesh.get(meshPath);
          const itemBone = info?.byName.get(bone);
          if (!itemBone) return true; // not in the item's own skeleton: a wearer bone
          const donorBone = donorSkel.bones[donorSkel.byName.get(bone)];
          return bindWorldsMatch(itemBone, donorBone);
        },
        // Item-private bones, in native priority order:
        // 1) Nearest genuinely-shared ancestor (name AND bind pose match) by walking
        //    the ITEM's own .bsk hierarchy - trackless-bone telescoping (the skin
        //    matrix equals the nearest animated ancestor's; RTSkeleton.cpp
        //    CRTSocket_UpdateMatrices).
        // 2) The item's ATTACH bone (.bsr skeleton section, e.g. "Bip01 Neck1"):
        //    natively the whole private branch is parented under that wearer socket
        //    (CRTBranch_LinkToParentBranch sub_abc680) in a special mode (+0xa0=1).
        //    The root's update (CRTSocket_UpdateMatricesAttachRoot sub_ab5870) does
        //    NOT use the attach bone's world matrix: it uses the attach bone's SKIN
        //    matrix (world*invBind = bind-relative delta) with its translation row
        //    replaced by the attach bone's absolute world POSITION. The attach bind
        //    ROTATION is cancelled by construction - the item keeps its authored
        //    model-space orientation. Net effect with branch bones at bind:
        //      v_world = attachDelta * (v_model + attachBindWorld.t)
        //    and since the VAT row IS attachDelta with translation
        //    t_cur - delta*t_bind, the exact bake is TRANSLATION ONLY:
        //      v' = v_model + attachBindWorld.t  (identity rotation!)
        //    (Baking the bind rotation too is what rotated the EU shoulder crystals
        //    90 degrees; the spherical CH orbs just hid the same error.)
        // 3) Donor ROOT row (documented deviation: native would hold bind pose +
        //    spring sim; VAT can't spring-simulate, but the piece follows the body).
        resolveUnboundBone: (bone, meshPath) => {
          const info = itemSkelByMesh.get(meshPath);
          let cur = bone;
          const seen = new Set();
          while (info?.parents.has(cur) && !seen.has(cur)) {
            seen.add(cur);
            cur = info.parents.get(cur);
            if (!cur) break;
            const di = donorSkel.byName.get(cur);
            if (di !== undefined && bindWorldsMatch(info.byName.get(cur), donorSkel.bones[di])) return cur;
          }
          const attach = attachByMesh.get(meshPath);
          const ai = attach ? donorSkel.byName.get(attach) : undefined;
          if (ai !== undefined) {
            const ab = donorSkel.bones[ai];
            return { bone: attach, bake: { q: [0, 0, 0, 1], t: ab.world.t } };
          }
          return donorSkel.bones[0].name;
        },
        slotForMesh: (meshPath) => `part:${partByMesh.get(meshPath)}`
      });
      if (avatar.parts.length === 0) {
        console.warn(`[${tag}] SKIP ${key.padEnd(16)} no bindable pieces`);
        return null;
      }
      const survivingParts = [...new Set(avatar.parts.map((p) => partByMesh.get(p.meshPath)))];
      const glb = avatarToGlb(avatar);
      fs.mkdirSync(path.dirname(diskPath), { recursive: true });
      fs.writeFileSync(diskPath, glb);

      // Keep cover keys only for parts that survived the export.
      const partCovers = {};
      for (const part of survivingParts) partCovers[part] = covers[part] ?? [];

      const dropped = avatar.skippedMeshes.map((s) => `${partByMesh.get(s.meshPath)}(${s.bone})`);
      const remapped = avatar.remappedBones.map(
        (r) => `${partByMesh.get(r.meshPath)}:${r.bone}${r.baked ? "=>" : "->"}${r.fallback}`
      );
      const coverNote = survivingParts
        .map((p) => `${p}>{${(partCovers[p] ?? []).join(",")}}`)
        .join(" ");
      console.log(
        `[${tag}] OK   ${key.padEnd(16)} -> ${publicPath} (${glb.length} B, parts=[${survivingParts}]` +
          `${dropped.length ? ` dropped=[${dropped}]` : ""}` +
          `${remapped.length ? ` remapped=[${remapped}]` : ""} covers{${coverNote}})`
      );
  return { glb: publicPath, parts: survivingParts, covers: partCovers };
}

// Retail8E9060 attaches these two race-specific resources on body mode1.
export async function buildHwanHairSets(){
 const entries={};
 for(const [gender,name] of [['M','chinaman'],['W','chinawoman']]){
  const key=`CH_${gender}`,bsrPath=`res/char/china/${name}_hwan_hair.bsr`,buffer=await loadDataAsset(bsrPath),link=parseAttachPartLink(buffer);
  // Preserve the private hair skeleton and authored default/state0 BAN.
  const avatar=await assembleAvatar(bsrPath,{slotForMesh:()=> 'part:HWAN_HAIR'});
  if(!avatar.clips.some(c=>c.role==='stand'))throw new Error(`Missing Hwan animation ${gender}`);
  const publicPath=`/assets/char/hwan/${key.toLowerCase()}.glb`,diskPath=path.join(publicAssets,publicPath.slice('/assets/'.length));
  fs.mkdirSync(path.dirname(diskPath),{recursive:true});fs.writeFileSync(diskPath,avatarToGlb(avatar));
  entries[key]={glb:publicPath,parts:['HWAN_HAIR'],covers:{HWAN_HAIR:link?.c===1?link.pairs.map(p=>p.key):[]},clip:'stand',bone:'Bip01 Head'};
 }
 return entries;
}

// 8E9DD0 installs the override's auxiliary resource as its second handle.
// Keep its own skeleton/BANs; rebinding these bones into the body loses motion.
export async function buildAuxiliaryAvatarSets(overrides){
 const entries={};
 for(const [id,row] of Object.entries(overrides)){
  if(!row.additionalBsr)continue;
  const buffer=await loadDataAsset(row.additionalBsr),bsr=parseCharacterBsr(buffer,row.additionalBsr),link=parseAttachPartLink(buffer);
  if(!bsr.skeletonAttachBone)throw Error(`Missing auxiliary avatar socket ${id}`);
  const avatar=await assembleAvatar(row.additionalBsr,{slotForMesh:()=> 'part:AVATAR_AUX'});
  const clips=avatar.clips.map(c=>c.role);
  if(!clips.includes('stand'))throw Error(`Missing auxiliary initial track ${id}`);
  const glb=`/assets/char/equipment/avatar_aux_${id}.glb`,diskPath=path.join(publicAssets,glb.slice('/assets/'.length));
  fs.mkdirSync(path.dirname(diskPath),{recursive:true});fs.writeFileSync(diskPath,avatarToGlb(avatar));
  entries[id]={glb,parts:['AVATAR_AUX'],covers:{AVATAR_AUX:link?.c===1?link.pairs.map(p=>p.key):[]},bone:bsr.skeletonAttachBone,clips,environmentModifiers:bsr.environmentModifiers};
 }
 return entries;
}

export async function buildCosmeticSets(){
 const {resolved}=resolveRoster(textdataDir),getDonor=createDonorPool(resolved),entries={};
 for(const file of listTextDataShardNamesSync(textdataDir,/^itemdata.*\.txt$/i))for(const line of readTextDataLinesSync(path.join(textdataDir,file))){
  const cols=splitTextDataRow(line),code=cols[2],gender=/^ITEM_MALL_AVATAR_([MW])_/.exec(code??'')?.[1];
  if(!gender||Number(cols[9])!==3||Number(cols[10])!==1||Number(cols[11])!==13)continue;
  const model=cols[52];if(!model?.toLowerCase().endsWith('.bsr'))throw new Error(`Missing cosmetic model ${code}`);
  for(const race of ['CH','EU']){
   const ctx=await getDonor(race,gender);if(!ctx)throw new Error(`Missing cosmetic donor ${race}/${gender}`);
   const key=`${race}_${gender}_${cols[1]}`,part=`AV${Number(cols[12])-1}`;
   const entry=await buildItemSetGlb({tag:'cosmetic',key,donor:ctx.donor,donorSkel:ctx.donorSkel,pieces:[{part,itemBsrPath:`res/${model.replaceAll('\\','/').toLowerCase()}`}],outSubdir:'cosmetic'});
   if(!entry)throw new Error(`Empty cosmetic ${code}`);entries[key]={...entry,refObjId:Number(cols[1]),slot:Number(cols[12])-1};
  }
 }
 return entries;
}

export async function buildDressSets(resolvedRoster, getDonor, maxDegrees) {
  const sets = resolveCrowdDressSets(textdataDir,maxDegrees);
  const manifest = {};
  let built = 0;
  for (const set of sets) {
    const ctx = await getDonor(set.race, set.gender);
    if (!ctx) throw new Error(`[dress] no ${set.race}/${set.gender} skeleton donor for ${set.key}`);
    try {
      const entry = await buildItemSetGlb({
        tag: "dress",
        key: set.key,
        donor: ctx.donor,
        donorSkel: ctx.donorSkel,
        pieces: [...set.parts].map(([part, itemBsrPath]) => ({ part, itemBsrPath })),
        outSubdir: "dress"
      });
      if (!entry) throw new Error("no bindable pieces");
      manifest[set.key] = entry;
      built += 1;
    } catch (error) {
      throw new Error(`[dress] FAIL ${set.key}: ${error?.message ?? error}`, { cause: error });
    }
  }
  console.log(`[dress] built ${built}/${sets.length} armor-set GLBs`);
  return manifest;
}

/**
 * Build one GLB per crowd-rollable weapon/shield per gender. Natively a weapon is
 * just another CRes attachable (CrowdEquip_AttachItemByCodename sub_870040 ->
 * CCompound_AttachRes -> CRTSkeleton_RegisterAttachBranch): its meshes skin to a
 * private mini-skeleton ("Bone01","Bone02",...) whose branch parents under the
 * wearer's attach bone ("Bip01 R HandMid" right-hand weapons, "Bip01 L Hand" bows/
 * shields, "Bip01 L HandMid2" EU tstaff/harp). The exact same attach-root rule as
 * armor ornaments applies, so the same buildItemSetGlb path bakes them; the bake is
 * donor-specific (hand bind positions differ per race AND gender), hence one GLB per
 * "{race}_{gender}_{kind}_{degree}".
 * Parts: "WA" = the weapon (the _r half of EU axe/dagger dual pairs), "WL" = the _l
 * half of dual pairs.
 */
export async function buildWeaponSets(resolvedRoster, getDonor, maxDegrees) {
  const sets = resolveCrowdWeaponSets(textdataDir,maxDegrees);
  const manifest = {};
  let built = 0;
  let attempted = 0;
  for (const set of sets) {
    for (const gender of ["M", "W"]) {
      const ctx = await getDonor(set.race, gender);
      if (!ctx) throw new Error(`[weapon] no ${set.race}/${gender} skeleton donor`);
      attempted += 1;
      const key = `${set.race}_${gender}_${set.kind}_${String(set.degree).padStart(2, "0")}`;
      try {
        const entry = await buildItemSetGlb({
          tag: "weapon",
          key,
          donor: ctx.donor,
          donorSkel: ctx.donorSkel,
          pieces: set.bsrPaths.map((itemBsrPath, i) => ({ part: i === 0 ? "WA" : "WL", itemBsrPath })),
          outSubdir: "weapon"
        });
        if (!entry) throw new Error("no bindable pieces");
        manifest[key] = entry;
        built += 1;
      } catch (error) {
        throw new Error(`[weapon] FAIL ${key}: ${error?.message ?? error}`, { cause: error });
      }
    }
  }
  console.log(`[weapon] built ${built}/${attempted} weapon/shield GLBs`);
  return manifest;
}

export async function buildRoster({ skipTextures = false } = {}) {
  if (!skipTextures) await convertTextures();

  const { resolved, missing } = resolveRoster(textdataDir);
  if (missing.length) throw new Error(`[roster] unresolved codenames: ${missing.join(", ")}`);

  const models = [];
  let built = 0;
  for (const model of resolved) {
    const { publicPath, diskPath } = glbOutput(model);
    const entry = {
      codename: model.codename,
      refObjId: model.refObjId,
      region: model.region,
      isMount: model.isMount,
      walkSpeed: model.walkSpeed,
      runSpeed: model.runSpeed,
      glb: publicPath
    };
    try {
      // Slot names are prim indices ("prim0".."prim8") - the same addressing the native
      // part-link tables use, so the runtime can hide exactly the prims an item covers.
      const avatar = await assembleAvatar(model.bsrPath, {
        slotForMesh: (_mp, i) => primSlot(i),
        previewWeaponClips: !model.isMount,
        characterSelectStateClips: !model.isMount
      });
      // Both the title crowd simulation and Mission PathCtl advance their
      // actor holders. Their shared runtime GLB therefore owns pose only;
      // authored horizontal walk/run travel would otherwise be applied once
      // by the holder and a second time by the root bone.
      const runtimeAvatar = {
        ...avatar,
        clips: model.isMount
          ? avatar.clips
          : avatar.clips.filter((clip) => (CROWD_CLIP_ROLES.has(clip.role)||clip.role.startsWith('attached-'))),
        inPlaceHorizontalRootMotionRoles: ["walk", "run"]
      };
      const glb = avatarToGlb(runtimeAvatar);
      fs.mkdirSync(path.dirname(diskPath), { recursive: true });
      fs.writeFileSync(diskPath, glb);
      entry.bytes = glb.length;
      entry.bones = avatar.skeleton.boneCount;
      entry.hasClip = runtimeAvatar.clips.length > 0;
      entry.clips = runtimeAvatar.clips.map((c) => c.role);
      const requiredCrowdRoles = model.isMount ? ["stand", "walk"] : ["stand", "walk", "ride"];
      for (const role of requiredCrowdRoles) {
        if (!entry.clips.includes(role)) {
          throw new Error(`${model.codename} lacks required native crowd clip role ${role}`);
        }
      }
      entry.materials = avatar.materials.size;
      if (model.isMount) {
        const seat = seatOffset(avatar.skeleton);
        if (!seat) throw new Error(`mount ${model.codename} has no required ${SEAT_BONE} bone`);
        entry.seat = seat;
      }
      if (!model.isMount) {
        const previewOut = previewGlbOutput(model);
        const previewClips = avatar.clips.filter((clip) => CREATE_PREVIEW_CLIP_ROLES.has(clip.role));
        if (previewClips.length === 0) throw new Error(`${model.codename} has no required preview clips`);
        const previewAvatar = { ...avatar, clips: previewClips };
        const previewGlb = avatarToGlb(previewAvatar);
        fs.mkdirSync(path.dirname(previewOut.diskPath), { recursive: true });
        fs.writeFileSync(previewOut.diskPath, previewGlb);
        entry.previewGlb = previewOut.publicPath;
        entry.previewBytes = previewGlb.length;
        entry.previewClips = (previewAvatar.clips ?? []).map((c) => c.role);
      }
      // Native {coverKey -> prim index} map from the char BSR tail; worn items hide
      // the prims whose keys they cover (CCompChar sub_a89bd0). Mounts have none.
      if (avatar.partLink && avatar.partLink.pairs.length > 0) {
        entry.cover = Object.fromEntries(avatar.partLink.pairs.map((p) => [p.key, p.value]));
      }
      built += 1;
      const seatNote = entry.seat ? ` seat=[${entry.seat}]` : "";
      const previewNote = entry.previewGlb ? ` preview=[${entry.previewClips}]` : "";
      console.log(`[roster] OK   ${model.codename.padEnd(28)} -> ${publicPath} (${glb.length} B, clips=[${entry.clips}]${seatNote}${previewNote})`);
    } catch (error) {
      throw new Error(`[roster] FAIL ${model.codename}: ${error?.message ?? error}`, { cause: error });
    }
    models.push(entry);
  }

  const getDonor = createDonorPool(resolved);
  const dressSets = await buildDressSets(resolved, getDonor);
  const weaponSets = await buildWeaponSets(resolved, getDonor);

  const manifest = {
    format: "sro-title-crowd-roster",
    version: 2,
    source: "SpawnEuropIntroCrowd sub_4e26d0 (rand()%60 roster; CharacterData model+speed)",
    // Rider seat dummy referenced by Bionic_MountRider (sub_871420, name @0xcccd30):
    // every trade-transport skeleton carries a "saddle" bone; per-mount bind offset is
    // stored as models[].seat (SRO model space, Y-up) for runtime rider placement.
    mountSeatBone: SEAT_BONE,
    count: models.length,
    builtCount: built,
    models,
    // Native crowd random-equipment data (DressCrowdAvatar sub_4c0900 -> sub_8703f0).
    // The runtime mirrors the native rolls against these sets; see resolveCrowdDress.mjs.
    dress: {
      degreeLut: NATIVE_LEVEL_DEGREE_LUT,
      levelRange: NATIVE_LEVEL_RANGE,
      armorTypes: NATIVE_ARMOR_TYPES,
      parts: NATIVE_ARMOR_PARTS,
      sets: dressSets,
      // Weapon roll tables (EquipRandomCrowdGear sub_8703f0): kind list per race in
      // native roll order, the one-hand kinds that also equip a shield
      // (lookup_table_870cbc), and the dual-wield kinds that attach _l + _r models.
      weaponKinds: NATIVE_WEAPON_KINDS,
      shieldKinds: [...NATIVE_SHIELD_KINDS],
      dualWieldKinds: [...NATIVE_DUAL_WIELD_KINDS],
      // One GLB per "{race}_{gender}_{kind}_{degree}"; parts "WA" (+"WL" for duals).
      weapons: weaponSets,
      hwan: await buildHwanHairSets(),
      cosmetics: await buildCosmeticSets()
    }
  };
  const {buildEquipmentVisuals}=await import("./buildEquipmentVisuals.mjs");
  manifest.dress.equipment=await buildEquipmentVisuals(manifest.dress);
  const manifestPath = path.join(publicAssets, "char", "roster.json");
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  writeJsonIfChangedSync(manifestPath, manifest);
  await refreshPrecompressedSidecars([manifestPath], { onlyWhenStale: true });
  console.log(`\n[roster] built ${built}/${models.length} GLBs; manifest -> ${path.relative(gameRoot, manifestPath)}`);
  return { built, modelCount: models.length, missing, manifestPath };
}

if (isMainScript(import.meta.url)) {
  const args = process.argv.slice(2);
  await buildRoster({
    skipTextures: args.includes("--skip-textures")
  });
}
