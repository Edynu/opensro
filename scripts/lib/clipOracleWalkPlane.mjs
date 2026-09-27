// Region walkability plane + chord planner for the Q4 clip differential
// oracle (clip_oracle_sampler.mjs / clip_oracle_join.mjs).
//
// The plane loader / tile probe / supercover chord classifier are the shared
// mirror of the server's water.go buildBlockedGrids semantics used by both
// clip_oracle_sampler.mjs and moveops_guard_load.mjs (walkable = blocked byte
// 0 AND cell id < cell count). The pinned geometry anchors are the same two
// the harness and game/moveops clip_test.go / pathguard_test.go use.

import { readPublishedAssetJsonSync } from "./publishedAsset.mjs";

export const REGION_SIZE = 1920;

// The two pinned geometry anchors (game/moveops clip_test.go /
// pathguard_test.go real-payload tests; moveops_guard_load.mjs profiles).
export const RAIL_ANCHOR = { region: 0x61a7, x: 623, y: 3, z: 1271 };
/** The Jangan veranda east rail line the object plane clips at (x ~660.35). */
export const RAIL_CONTACT_X = 660.35;
export const DECK_ANCHOR = { region: 0x6850, x: 1263, y: -25, z: 1490 };

export function regionHex(regionId) {
  return "0x" + (regionId & 0xffff).toString(16).padStart(4, "0");
}

/** Region-local -> world XZ (region word: low byte X sector, high byte Z sector). */
export function worldOf(regionId, x, z) {
  return {
    x: ((regionId & 0xff) * REGION_SIZE) + x,
    z: (((regionId >> 8) & 0xff) * REGION_SIZE) + z
  };
}

/** World-frame XZ distance between two region-local points. */
export function worldDistance(regionA, xA, zA, regionB, xB, zB) {
  const a = worldOf(regionA, xA, zA);
  const b = worldOf(regionB, xB, zB);
  return Math.hypot(b.x - a.x, b.z - a.z);
}

const planeCache = new Map();

export function loadRegionPlane(regionId) {
  const key = regionId & 0xffff;
  if (planeCache.has(key)) return planeCache.get(key);
  const catalog = readPublishedAssetJsonSync("/assets/world/world-region-catalog.json");
  const hex = regionHex(key);
  const entries = catalog.regionsById[hex] ?? catalog.regionsById[hex.toUpperCase()] ?? [];
  if (entries.length === 0) throw new Error(`no catalog entry for region ${hex}`);
  const entry =
    entries.find((e) => String(e.seedRegionId).toLowerCase() === hex) ?? entries[0];
  const bundle = readPublishedAssetJsonSync(entry.bundlePublicPath);
  const nav = bundle.navmesh;
  const tilesPerAxis = Number(nav.tilesPerAxis);
  const tileSize = Number(nav.tileSize);
  const axisVertices = Number(nav.heightMapAxisVertices);
  const seedSector = entry.seedSector ?? { sectorX: entry.sectorX, sectorY: entry.sectorY };
  const dx = entry.sectorX - seedSector.sectorX;
  const dz = entry.sectorY - seedSector.sectorY;
  const navRegion = (nav.regions ?? []).find(
    (r) => Number(r.dx) === dx && Number(r.dz) === dz
  );
  if (!navRegion) throw new Error(`no navmesh entry at offset ${dx},${dz} for ${hex}`);
  const blocked = Buffer.from(navRegion.blockedTiles, "base64");
  const cellIds = Buffer.from(navRegion.tileCellIds, "base64");
  const heights = Buffer.from(navRegion.heightMap, "base64");
  const cellCount = Number(navRegion.cells?.count ?? 0);
  const plane = { regionId: key, tilesPerAxis, tileSize, axisVertices, blocked, cellIds, heights, cellCount };
  planeCache.set(key, plane);
  return plane;
}

export function tileWalkable(plane, tileX, tileZ) {
  if (tileX < 0 || tileZ < 0 || tileX >= plane.tilesPerAxis || tileZ >= plane.tilesPerAxis) {
    return { walkable: false, known: false };
  }
  const index = tileZ * plane.tilesPerAxis + tileX;
  const open =
    plane.blocked[index] === 0 && plane.cellIds.readUInt32LE(index * 4) < plane.cellCount;
  return { walkable: open, known: true };
}

export function pointWalkable(plane, x, z) {
  return tileWalkable(plane, Math.floor(x / plane.tileSize), Math.floor(z / plane.tileSize));
}

export function terrainHeightAt(plane, x, z) {
  const step = REGION_SIZE / (plane.axisVertices - 1);
  const fx = x / step;
  const fz = z / step;
  const maxCell = plane.axisVertices - 2;
  const ix = Math.min(Math.max(Math.floor(fx), 0), maxCell);
  const iz = Math.min(Math.max(Math.floor(fz), 0), maxCell);
  const tx = Math.min(Math.max(fx - ix, 0), 1);
  const tz = Math.min(Math.max(fz - iz, 0), 1);
  const w = plane.axisVertices;
  const h = (vz, vx) => plane.heights.readFloatLE((vz * w + vx) * 4);
  return (
    h(iz, ix) * (1 - tx) * (1 - tz) +
    h(iz, ix + 1) * tx * (1 - tz) +
    h(iz + 1, ix) * (1 - tx) * tz +
    h(iz + 1, ix + 1) * tx * tz
  );
}

/**
 * Supercover DDA over the region-local tile grid, endpoints INCLUDED - the
 * planner's mirror of the server's walkChord/clipChord classification
 * (terrain plane only; object decks/rails are the server's own override).
 */
export function classifyChord(plane, x0, z0, x1, z1) {
  const ts = plane.tileSize;
  const startTile = { x: Math.floor(x0 / ts), z: Math.floor(z0 / ts) };
  const endTile = { x: Math.floor(x1 / ts), z: Math.floor(z1 / ts) };
  const result = {
    inRegion: true,
    startBlocked: false,
    endpointBlocked: false,
    interiorBlocked: 0,
    firstBlockedT: Infinity
  };
  const probe = (tile, t, kind) => {
    const { walkable, known } = tileWalkable(plane, tile.x, tile.z);
    if (!known) {
      result.inRegion = false;
      return;
    }
    if (walkable) return;
    if (kind === "start") result.startBlocked = true;
    else if (kind === "end") result.endpointBlocked = true;
    else {
      result.interiorBlocked += 1;
      if (t < result.firstBlockedT) result.firstBlockedT = t;
    }
  };
  probe(endTile, 1, "end");
  if (startTile.x !== endTile.x || startTile.z !== endTile.z) probe(startTile, 0, "start");

  const fx0 = x0 / ts;
  const fz0 = z0 / ts;
  const dx = x1 / ts - fx0;
  const dz = z1 / ts - fz0;
  let tile = { ...startTile };
  let stepX = 0;
  let stepZ = 0;
  let tMaxX = Infinity;
  let tMaxZ = Infinity;
  let tDeltaX = Infinity;
  let tDeltaZ = Infinity;
  if (dx > 0) {
    stepX = 1;
    tMaxX = (tile.x + 1 - fx0) / dx;
    tDeltaX = 1 / dx;
  } else if (dx < 0) {
    stepX = -1;
    tMaxX = (fx0 - tile.x) / -dx;
    tDeltaX = 1 / -dx;
  }
  if (dz > 0) {
    stepZ = 1;
    tMaxZ = (tile.z + 1 - fz0) / dz;
    tDeltaZ = 1 / dz;
  } else if (dz < 0) {
    stepZ = -1;
    tMaxZ = (fz0 - tile.z) / -dz;
    tDeltaZ = 1 / -dz;
  }
  for (let steps = 0; steps < 4096; steps++) {
    if (tile.x === endTile.x && tile.z === endTile.z) break;
    if (tMaxX > 1 && tMaxZ > 1) break;
    const entryT = Math.min(Math.min(tMaxX, tMaxZ), 1);
    if (Math.abs(tMaxX - tMaxZ) < 1e-9 && stepX !== 0 && stepZ !== 0) {
      const corner = { x: tile.x + stepX, z: tile.z };
      if (
        !(corner.x === endTile.x && corner.z === endTile.z) &&
        !(corner.x === startTile.x && corner.z === startTile.z)
      ) {
        probe(corner, entryT, "interior");
      }
      tile = { x: tile.x + stepX, z: tile.z + stepZ };
      tMaxX += tDeltaX;
      tMaxZ += tDeltaZ;
    } else if (tMaxX < tMaxZ) {
      tile = { x: tile.x + stepX, z: tile.z };
      tMaxX += tDeltaX;
    } else {
      tile = { x: tile.x, z: tile.z + stepZ };
      tMaxZ += tDeltaZ;
    }
    if (
      (tile.x === endTile.x && tile.z === endTile.z) ||
      (tile.x === startTile.x && tile.z === startTile.z)
    ) {
      continue;
    }
    probe(tile, entryT, "interior");
  }
  return result;
}

// ---------------------------------------------------------------------------
// Oracle target planners. Every planner returns UNIQUE i16 destinations (the
// wire truncates to i16, and the join key is char + toRegion/toX/toZ - a
// repeated destination is an ambiguous pair the join must exclude, so the
// planner never produces one).
// ---------------------------------------------------------------------------

/** Deterministic LCG so a re-run with the same seed replays the same targets. */
export function makeLcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function i16Key(x, z) {
  return `${Math.trunc(x)},${Math.trunc(z)}`;
}

/**
 * Rail profile (object class): home at the pinned veranda anchor, targets
 * beyond the east rail line, jittered along/through it so every wire i16
 * pair is unique. Endpoint stays terrain-walkable (a B-chord; pathguard
 * enforce refuses only endpoint-blocked category A).
 */
export function planRailTargets(count, rng) {
  const plane = loadRegionPlane(RAIL_ANCHOR.region);
  const used = new Set([i16Key(RAIL_ANCHOR.x, RAIL_ANCHOR.z)]);
  const targets = [];
  let guard = 0;
  while (targets.length < count && guard++ < count * 200) {
    const x = 672 + rng() * 26;           // 672..698, all beyond the rail at ~660.35
    const z = 1252 + rng() * 38;          // 1252..1290, along the veranda span
    const key = i16Key(x, z);
    if (used.has(key)) continue;
    const endpoint = pointWalkable(plane, x, z);
    if (!endpoint.known || !endpoint.walkable) continue;
    used.add(key);
    targets.push({
      region: RAIL_ANCHOR.region,
      x: Math.trunc(x),
      y: RAIL_ANCHOR.y,
      z: Math.trunc(z),
      plannedClass: "object(rail)"
    });
  }
  if (targets.length < count) {
    throw new Error(`rail planner exhausted at ${targets.length}/${count} unique walkable targets`);
  }
  return { home: { ...RAIL_ANCHOR, region: RAIL_ANCHOR.region }, targets };
}

/**
 * Deck profile (object class): home at the pinned Constantinople
 * harbor-bridge deck anchor, targets past the three deck contact rays the
 * 2026-07-29 guard-load run pinned (contacts z~1519.75 north, x~1254.96
 * west, x~1278.20 east), jittered so every wire i16 pair is unique. The
 * whole 3,010-move deck load ran with pathguard endpointBlocked=0, so these
 * endpoints are enforce-safe.
 */
export function planDeckTargets(count, rng) {
  const used = new Set([i16Key(DECK_ANCHOR.x, DECK_ANCHOR.z)]);
  const targets = [];
  const rays = [
    () => ({ x: 1256 + rng() * 14, z: 1522 + rng() * 14 }),   // north, beyond z~1519.75
    () => ({ x: 1226 + rng() * 14, z: 1484 + rng() * 12 }),   // west, beyond x~1254.96
    () => ({ x: 1286 + rng() * 14, z: 1484 + rng() * 12 })    // east, beyond x~1278.20
  ];
  let guard = 0;
  while (targets.length < count && guard++ < count * 200) {
    const ray = rays[targets.length % rays.length]();
    const key = i16Key(ray.x, ray.z);
    if (used.has(key)) continue;
    used.add(key);
    targets.push({
      region: DECK_ANCHOR.region,
      x: Math.trunc(ray.x),
      y: DECK_ANCHOR.y,
      z: Math.trunc(ray.z),
      plannedClass: "object(deck)"
    });
  }
  if (targets.length < count) {
    throw new Error(`deck planner exhausted at ${targets.length}/${count} unique targets`);
  }
  return { home: { ...DECK_ANCHOR, region: DECK_ANCHOR.region }, targets };
}

/** Minimum distance from a walls home to the first blocked tile of a chord. */
const WALL_STANDOFF_UNITS = 15;

/**
 * Walls profile (terrain class): search around the given start point for a
 * walkable home with genuine wall chords (endpoint walkable, interior
 * crossing blocked tiles, wall at a standoff), then jitter each base chord
 * so every wire i16 pair is unique and still classifies as a B-chord.
 */
export function planWallTargets(regionId, startX, startZ, count, rng) {
  const plane = loadRegionPlane(regionId);
  const baseAngles = [];
  let home = null;

  const findBaseTargets = (hx, hz) => {
    const found = [];
    const homeHeight = terrainHeightAt(plane, hx, hz);
    for (let angleDeg = 0; angleDeg < 360; angleDeg += 5) {
      for (const dist of [45, 60, 80, 105, 130]) {
        const rad = (angleDeg * Math.PI) / 180;
        const tx = hx + Math.cos(rad) * dist;
        const tz = hz + Math.sin(rad) * dist;
        if (tx < 40 || tz < 40 || tx > REGION_SIZE - 40 || tz > REGION_SIZE - 40) continue;
        const endpoint = pointWalkable(plane, tx, tz);
        if (!endpoint.known || !endpoint.walkable) continue;
        // A far-below-grade endpoint is likely a riverbed/harbor floor the
        // deep-water gate refuses BEFORE the guard - no telemetry, skip.
        if (Math.abs(terrainHeightAt(plane, tx, tz) - homeHeight) > 8) continue;
        const chord = classifyChord(plane, hx, hz, tx, tz);
        if (!chord.inRegion || chord.startBlocked || chord.endpointBlocked) continue;
        if (chord.interiorBlocked === 0) continue;
        if (chord.firstBlockedT * dist < WALL_STANDOFF_UNITS) continue;
        found.push({ angleDeg, dist, x: tx, z: tz });
        break;
      }
    }
    return found;
  };

  for (let radius = 0; radius <= 480 && baseAngles.length < 12; radius += 60) {
    for (let angleDeg = 0; angleDeg < 360; angleDeg += 30) {
      const rad = (angleDeg * Math.PI) / 180;
      const hx = startX + Math.cos(rad) * radius;
      const hz = startZ + Math.sin(rad) * radius;
      if (hx < 60 || hz < 60 || hx > REGION_SIZE - 60 || hz > REGION_SIZE - 60) continue;
      const spot = pointWalkable(plane, hx, hz);
      if (!spot.known || !spot.walkable) continue;
      const found = findBaseTargets(hx, hz);
      if (found.length > baseAngles.length) {
        baseAngles.length = 0;
        baseAngles.push(...found);
        home = { region: regionId, x: hx, y: terrainHeightAt(plane, hx, hz), z: hz };
      }
      if (baseAngles.length >= 12) break;
      if (radius === 0) break;
    }
  }
  if (!home || baseAngles.length === 0) {
    throw new Error(
      `no wall chords found within 480u of (${startX.toFixed(0)},${startZ.toFixed(0)}) in ${regionHex(regionId)}`
    );
  }

  const used = new Set([i16Key(home.x, home.z)]);
  const targets = [];
  let guard = 0;
  while (targets.length < count && guard++ < count * 400) {
    const base = baseAngles[targets.length % baseAngles.length];
    const tx = base.x + (rng() * 2 - 1) * 4;
    const tz = base.z + (rng() * 2 - 1) * 4;
    const key = i16Key(tx, tz);
    if (used.has(key)) continue;
    if (tx < 40 || tz < 40 || tx > REGION_SIZE - 40 || tz > REGION_SIZE - 40) continue;
    const endpoint = pointWalkable(plane, tx, tz);
    if (!endpoint.known || !endpoint.walkable) continue;
    const chord = classifyChord(plane, home.x, home.z, tx, tz);
    if (!chord.inRegion || chord.startBlocked || chord.endpointBlocked) continue;
    if (chord.interiorBlocked === 0) continue;
    const dist = Math.hypot(tx - home.x, tz - home.z);
    if (chord.firstBlockedT * dist < WALL_STANDOFF_UNITS) continue;
    used.add(key);
    targets.push({
      region: regionId,
      x: Math.trunc(tx),
      y: terrainHeightAt(plane, tx, tz),
      z: Math.trunc(tz),
      plannedClass: `terrain(wall interior=${chord.interiorBlocked})`
    });
  }
  if (targets.length < count) {
    throw new Error(`walls planner exhausted at ${targets.length}/${count} unique B-chord targets`);
  }
  return { home, targets };
}
