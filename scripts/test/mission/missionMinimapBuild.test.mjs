import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMissionDungeonMinimapTileGrid,
  buildMissionMinimapTileGrid
} from "../../build/world/assets/copyMissionMinimapTileImages.mjs";

test("mission minimap selection uses retail region-byte sector math", () => {
  const asd2MovedRegionHalo = buildMissionMinimapTileGrid(25000, 1);
  assert.deepEqual(
    asd2MovedRegionHalo.map((tile) => tile.publicPath),
    [
      "/assets/images/Media_extracted/minimap/167x96.png",
      "/assets/images/Media_extracted/minimap/168x96.png",
      "/assets/images/Media_extracted/minimap/169x96.png",
      "/assets/images/Media_extracted/minimap/167x97.png",
      "/assets/images/Media_extracted/minimap/168x97.png",
      "/assets/images/Media_extracted/minimap/169x97.png",
      "/assets/images/Media_extracted/minimap/167x98.png",
      "/assets/images/Media_extracted/minimap/168x98.png",
      "/assets/images/Media_extracted/minimap/169x98.png"
    ]
  );
});

test("mission dungeon minimap selection uses retail 1920-grid dungeon sector math", () => {
  const donwhangFloor1 = buildMissionDungeonMinimapTileGrid(
    {
      directory: "donwhang",
      prefix: "dh_a01_floor01",
      tiles: [
        "127x126",
        "128x126",
        "129x126",
        "127x127",
        "128x127",
        "129x127",
        "127x128",
        "128x128",
        "129x128"
      ]
    },
    { x: 0, z: -1 },
    1
  );

  assert.deepEqual(
    donwhangFloor1.map((tile) => tile.publicPath),
    [
      "/assets/images/Media_extracted/minimap_d/donwhang/dh_a01_floor01_127x126.png",
      "/assets/images/Media_extracted/minimap_d/donwhang/dh_a01_floor01_128x126.png",
      "/assets/images/Media_extracted/minimap_d/donwhang/dh_a01_floor01_129x126.png",
      "/assets/images/Media_extracted/minimap_d/donwhang/dh_a01_floor01_127x127.png",
      "/assets/images/Media_extracted/minimap_d/donwhang/dh_a01_floor01_128x127.png",
      "/assets/images/Media_extracted/minimap_d/donwhang/dh_a01_floor01_129x127.png",
      "/assets/images/Media_extracted/minimap_d/donwhang/dh_a01_floor01_127x128.png",
      "/assets/images/Media_extracted/minimap_d/donwhang/dh_a01_floor01_128x128.png",
      "/assets/images/Media_extracted/minimap_d/donwhang/dh_a01_floor01_129x128.png"
    ]
  );
});

test("mission dungeon minimap holes stay blank instead of falling back to normal minimap", () => {
  const sparse = buildMissionDungeonMinimapTileGrid(
    {
      directory: "donwhang",
      prefix: "dh_a01_floor01",
      tiles: ["128x127"]
    },
    { x: 0, z: -1 },
    1
  );

  assert.equal(sparse.filter((tile) => tile.publicPath).length, 1);
  assert.equal(
    sparse.find((tile) => tile.publicPath)?.publicPath,
    "/assets/images/Media_extracted/minimap_d/donwhang/dh_a01_floor01_128x127.png"
  );
});
