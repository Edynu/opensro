import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import {
  missionRebirthRuntimeImageReferences,
  partyMatchRowRuntimeImageReferences,
  runtimeCifButtonImageReferences,
  runtimeCifImageReferences,
  targetStatusRuntimeImageReferences,
  versionCheckLoadingRuntimeImageReferences
} from "../../build/shared/cifRuntimeImageCatalog.mjs";
import {
  normalizeAssetPath,
  publicRoot
} from "../../build/shared/resourceIo.mjs";
import {
  listPublishedAssetPathsSync,
  publishedAssetExistsSync,
  readPublishedAssetBytes,
  readPublishedAssetJson
} from "../../lib/publishedAsset.mjs";

const catalogPath = path.join(
  publicRoot,
  "assets",
  "cif",
  "cif-sprite-catalog.json"
);
test("shared CIF sprite catalog contains every authored layout resource", async () => {
  const catalog = await readCatalog();
  const layoutPaths = listPublishedAssetPathsSync("/assets/cif/layouts/")
    .filter((publicPath) => publicPath.endsWith(".json.gz") || publicPath.endsWith(".json"));

  for (const layoutPath of layoutPaths) {
    const logicalPath = layoutPath.replace(/\.gz$/i, "");
    const layoutName = path.posix.basename(logicalPath);
    const layout = await readPublishedAssetJson(logicalPath);
    for (const [ddjPath, resource] of Object.entries(layout.resourcesByDdjPath)) {
      assert.deepEqual(
        catalog.resourcesByDdjPath[ddjPath],
        resource,
        `${layoutName} resource ${ddjPath}`
      );
    }
  }
});

test("published runtime CIF sprites carry decoded dimensions in the catalog", async () => {
  const catalog = await readCatalog();

  for (const ddjPath of runtimeCifImageReferences) {
    const key = normalizeAssetPath(ddjPath);
    const pngPath = publicPngPath(key);

    if (!publishedAssetExistsSync(pngPath)) {
      continue;
    }
    const resource = catalog.resourcesByDdjPath[key];
    assert.ok(resource, `missing runtime resource ${key}`);

    const png = await readPublishedAssetBytes(pngPath);
    assert.equal(resource.width, png.readUInt32BE(16), `${key} width`);
    assert.equal(resource.height, png.readUInt32BE(20), `${key} height`);
  }
});

test("native target-status sprites are published and cataloged as one family", async () => {
  const catalog = await readCatalog();

  for (const ddjPath of targetStatusRuntimeImageReferences) {
    const key = normalizeAssetPath(ddjPath);
    const pngPath = publicPngPath(key);
    assert.ok(
      publishedAssetExistsSync(pngPath),
      `missing native-code-selected target sprite ${key}`
    );

    const resource = catalog.resourcesByDdjPath[key];
    assert.ok(resource, `missing target sprite catalog entry ${key}`);

    const png = await readPublishedAssetBytes(pngPath);
    assert.equal(resource.width, png.readUInt32BE(16), `${key} width`);
    assert.equal(resource.height, png.readUInt32BE(20), `${key} height`);
  }
});

test("native party and mentor row-bar states are published as one family", async () => {
  const catalog = await readCatalog();

  for (const ddjPath of partyMatchRowRuntimeImageReferences) {
    const key = normalizeAssetPath(ddjPath);
    const pngPath = publicPngPath(key);
    assert.ok(
      publishedAssetExistsSync(pngPath),
      `missing native-code-selected row-bar sprite ${key}`
    );
    assert.ok(catalog.resourcesByDdjPath[key], `missing row-bar catalog entry ${key}`);
  }
});

test("native death and rebirth images are published as one complete family", async () => {
  const expected = [
    ...missionRebirthRuntimeImageReferences,
    "interface/messagebox/msgbox_rebirth_button.ddj",
    "interface/messagebox/msgbox_rebirth_button_focus.ddj",
    "interface/messagebox/msgbox_rebirth_button_press.ddj"
  ];

  assert.ok(
    runtimeCifButtonImageReferences.includes("interface/messagebox/msgbox_rebirth_button.ddj"),
    "rebirth button must use the button-state publication pass"
  );
  for (const ddjPath of expected) {
    assert.ok(
      publishedAssetExistsSync(publicPngPath(normalizeAssetPath(ddjPath))),
      `missing native death/rebirth sprite ${ddjPath}`
    );
  }
});

test("version-check startup and character-create gender families are complete", async () => {
  assert.equal(versionCheckLoadingRuntimeImageReferences.length, 10);
  for (const ddjPath of versionCheckLoadingRuntimeImageReferences) {
    assert.ok(
      publishedAssetExistsSync(publicPngPath(normalizeAssetPath(ddjPath))),
      `missing pre-pack version-check image ${ddjPath}`
    );
  }

  for (const stem of ["man_on", "man_off", "woman_on", "woman_off"]) {
    const normalPath = `interface/outer/${stem}.ddj`;
    assert.ok(
      runtimeCifButtonImageReferences.includes(normalPath),
      `${normalPath} must use the button-state publication pass`
    );
    for (const suffix of ["", "_focus", "_press"]) {
      assert.ok(
        publishedAssetExistsSync(publicPngPath(`interface/outer/${stem}${suffix}.ddj`)),
        `missing character-create gender state ${stem}${suffix}`
      );
    }
  }
});

function readCatalog() {
  return readPublishedAssetJson(catalogPath);
}

function publicPngPath(ddjPath) {
  return `/assets/images/Media_extracted/${ddjPath.replace(/\.[^.]+$/, ".png")}`;
}
