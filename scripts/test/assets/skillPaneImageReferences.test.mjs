import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  collectSkillGroupIconDdjReferencesFromRows,
  collectSkillMasteryIconDdjReferencesFromRows
} from "../../build/shared/skillPaneImageReferences.mjs";
import {
  exists,
  mediaRoot,
  readText,
  textDataDir
} from "../../build/shared/resourceIo.mjs";
import { toPublicImagePath } from "../../build/shared/assetPaths.mjs";
import {
  publishedAssetExistsSync,
  readPublishedAssetText
} from "../../lib/publishedAsset.mjs";

test("skill-group collection preserves retail primary and derived focus sprites across races", () => {
  const references = collectSkillGroupIconDdjReferencesFromRows([
    "// ignored",
    "1\tname\t257\tgroup\t0\tdesc\tskillgroup\\china\\pack_sword_smash.ddj",
    "1\tname\t513\tgroup\t0\tdesc\tskillgroup\\europe\\pack_frenzy.ddj",
    "header\twithout\ta\tvalid\ticon",
    "1\tduplicate\t513\tgroup\t1\tdesc\tskillgroup\\europe\\pack_frenzy.ddj"
  ]);

  assert.deepEqual(references, [
    "icon/skillgroup/china/pack_sword_smash.ddj",
    "icon/skillgroup/china/pack_sword_smash_focus.ddj",
    "icon/skillgroup/europe/pack_frenzy.ddj",
    "icon/skillgroup/europe/pack_frenzy_focus.ddj"
  ]);
});

test("mastery collection reads both authored icon columns instead of deriving a race subset", () => {
  const china = ["257", "name", "code", "9", "explain", "tab", "0", "0", "2", "3", "0",
    "icon\\skillmastery\\china\\mastery_sword.ddj",
    "icon\\skillmastery\\china\\mastery_sword_focus.ddj"].join("\t");
  const europe = ["513", "name", "code", "9", "explain", "tab", "1", "0", "2", "3", "0",
    "icon\\skillmastery\\europe\\eu_warrior.ddj",
    "icon\\skillmastery\\europe\\eu_warrior_focus.ddj"].join("\t");

  assert.deepEqual(collectSkillMasteryIconDdjReferencesFromRows([china, europe]), [
    "icon/skillmastery/china/mastery_sword.ddj",
    "icon/skillmastery/china/mastery_sword_focus.ddj",
    "icon/skillmastery/europe/eu_warrior.ddj",
    "icon/skillmastery/europe/eu_warrior_focus.ddj"
  ]);
});

test("every shipped skill-pane table sprite is converted, published, and cataloged", async () => {
  const [masteryText, groupText, catalogText] = await Promise.all([
    readText(path.join(textDataDir, "skillmasterydata.txt")),
    readText(path.join(textDataDir, "skillgroup.txt")),
    readPublishedAssetText("/assets/cif/cif-sprite-catalog.json")
  ]);
  const references = [
    ...collectSkillMasteryIconDdjReferencesFromRows(masteryText.split(/\r?\n/)),
    ...collectSkillGroupIconDdjReferencesFromRows(groupText.split(/\r?\n/))
  ];
  const catalog = JSON.parse(catalogText);

  assert.ok(references.some((path) => path.startsWith("icon/skillgroup/china/")));
  assert.ok(references.some((path) => path.startsWith("icon/skillgroup/europe/")));
  assert.ok(references.includes("icon/skillmastery/europe/eu_warrior.ddj"));
  assert.ok(references.includes("icon/skillgroup/europe/pack_frenzy_focus.ddj"));

  for (const ddjPath of references) {
    assert.ok(
      await exists(path.join(mediaRoot, ...ddjPath.split("/"))),
      `missing extracted DDJ source for ${ddjPath}`
    );
    assert.ok(
      publishedAssetExistsSync(toPublicImagePath("Media_extracted", ddjPath)),
      `missing published image for ${ddjPath}`
    );
    assert.ok(
      catalog.resourcesByDdjPath[ddjPath],
      `missing CIF sprite catalog entry for ${ddjPath}`
    );
  }
});
