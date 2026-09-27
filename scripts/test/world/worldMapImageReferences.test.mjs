import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { imagePublicPath } from "../../build/shared/cifResources.mjs";
import {
  collectWorldMapImageReferences,
  collectWorldMapImageReferencesFromRows
} from "../../build/shared/worldMapImageReferences.mjs";
import { extractedRoot, publicRoot } from "../../build/shared/resourceIo.mjs";

test("world-map closure derives tile names and data-driven sprites", () => {
  const closure = collectWorldMapImageReferencesFromRows(
    ["0\t0\tWorld\tinterface\\worldmap\\map\\map_worldmap.ddj\t128\t128\t128\t128\t256\t128\t66\t113\t73\t110\t0\t0\t0\t0\txxx"],
    [
      "1\t1\tSN_LABEL\tTown\tShop\tLocal\t0\t1\t0\t0\t0\t0\t0\t0\t0\t0\t0\t0\t0\t1",
      "2\t2\tinterface\\worldmap\\map\\xy_gate.ddj\tTown\tGate\tLocal\t0\t1\t0\t0\t0\t0\t32\t32\t0\t0\t0\t0\t0\t1"
    ]
  );
  assert.deepEqual(closure.tileReferences, [
    "interface/worldmap/map/map_world_66x113.ddj",
    "interface/worldmap/map/map_world_70x113.ddj"
  ]);
  assert.deepEqual(closure.overlayReferences, ["interface/worldmap/map/xy_gate.ddj"]);
  assert.equal(closure.references.length, 4);
});

test("every shipped world-map dependency exists and is startup-resident in the compact pack index", async () => {
  const closure = await collectWorldMapImageReferences();
  assert.equal(closure.tileReferences.length, 224);
  assert.equal(closure.mapPageReferences.length, 7);
  assert.equal(closure.overlayReferences.length, 29);
  assert.equal(closure.references.length, 260);

  const sourceRoot = path.join(extractedRoot, "Media_extracted");
  for (const ddjPath of closure.references) {
    const source = path.join(sourceRoot, ...ddjPath.split("/"));
    assert.equal((await stat(source)).isFile(), true, `missing extracted source ${ddjPath}`);
  }

  const manifest = JSON.parse(
    await import("node:fs/promises").then(({ readFile }) =>
      readFile(path.join(publicRoot, "assets", "packs", "manifest.json"), "utf8")
    )
  );
  const startupGroups = new Set(
    manifest.groups.filter((group) => group.load === "startup").map((group) => group.name)
  );
  assert.ok(startupGroups.has("native-ui"));
  assert.ok(startupGroups.has("game-images"));
  const assets = new Map(manifest.assets.map((asset) => [asset.path.toLowerCase(), asset]));
  for (const ddjPath of closure.references) {
    const publicPath = imagePublicPath(ddjPath);
    const asset = assets.get(publicPath.toLowerCase());
    assert.ok(asset, `unpacked world-map image ${publicPath}`);
    assert.ok(
      startupGroups.has(asset.group),
      `world-map image ${publicPath} is not startup-resident (group=${asset.group})`
    );
  }
});
