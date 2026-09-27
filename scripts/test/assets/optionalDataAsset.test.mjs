import assert from "node:assert/strict";
import test from "node:test";
import { loadOptionalDataAsset } from "../../build/shared/optionalDataAsset.mjs";

test("optional Data.pk2 asset lookup preserves native per-resource miss semantics", async () => {
  const requiredStand = await loadOptionalDataAsset(
    "prim/ani/mob/china/bluetiger/bluetiger_stand01.ban"
  );
  const authoredMissingState = await loadOptionalDataAsset(
    "prim/ani/mob/china/bluetiger/bluetiger_stnad01.ban"
  );

  assert.ok(requiredStand instanceof Buffer && requiredStand.length > 0);
  assert.equal(authoredMissingState, null);
});
