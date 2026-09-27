import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { normalizePublicPath } from "../../build/shared/assetPaths.mjs";
import { runVatPipeline } from "../../build/char/vatPipeline.mjs";

test("VAT pipeline shares bakes, reuses fresh artifacts, and retires only orphan outputs", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sro-vat-pipeline-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const publicRoot = path.join(root, "public");
  const manifestPath = path.join(publicRoot, "assets", "npc", "manifest.json");
  const glbPublicPath = "/assets/npc/res/mob/wolf.glb";
  const publicPathToDisk = (publicPath) =>
    path.join(publicRoot, ...normalizePublicPath(publicPath).slice(1).split("/"));
  await mkdir(path.dirname(publicPathToDisk(glbPublicPath)), { recursive: true });
  await writeFile(publicPathToDisk(glbPublicPath), "fixture glb");
  await writeFile(
    manifestPath,
    JSON.stringify({
      models: {
        WOLF: { codename: "WOLF", glb: glbPublicPath, clips: ["stand"] },
        WOLF_CLON: { codename: "WOLF_CLON", glb: glbPublicPath, clips: ["stand"] }
      }
    })
  );
  const vatRoot = path.join(path.dirname(manifestPath), "vat");
  await mkdir(vatRoot, { recursive: true });
  const orphanPath = path.join(vatRoot, "orphan.vat.bin");
  await writeFile(orphanPath, "orphan");

  const settings = {
    format: "fixture-vat",
    version: 1,
    compilerVersion: "fixture-compiler",
    clipRoles: ["stand"],
    materialMode: "fixture"
  };
  let bakeCalls = 0;
  const options = {
    manifestPath,
    missingResult: { built: 0 },
    settings,
    logTag: "vat-test",
    getModels: (manifest) => Object.values(manifest.models),
    classifyModel: (model) => (model.glb ? "include" : "ignore"),
    vatPublicPathsForGlb: () => ({
      manifest: "/assets/npc/vat/wolf.vat.json",
      bin: "/assets/npc/vat/wolf.vat.bin"
    }),
    publicPathToDisk,
    bakeVatFromGlb: async ({ glbPublicPath: source, glbSha256 }) => {
      bakeCalls += 1;
      return {
        data: new Uint16Array([1, 2, 3, 4]),
        componentType: "float16",
        f16MaxAbsError: 0,
        manifestCore: {
          format: settings.format,
          version: settings.version,
          compilerVersion: settings.compilerVersion,
          source: { glb: source, sha256: glbSha256 },
          settings: { materialMode: settings.materialMode },
          texture: { frameCount: 1 },
          clips: { stand: { frameCount: 1 } }
        }
      };
    },
    isExistingVatFresh: (manifest, binPath, { glbSha256 }) =>
      manifest?.source?.sha256 === glbSha256 && fs.existsSync(binPath),
    createVatPrecisionCensus: () => ({ baked: 0 }),
    reportVatPrecision: () => {},
    recordVatPrecision: (census) => { census.baked += 1; },
    createVatReference: (vatManifest, vatPublic) => ({
      manifest: vatPublic.manifest,
      bin: vatPublic.bin,
      bytes: vatManifest.bin.byteLength,
      frames: vatManifest.texture.frameCount
    }),
    updateManifest: (manifest) => { manifest.vat = settings; },
    shareByGlb: true,
    skipMissingGlb: true,
    cleanupRoot: vatRoot
  };

  const first = await runVatPipeline(options);
  assert.deepEqual(
    { built: first.built, reused: first.reused, shared: first.shared, failed: first.failed },
    { built: 1, reused: 0, shared: 1, failed: 0 }
  );
  assert.equal(first.precision.baked, 1);
  assert.equal(first.assetCount, 2);
  assert.equal(bakeCalls, 1);
  assert.equal(fs.existsSync(orphanPath), false);

  const published = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.deepEqual(published.models.WOLF.vat, published.models.WOLF_CLON.vat);
  assert.equal(
    (await readFile(publicPathToDisk(published.models.WOLF.vat.bin))).byteLength,
    8
  );

  const second = await runVatPipeline(options);
  assert.deepEqual(
    { built: second.built, reused: second.reused, shared: second.shared, failed: second.failed },
    { built: 0, reused: 1, shared: 1, failed: 0 }
  );
  assert.equal(bakeCalls, 1);

	options.settingsForModel = ( model, baseSettings ) => ( {
		...baseSettings,
		clipRoles: model.codename.endsWith( "_CLON" ) ? [ "walk" ] : [ "stand" ]
	} );
	await assert.rejects(
		() => runVatPipeline( options ),
		/shared GLB requested incompatible VAT settings/
	);
});
