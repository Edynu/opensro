import assert from "node:assert/strict";
import test from "node:test";
import { readPublishedAssetJson } from "../../lib/publishedAsset.mjs";

async function readJson(relativePath) {
  return readPublishedAssetJson(`/assets/world/${relativePath}`);
}

test("Manyang Lab is one ordinary catalogued region with matched visual and movement authority", async () => {
  const [areas, catalog, index, bundle] = await Promise.all([
    readJson("authored-areas.json"),
    readJson("world-region-catalog.json"),
    readJson("manyang-lab/world-regions-7e7e.json"),
    readJson("manyang-lab/region-7e7e.json")
  ]);
  assert.equal(areas.format, "sro-authored-world-area-catalog");
  assert.equal(areas.areas.length, 1);
  const area = areas.areas[0];
  assert.deepEqual(
    { slug: area.slug, regionId: area.regionId, access: area.access },
    { slug: "manyang-lab", regionId: 0x7e7e, access: "gm" }
  );
  assert.deepEqual(area.population.map((row) => row.codename), ["MOB_CH_MANGNYANG"]);

  assert.deepEqual(catalog.regionsById["0x7e7e"], [{
    id: "0x7e7e",
    area: "manyang-lab",
    seedRegionId: "0x7e7e",
    seedSector: { sectorX: 126, sectorY: 126 },
    sectorX: 126,
    sectorY: 126,
    worldRegionsPublicPath: "/assets/world/manyang-lab/world-regions-7e7e.json",
    bundlePublicPath: "/assets/world/manyang-lab/region-7e7e.json",
    source: "authored-area-manyang-lab"
  }]);
  assert.equal(index.regions.length, 1);
  assert.equal(index.regions[0].bundlePublicPath, area.bundlePublicPath);
  assert.deepEqual(bundle.authoredArea.population, area.population);
  assert.equal(
    bundle.sharedRenderResourcesPublicPath,
    "/assets/world/outdoor/shared-render-resources.json",
    "an authored outdoor region must inherit the ordinary mission environment/light contract"
  );

  const primitives = Object.fromEntries(bundle.authoredArea.primitives.map((primitive) => [primitive.shape, primitive]));
  assert.deepEqual(primitives.ground.size, { x: 400, y: 0, z: 400 });
  assert.equal(primitives.box.cameraCollision, true);
  assert.deepEqual(bundle.navmesh.blockers, [{
    cx: 960, cz: 1140, hx: 200, hz: 10, yaw: 0, objectId: 0
  }]);

  const blocked = Buffer.from(bundle.navmesh.regions[0].blockedTiles, "base64");
  const tile = (x, z) => blocked[z * 96 + x];
  assert.equal(tile(45, 46), 0, "the server-owned player entry is walkable");
  assert.equal(tile(51, 49), 0, "the server-owned Mangyang anchor is walkable");
  assert.equal(tile(48, 56), 1, "the visual wall footprint is movement-blocked");
  assert.equal(tile(37, 48), 1, "the checker room boundary is movement-blocked");
});
