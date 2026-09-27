import { readFile } from "node:fs/promises";
import path from "node:path";
import { typedArrayToBase64 } from "../../shared/binaryUtils.mjs";
import { exists } from "../io.mjs";
import {
  NAVMESH_HEIGHT_AXIS_VERTICES,
  NAVMESH_REGION_SIZE,
  NAVMESH_TILES_PER_AXIS,
  NAVMESH_TILE_SIZE,
  parseNavmesh
} from "./parseNavmesh.mjs";

// Object collision footprints are derived from render-mesh bounds. The native navmesh
// stamps each object's precise collision mesh (walls only, not roof/interior), which the
// render bounding box cannot represent for large hollow structures: a building's bbox
// covers its walkable courtyard/streets and would wrongly block native waypoints there
// (verified: harbor port01 bbox spans 8 of the 19 crowd waypoints). So we bound blockers
// to free-standing plaza obstacles (the fountain euro_esteuro_fountain01 is 106x140,
// lampposts/trees/boxes are smaller) and exclude buildings (>=175), whose collision NPCs
// already route around via the native waypoint table.
const FOOTPRINT_SHRINK = 0.9;
// Skip objects with a negligible footprint (decorative props with no meaningful collision).
const MIN_FOOTPRINT_HALF_EXTENT = 8;
// Skip objects whose footprint is too large to be a plaza obstacle (buildings/walls): their
// render bbox is not a valid collision footprint without the object collision mesh.
const MAX_FOOTPRINT_HALF_EXTENT = 160;

/**
 * @typedef {{ min: ArrayLike<number>, max: ArrayLike<number> }} CollisionBounds
 * @typedef {{ sourcePath: string, bounds?: CollisionBounds }} CollisionMesh
 * @typedef {{ objectId: number, renderMeshSection?: { paths?: string[] }, meshPaths?: string[] }} CollisionBsr
 * @typedef {{ cx0: number, cz0: number, hx: number, hz: number }} CollisionFootprint
 * @typedef {{ meshes: CollisionMesh[], bsr: CollisionBsr[] }} CollisionObjectResources
 */

/**
 * Build base-frame navmesh data (relative to the bundle's source sector) for the crowd:
 *   - per-region blocked-tile bitmaps (96x96, 20-unit tiles) = non-walkable terrain.
 *   - object-collision OBB blockers (the fountain, statues, building footprints, ...).
 *
 * @param {object} options
 * @param {string} options.extractedRoot  extracted/ root.
 * @param {number} options.sourceSectorX  bundle source sector X (base-frame origin).
 * @param {number} options.sourceSectorY  bundle source sector Y.
 * @param {{sectorX:number, sectorY:number}[]} options.coverageSectors sectors to load.
 * @param {CollisionObjectResources} options.objectResources bundle object resources (bsr[] + meshes[]).
 */
export async function buildRegionNavmeshData(options) {
  const { extractedRoot, sourceSectorX, sourceSectorY, coverageSectors, objectResources } = options;

  const meshByPath = new Map(objectResources.meshes.map((mesh) => [mesh.sourcePath, mesh]));
  const bsrByObjectId = new Map(objectResources.bsr.map((bsr) => [bsr.objectId, bsr]));
  const footprintCache = new Map();

  const regions = [];
  const blockers = [];
  const seenBlocker = new Set();
  let parsedRegions = 0;

  for (const sector of coverageSectors) {
    const regionId = (sector.sectorY << 8) | sector.sectorX;
    const nvmPath = path.join(
      extractedRoot,
      "Data_extracted",
      "navmesh",
      `nv_${regionId.toString(16).padStart(4, "0")}.nvm`
    );
    if (!(await exists(nvmPath))) {
      continue;
    }

    let navmesh;
    try {
      navmesh = parseNavmesh(await readFile(nvmPath));
    } catch (error) {
      console.warn(`[navmesh] failed to parse ${nvmPath}: ${error.message}`);
      continue;
    }
    parsedRegions += 1;

    const dx = sector.sectorX - sourceSectorX;
    const dz = sector.sectorY - sourceSectorY;
    regions.push({
      dx,
      dz,
      regionId,
      blockedTiles: Buffer.from(navmesh.blockedTiles).toString("base64"),
      heightMap: typedArrayToBase64(navmesh.heightMap),
      objects: navmesh.objects,
      cells: encodeCells(navmesh.cells),
      tileCellIds: typedArrayToBase64(navmesh.tileCellIds),
      tileFlags: typedArrayToBase64(navmesh.tileFlags),
      tileTextureIds: typedArrayToBase64(navmesh.tileTextureIds),
      globalEdges: encodeEdgeBlock(navmesh.globalEdges),
      internalEdges: encodeEdgeBlock(navmesh.internalEdges),
      planeType: typedArrayToBase64(navmesh.planeType),
      planeHeight: typedArrayToBase64(navmesh.planeHeight)
    });

    // Base-frame offset for this region's local coordinates.
    const offsetX = dx * NAVMESH_REGION_SIZE;
    const offsetZ = dz * NAVMESH_REGION_SIZE;

    for (const object of navmesh.objects) {
      if (object.type !== -1) {
        continue; // only static objects carry collision footprints
      }
      const footprint = resolveFootprint(object.assetId, bsrByObjectId, meshByPath, footprintCache);
      if (!footprint) {
        continue;
      }

      // World (base-frame) center of the footprint = pivot + R(yaw) * localCenter.
      const cos = Math.cos(object.yaw);
      const sin = Math.sin(object.yaw);
      const cx = offsetX + object.x + (footprint.cx0 * cos - footprint.cz0 * sin);
      const cz = offsetZ + object.z + (footprint.cx0 * sin + footprint.cz0 * cos);

      // De-duplicate: an object owned by a neighbour is listed in several region files.
      const key = `${object.assetId}:${Math.round(cx)}:${Math.round(cz)}`;
      if (seenBlocker.has(key)) {
        continue;
      }
      seenBlocker.add(key);

      blockers.push({
        cx: round2(cx),
        cz: round2(cz),
        hx: round2(footprint.hx),
        hz: round2(footprint.hz),
        yaw: round2(object.yaw),
        objectId: object.assetId
      });
    }
  }

  return {
    format: "sro-region-navmesh",
    version: 2,
    tileSize: NAVMESH_TILE_SIZE,
    tilesPerAxis: NAVMESH_TILES_PER_AXIS,
    heightMapAxisVertices: NAVMESH_HEIGHT_AXIS_VERTICES,
    regionSize: NAVMESH_REGION_SIZE,
    sourceSectorX,
    sourceSectorY,
    parsedRegions,
    regionCount: regions.length,
    blockerCount: blockers.length,
    regions,
    blockers
  };
}

function encodeCells(cells) {
  const minX = new Float32Array(cells.length);
  const minZ = new Float32Array(cells.length);
  const maxX = new Float32Array(cells.length);
  const maxZ = new Float32Array(cells.length);
  const objectIndexOffsets = new Uint32Array(cells.length + 1);
  let objectIndexCount = 0;

  for (let i = 0; i < cells.length; i += 1) {
    const cell = cells[i];
    minX[i] = cell.minX;
    minZ[i] = cell.minZ;
    maxX[i] = cell.maxX;
    maxZ[i] = cell.maxZ;
    objectIndexCount += cell.objectIndices.length;
    objectIndexOffsets[i + 1] = objectIndexCount;
  }

  const objectIndices = new Uint16Array(objectIndexCount);
  let cursor = 0;
  for (const cell of cells) {
    for (const objectIndex of cell.objectIndices) {
      objectIndices[cursor] = objectIndex;
      cursor += 1;
    }
  }

  return {
    count: cells.length,
    minX: typedArrayToBase64(minX),
    minZ: typedArrayToBase64(minZ),
    maxX: typedArrayToBase64(maxX),
    maxZ: typedArrayToBase64(maxZ),
    objectIndexOffsets: typedArrayToBase64(objectIndexOffsets),
    objectIndices: typedArrayToBase64(objectIndices)
  };
}

function encodeEdgeBlock(edges) {
  const encoded = {
    count: edges.count,
    lines: typedArrayToBase64(edges.lines),
    flags: typedArrayToBase64(edges.flags),
    assocDirections: typedArrayToBase64(edges.assocDirections),
    assocCells: typedArrayToBase64(edges.assocCells)
  };
  if (edges.assocRegions) {
    encoded.assocRegions = typedArrayToBase64(edges.assocRegions);
  }
  return encoded;
}

/**
 * @param {number} objectId
 * @param {Map<number, CollisionBsr>} bsrByObjectId
 * @param {Map<string, CollisionMesh>} meshByPath
 * @param {Map<number, CollisionFootprint | null>} cache
 * @returns {CollisionFootprint | null}
 */
function resolveFootprint(objectId, bsrByObjectId, meshByPath, cache) {
  if (cache.has(objectId)) {
    return cache.get(objectId) ?? null;
  }

  const bsr = bsrByObjectId.get(objectId);
  /** @type {CollisionFootprint | null} */
  let footprint = null;
  if (bsr) {
    const meshPaths = bsr.renderMeshSection?.paths?.length ? bsr.renderMeshSection.paths : bsr.meshPaths;
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (const meshPath of meshPaths ?? []) {
      const mesh = meshByPath.get(meshPath);
      if (!mesh?.bounds) {
        continue;
      }
      const bmin = mesh.bounds.min;
      const bmax = mesh.bounds.max;
      minX = Math.min(minX, bmin[0], bmax[0]);
      maxX = Math.max(maxX, bmin[0], bmax[0]);
      minZ = Math.min(minZ, bmin[2], bmax[2]);
      maxZ = Math.max(maxZ, bmin[2], bmax[2]);
    }
    if (Number.isFinite(minX)) {
      const hx = ((maxX - minX) * 0.5) * FOOTPRINT_SHRINK;
      const hz = ((maxZ - minZ) * 0.5) * FOOTPRINT_SHRINK;
      const maxHalf = Math.max(hx, hz);
      if (maxHalf >= MIN_FOOTPRINT_HALF_EXTENT && maxHalf <= MAX_FOOTPRINT_HALF_EXTENT) {
        footprint = { cx0: (minX + maxX) * 0.5, cz0: (minZ + maxZ) * 0.5, hx, hz };
      }
    }
  }

  cache.set(objectId, footprint);
  return footprint;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}
