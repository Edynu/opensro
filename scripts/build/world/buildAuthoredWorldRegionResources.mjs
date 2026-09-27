import path from "node:path";
import { refreshPrecompressedSidecars } from "../generatedManifestSidecars.mjs";
import { writeJson } from "./io.mjs";
import { publicRoot, normalizeRegionId } from "./paths.mjs";
import { buildWorldRegionIndex } from "./buildWorldRegionIndex.mjs";
import { OUTDOOR_WORLD_SHARED_RENDER_PUBLIC_PATH } from "./constants.mjs";

const REGION_SIZE = 1920;
const TILE_SIZE = 20;
const TILES_PER_AXIS = REGION_SIZE / TILE_SIZE;
const HEIGHT_AXIS = TILES_PER_AXIS + 1;

export const MANYANG_LAB_REGION_ID = 0x7e7e;
export const AUTHORED_WORLD_AREA_CATALOG_PUBLIC_PATH = "/assets/world/authored-areas.json";

function base64Uint8(values) {
  return Buffer.from(Uint8Array.from(values).buffer).toString("base64");
}

function base64Uint16(values) {
  const array = Uint16Array.from(values);
  return Buffer.from(array.buffer, array.byteOffset, array.byteLength).toString("base64");
}

function base64Uint32(values) {
  const array = Uint32Array.from(values);
  return Buffer.from(array.buffer, array.byteOffset, array.byteLength).toString("base64");
}

function base64Float32(values) {
  const array = Float32Array.from(values);
  return Buffer.from(array.buffer, array.byteOffset, array.byteLength).toString("base64");
}

function buildManyangLabNavmesh() {
  const tileCount = TILES_PER_AXIS * TILES_PER_AXIS;
  const blocked = new Uint8Array(tileCount).fill(1);
  const tileFlags = new Uint16Array(tileCount).fill(1);
  const tileCellIds = new Uint32Array(tileCount);
  const tileTextureIds = new Uint16Array(tileCount);

  // The authored checker room occupies [760,1160] in both axes. The north
  // two tile rows are the height wall: visual geometry and movement authority
  // therefore share the same footprint.
  for (let z = 38; z <= 57; z += 1) {
    for (let x = 38; x <= 57; x += 1) {
      const index = z * TILES_PER_AXIS + x;
      const wall = z >= 56;
      blocked[index] = wall ? 1 : 0;
      tileFlags[index] = wall ? 1 : 0;
    }
  }

  return {
    format: "sro-region-navmesh",
    version: 2,
    tileSize: TILE_SIZE,
    tilesPerAxis: TILES_PER_AXIS,
    heightMapAxisVertices: HEIGHT_AXIS,
    regionSize: REGION_SIZE,
    sourceSectorX: MANYANG_LAB_REGION_ID & 0xff,
    sourceSectorY: MANYANG_LAB_REGION_ID >>> 8,
    parsedRegions: 1,
    regionCount: 1,
    blockerCount: 1,
    regions: [
      {
        dx: 0,
        dz: 0,
        regionId: MANYANG_LAB_REGION_ID,
        blockedTiles: base64Uint8(blocked),
        heightMap: base64Float32(new Array(HEIGHT_AXIS * HEIGHT_AXIS).fill(0)),
        objects: [],
        cells: {
          count: 1,
          minX: base64Float32([760]),
          minZ: base64Float32([760]),
          maxX: base64Float32([1160]),
          maxZ: base64Float32([1160]),
          objectIndexOffsets: base64Uint32([0, 0]),
          objectIndices: base64Uint16([])
        },
        tileCellIds: base64Uint32(tileCellIds),
        tileFlags: base64Uint16(tileFlags),
        tileTextureIds: base64Uint16(tileTextureIds),
        planeType: base64Uint8(new Array(36).fill(0)),
        planeHeight: base64Float32(new Array(36).fill(0))
      }
    ],
    blockers: [
      { cx: 960, cz: 1140, hx: 200, hz: 10, yaw: 0, objectId: 0 }
    ]
  };
}

function buildManyangLabBundle() {
  const sectorX = MANYANG_LAB_REGION_ID & 0xff;
  const sectorY = MANYANG_LAB_REGION_ID >>> 8;
  const sectorId = normalizeRegionId(MANYANG_LAB_REGION_ID);
  const terrainSector = {
    sectorId,
    sectorX,
    sectorY,
    sourcePath: "authored/manyang-lab/flat.m",
    signature: "JMXVMAPM1000",
    byteLength: 0,
    consumedBytes: 0,
    blockGrid: { width: 6, height: 6 },
    blockSizeBytes: 0,
    verticesPerBlockAxis: 17,
    tilesPerBlockAxis: 16,
    blockCount: 0,
    blocks: []
  };
  const authoredArea = {
    slug: "manyang-lab",
    regionId: MANYANG_LAB_REGION_ID,
    access: "gm",
    entry: { x: 900, y: 0, z: 920, angle: 16384 },
    population: [
      {
        codename: "MOB_CH_MANGNYANG",
        x: 1020,
        y: 0,
        z: 980,
        maxCount: 1,
        respawnDelayMinSec: 5,
        respawnDelayMaxSec: 5,
        respawn: true,
        aggressive: false,
        sightRange: 0,
        leashRadius: 140,
        generateRadius: 0
      }
    ],
    primitives: [
      {
        id: "manyang-lab-checker-floor",
        regionId: MANYANG_LAB_REGION_ID,
        shape: "ground",
        position: { x: 960, y: 0, z: 960 },
        size: { x: 400, y: 0, z: 400 },
        material: {
          kind: "checker",
          squareSize: 10,
          colors: ["#3c4048", "#2a2d33"],
          axisColors: { x: "#c84444", z: "#4477cc" }
        }
      },
      {
        id: "manyang-lab-height-wall",
        regionId: MANYANG_LAB_REGION_ID,
        shape: "box",
        position: { x: 960, y: 25, z: 1140 },
        size: { x: 400, y: 50, z: 20 },
        material: { kind: "solid", color: "#343842" },
        cameraCollision: true
      }
    ]
  };

  return {
    format: "sro-world-region-bundle",
    version: 1,
    source: {
      area: "manyang-lab",
      sectorId,
      sectorX,
      sectorY,
      terrain: terrainSector.sourcePath,
      objects2: "authored/manyang-lab/empty.o2",
      objectInfo: "authored/manyang-lab/empty.ifo",
      reconstructionSources: ["resource-authored-area:manyang-lab"]
    },
    terrain: {
      signature: "JMXVMAPM1000",
      byteLength: 0,
      consumedBytes: 0,
      blockGrid: terrainSector.blockGrid,
      blockSizeBytes: 0,
      verticesPerBlockAxis: terrainSector.verticesPerBlockAxis,
      tilesPerBlockAxis: terrainSector.tilesPerBlockAxis,
      blockCount: 0,
      blocks: [],
      sectorCount: 1,
      sectors: [terrainSector]
    },
    objects: {
      signature: "JMXVMAPO1001",
      placementCount: 0,
      uniqueObjectCount: 0,
      uniqueObjectIds: [],
      sectors: []
    },
    // This is a real outdoor mission region, so it consumes the same shared
    // sky/environment/water presentation resources as every PK2-backed
    // outdoor region. Omitting this reference leaves the scene without an
    // environment controller: native object lighting then falls back to
    // white ambient, and MODULATE2X visibly clips actors to full white.
    sharedRenderResourcesPublicPath: OUTDOOR_WORLD_SHARED_RENDER_PUBLIC_PATH,
    navmesh: buildManyangLabNavmesh(),
    authoredArea
  };
}

export async function buildAuthoredWorldRegionResources() {
  const bundle = buildManyangLabBundle();
  const bundlePublicPath = "/assets/world/manyang-lab/region-7e7e.json";
  const bundleOutputPath = path.join(publicRoot, bundlePublicPath.replace(/^\/+/, ""));
  await writeJson(bundleOutputPath, bundle);
  const regionIndex = await buildWorldRegionIndex(bundle, bundlePublicPath);
  const catalog = {
    format: "sro-authored-world-area-catalog",
    version: 1,
    areas: [
      {
        ...bundle.authoredArea,
        primitives: undefined,
        worldRegionsPublicPath: regionIndex.publicPath,
        bundlePublicPath
      }
    ]
  };
  const catalogOutputPath = path.join(
    publicRoot,
    AUTHORED_WORLD_AREA_CATALOG_PUBLIC_PATH.replace(/^\/+/, "")
  );
  await writeJson(catalogOutputPath, catalog);
  await refreshPrecompressedSidecars(
    [bundleOutputPath, regionIndex.outputPath, catalogOutputPath],
    { onlyWhenStale: true }
  );

  return {
    bundle,
    outputPath: bundleOutputPath,
    regionBundlePublicPath: bundlePublicPath,
    worldRegionsPublicPath: regionIndex.publicPath,
    seedRegionId: regionIndex.seedRegionId,
    regionCount: regionIndex.regionCount,
    regionIndexDescriptor: regionIndex.descriptor,
    sourceName: "authored-area-manyang-lab"
  };
}
