import path from "node:path";
import { listPublicAssetFiles } from "./assetPacks.mjs";
import { collectDedicatedModelGroups } from "./assetPackOwnership.mjs";
import { rebuildRoot } from "./world/paths.mjs";

// The single definition of the browser asset pack groups: which groups exist, their
// load modes and target sizes, and every sweep/exclusion rule that keeps an asset
// family out of the generic game-data/game-images groups.
//
// Both pack-building entry points MUST route through collectAssetPackGroups():
//   - scripts/build_sro_resources.mjs (the full pipeline tail)
//   - scripts/rebuild_asset_packs_from_public.mjs (the standalone pack rebuild)
// Before this module existed each script carried its own inline copy of the group
// list, and they drifted: the mission-npc-vat group (plus its json-sweep exclusions)
// was added to the pipeline only, so standalone rebuilds silently produced packs
// missing that group. scripts/test/assets/assetPackGroupParity.test.mjs pins both the
// group/exclusion semantics (against a fixture tree) and the requirement that the
// entry points consume this module instead of inlining their own group lists.
//
// The only legitimate per-caller differences are the inputs: the ui-preload image
// list, the mission minimap tile list, and whether the outdoor streaming world was
// built at all (the pipeline skips the outdoor listing when its world lane produced
// no outdoor region group; the standalone rebuild always packs what is on disk).

// Native texture containers carry authored mip levels and must survive both
// full rebuilds and focused outdoor refreshes just like ordinary image files.
export const IMAGE_ASSET_EXTENSIONS = [".png", ".jpg", ".jpeg", ".dds", ".webp", ".cur", ".texture"];
export const isImageAsset = publicPath => IMAGE_ASSET_EXTENSIONS.some(extension => publicPath.toLowerCase().endsWith(extension));

export const OUTDOOR_WORLD_PACK_TARGET_BYTES = 8 * 1024 * 1024;

// VAT bins are lazy-loaded: the first NPC (or title crowd body) that needs one
// used to pay a ~50MiB default-target pack download. 8MiB chunks (the
// outdoor-world precedent) keep that first hit small while the model count grows.
export const VAT_PACK_TARGET_BYTES = 8 * 1024 * 1024;

const TITLE_CROWD_VAT_PREFIX = "/assets/char/vat/";
const MISSION_NPC_VAT_PREFIX = "/assets/npc/vat/";
const OUTDOOR_WORLD_PREFIX = "/assets/world/outdoor/";
const DEVELOPER_LAB_ANIMATION_CATALOG = "/assets/npc/animation-catalog.json";
const DEVELOPER_LAB_ANIMATION_CATALOG_GZIP = `${DEVELOPER_LAB_ANIMATION_CATALOG}.gz`;

const isGeneratedWebAssetManifestSidecar = (publicPath) =>
  /^\/assets\/manifest\.json\.(?:br|gz|zst)$/i.test(publicPath);
const isOutdoorWorldAsset = (publicPath) => publicPath.toLowerCase().startsWith(OUTDOOR_WORLD_PREFIX);

/**
 * List the public asset tree and assemble the canonical pack-group array for
 * buildAssetPacks(). Returns the individual listings alongside `groups` so the
 * pipeline's build summary can report per-family counts.
 *
 * @param {object} options
 * @param {string[]} options.uiImagePreloadPaths public paths of the native-UI preload images
 * @param {string[]} options.missionMinimapTilePaths public paths of the copied minimap tiles
 * @param {boolean} [options.includeOutdoorWorld] list /assets/world/outdoor (default true);
 *   the generic sweeps exclude the outdoor prefix regardless, so a skipped outdoor lane
 *   can never leak stale outdoor files into game-images/game-data
 * @param {string} [options.publicRoot] override of .generated/client-public (fixture trees in tests)
 */
export async function collectAssetPackGroups({
  uiImagePreloadPaths,
  missionMinimapTilePaths,
  includeOutdoorWorld = true,
  publicRoot
}) {
  const titleCrowdVat = await listPublicAssetFiles({
    publicRoot,
    roots: ["/assets/char/vat"],
    extensions: [".bin", ".json"]
  });
  const titleCrowdVatPaths = new Set(titleCrowdVat.map((publicPath) => publicPath.toLowerCase()));

  // Mission NPC VAT artifacts (buildNpcVatAssets): their own lazy group, kept out of
  // the generic json/data groups exactly like the title crowd VATs.
  const missionNpcVatAll = await listPublicAssetFiles({
    publicRoot,
    roots: ["/assets/npc/vat"],
    extensions: [".bin", ".json"]
  });
  // Every NPC VAT (including COS VATs owned by mission-cos-models) stays out of the json sweeps.
  const missionNpcVatPaths = new Set(missionNpcVatAll.map((publicPath) => publicPath.toLowerCase()));

  // Outdoor streaming world assets pack into their own manual-load group; sweeping
  // them into game-data/game-images breaks the generated-asset membership contract.
  const outdoorWorldAssets = includeOutdoorWorld
    ? await listPublicAssetFiles({
        publicRoot,
        roots: ["/assets/world/outdoor"],
        extensions: [".json", ".gz", ...IMAGE_ASSET_EXTENSIONS]
      })
    : [];
  const outdoorCompressedJson = outdoorWorldAssets.filter((publicPath) => publicPath.endsWith(".json.gz"));
  const outdoorCompressedJsonSourcePaths = new Set(
    outdoorCompressedJson.map((publicPath) => publicPath.slice(0, -".gz".length))
  );
  const outdoorRawJson = outdoorWorldAssets.filter(
    (publicPath) => publicPath.endsWith(".json") && !outdoorCompressedJsonSourcePaths.has(publicPath)
  );
  const outdoorImages = outdoorWorldAssets.filter(isImageAsset);

  const gameImages = (
    await listPublicAssetFiles({
      publicRoot,
      roots: ["/assets"],
      extensions: IMAGE_ASSET_EXTENSIONS,
      exclude: [...uiImagePreloadPaths, ...missionMinimapTilePaths]
    })
  ).filter((publicPath) => !isOutdoorWorldAsset(publicPath));

  const compressedJson = (
    await listPublicAssetFiles({
      publicRoot,
      roots: ["/assets"],
      extensions: [".gz"]
    })
  ).filter(
    (publicPath) =>
      publicPath.endsWith(".json.gz") &&
      !publicPath.toLowerCase().startsWith(TITLE_CROWD_VAT_PREFIX) &&
      !publicPath.toLowerCase().startsWith(MISSION_NPC_VAT_PREFIX) &&
      !isOutdoorWorldAsset(publicPath) &&
      publicPath.toLowerCase() !== DEVELOPER_LAB_ANIMATION_CATALOG_GZIP &&
      !isGeneratedWebAssetManifestSidecar(publicPath)
  );
  const compressedJsonSourcePaths = new Set(
    compressedJson.map((publicPath) => publicPath.slice(0, -".gz".length))
  );

  const rawJson = (
    await listPublicAssetFiles({
      publicRoot,
      roots: ["/assets"],
      extensions: [".json"]
    })
  ).filter(
    (publicPath) =>
      !compressedJsonSourcePaths.has(publicPath) &&
      !titleCrowdVatPaths.has(publicPath.toLowerCase()) &&
      !missionNpcVatPaths.has(publicPath.toLowerCase()) &&
      !isOutdoorWorldAsset(publicPath) &&
      publicPath.toLowerCase() !== DEVELOPER_LAB_ANIMATION_CATALOG &&
      // The web asset manifest regenerates with a fresh timestamp every build and must be
      // fetched loose anyway (it is how clients discover the packs); packing it forced one
      // game-data pack to rebuild + re-compress on every run.
      publicPath.toLowerCase() !== "/assets/manifest.json"
  );

  const animationData = await listPublicAssetFiles({
    publicRoot,
    roots: ["/assets/anim"],
    extensions: [".ban", ".bin"]
  });
  const nameFilterData = (await listPublicAssetFiles({publicRoot,roots:["/assets/textdata"],extensions:[".txt"]})).filter(publicPath=>publicPath.toLowerCase()==="/assets/textdata/abusefilter.txt");

  // Dev-only character labs consume this catalog on demand. Keep it out of
  // startup game-data so retail animation metadata has zero mission boot tax.
  const developerLabData = (
    await listPublicAssetFiles({
      publicRoot,
      roots: ["/assets/npc"],
      extensions: [".gz"]
    })
  ).filter((publicPath) => publicPath.toLowerCase() === DEVELOPER_LAB_ANIMATION_CATALOG_GZIP);

  const allModels = await listPublicAssetFiles({
    publicRoot,
    roots: ["/assets"],
    extensions: [".glb"]
  });

  // Equipment/cosmetic/hwan/COS models belong to their dedicated lazy groups,
  // which the focused publishers replace in place (assetPackOwnership.mjs).
  // They must never also land in game-models or mission-npc-vat.
  const dedicated = await collectDedicatedModelGroups(
    path.resolve(publicRoot ?? path.join(rebuildRoot, ".generated", "client-public")),
    new Set([...allModels, ...missionNpcVatAll].map((publicPath) => publicPath.toLowerCase()))
  );
  const gameModels = allModels.filter((publicPath) => !dedicated.claimed.has(publicPath.toLowerCase()));
  const missionNpcVat = missionNpcVatAll.filter((publicPath) => !dedicated.claimed.has(publicPath.toLowerCase()));

  const gameAudio = await listPublicAssetFiles({
    publicRoot,
    roots: ["/assets/audio"],
    extensions: [".mp3", ".wav"]
  });

  const groups = [
    { name: "native-ui", load: "startup", files: [...uiImagePreloadPaths] },
    { name: "game-images", load: "startup", files: gameImages },
    { name: "game-data", load: "startup", files: [...compressedJson, ...rawJson, ...animationData,...nameFilterData] },
    { name: "developer-labs", load: "manual", files: developerLabData },
    { name: "game-audio", load: "manual", files: gameAudio },
    { name: "title-crowd-vat", load: "lazy", targetBytes: VAT_PACK_TARGET_BYTES, files: titleCrowdVat },
    { name: "mission-npc-vat", load: "lazy", targetBytes: VAT_PACK_TARGET_BYTES, files: missionNpcVat },
    { name: "mission-minimap", load: "lazy", files: [...missionMinimapTilePaths] },
    { name: "game-models", load: "lazy", files: gameModels },
    ...dedicated.groups,
    {
      name: "outdoor-world",
      load: "manual",
      targetBytes: OUTDOOR_WORLD_PACK_TARGET_BYTES,
      files: [...outdoorCompressedJson, ...outdoorRawJson, ...outdoorImages]
    }
  ];

  return {
    groups,
    titleCrowdVat,
    missionNpcVat,
    outdoorCompressedJson,
    outdoorRawJson,
    outdoorImages,
    gameImages,
    compressedJson,
    rawJson,
    animationData,
    developerLabData,
    gameModels,
    dedicatedModelGroups: dedicated.groups,
    gameAudio
  };
}
