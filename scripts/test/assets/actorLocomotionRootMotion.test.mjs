import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { avatarToGlb } from "../../build/char/exportGlb.mjs";

const rebuildRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const publicRoot = path.join(rebuildRoot, ".generated", "client-public");

function publicAssetPath(publicPath) {
  assert.match(publicPath, /^\/assets\//, `invalid public asset path ${publicPath}`);
  return path.join(publicRoot, ...publicPath.slice(1).split("/"));
}

function readGlb(glb) {
  assert.equal(glb.readUInt32LE(0), 0x46546c67, "fixture output must be a GLB");
  const jsonLength = glb.readUInt32LE(12);
  const json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString("utf8").trim());
  const binaryHeaderOffset = 20 + jsonLength;
  const binaryLength = glb.readUInt32LE(binaryHeaderOffset);
  const binary = glb.subarray(binaryHeaderOffset + 8, binaryHeaderOffset + 8 + binaryLength);
  return { json, binary };
}

function readFloatAccessor(document, binary, accessorIndex) {
  const accessor = document.accessors[accessorIndex];
  assert.equal(accessor.componentType, 5126, "translation accessor must use float32");
  const componentCount = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[accessor.type];
  assert.ok(componentCount, `unsupported accessor type ${accessor.type}`);
  const view = document.bufferViews[accessor.bufferView];
  const byteOffset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  return Array.from(
    new Float32Array(
      binary.buffer,
      binary.byteOffset + byteOffset,
      accessor.count * componentCount
    )
  );
}

function readFloat16(buffer, floatIndex) {
  const bits = buffer.readUInt16LE(floatIndex * 2);
  const sign = (bits & 0x8000) === 0 ? 1 : -1;
  const exponent = (bits >>> 10) & 0x1f;
  const fraction = bits & 0x03ff;
  if (exponent === 0) return sign * (2 ** -14) * (fraction / 1024);
  if (exponent === 0x1f) return fraction === 0 ? sign * Infinity : Number.NaN;
  return sign * (2 ** (exponent - 15)) * (1 + fraction / 1024);
}

function translationKeysForRole(glb, role) {
  const { json, binary } = readGlb(glb);
  const animation = json.animations.find((candidate) => candidate.name === role);
  assert.ok(animation, `${role} animation is absent`);
  const channel = animation.channels.find(
    (candidate) => candidate.target.node === 0 && candidate.target.path === "translation"
  );
  assert.ok(channel, `${role} root translation channel is absent`);
  return readFloatAccessor(json, binary, animation.samplers[channel.sampler].output);
}

function assertHorizontalLocomotionInPlace(glb, label) {
  const { json, binary } = readGlb(glb);
  const locomotionAnimations = (json.animations ?? []).filter(
    (candidate) => candidate.name === "walk" || candidate.name === "run"
  );
  if (locomotionAnimations.length === 0) return 0;
  const rootNode = json.skins?.[0]?.skeleton;
  assert.equal(typeof rootNode, "number", `${label} has no skeleton root`);
  let checkedRoles = 0;
  for (const role of ["walk", "run"]) {
    const animation = locomotionAnimations.find((candidate) => candidate.name === role);
    if (!animation) continue;
    const channel = animation.channels.find(
      (candidate) => candidate.target.node === rootNode && candidate.target.path === "translation"
    );
    // A clip without a root translation channel stays at bind pose and is
    // already in-place by construction.
    if (!channel) {
      checkedRoles += 1;
      continue;
    }
    const translations = readFloatAccessor(json, binary, animation.samplers[channel.sampler].output);
    const horizontalX = [];
    const horizontalZ = [];
    for (let offset = 0; offset < translations.length; offset += 3) {
      horizontalX.push(translations[offset]);
      horizontalZ.push(translations[offset + 2]);
    }
    assert.ok(
      Math.max(...horizontalX) - Math.min(...horizontalX) <= 1e-6,
      `${label} ${role} root X contains duplicate holder travel`
    );
    assert.ok(
      Math.max(...horizontalZ) - Math.min(...horizontalZ) <= 1e-6,
      `${label} ${role} root Z contains duplicate holder travel`
    );
    checkedRoles += 1;
  }
  return checkedRoles;
}

function makeClip(role) {
  return {
    role,
    clip: {
      frameCount: 2,
      frameTimesMs: [0, 1000],
      bones: [{
        name: "Root",
        keyCount: 2,
        keys: [
          { q: [0, 0, 0, 1], t: [1, 11, 2] },
          { q: [0, 0, 0, 1], t: [3, 12, 4] }
        ]
      }]
    }
  };
}

test("Mission-owned locomotion keeps pose height but removes duplicate root travel", () => {
  const glb = avatarToGlb({
    name: "root-motion-owner-fixture",
    skeleton: {
      boneCount: 1,
      bones: [{
        name: "Root",
        parentIndex: -1,
        local: { q: [0, 0, 0, 1], t: [5, 10, 7] }
      }],
      byName: new Map([["Root", 0]])
    },
    parts: [],
    materials: new Map(),
    clips: [makeClip("walk"), makeClip("attack1")],
    inPlaceHorizontalRootMotionRoles: ["walk"]
  });

  assert.deepEqual(
    translationKeysForRole(glb, "walk"),
    [5, 11, -7, 5, 12, -7],
    "the holder owns X/Z while the authored vertical pose remains intact"
  );
  assert.deepEqual(
    translationKeysForRole(glb, "attack1"),
    [1, 11, -2, 3, 12, -4],
    "non-locomotion root motion must remain authored"
  );
});

test("root-motion role policy rejects malformed ownership declarations", () => {
  const base = {
    name: "invalid-root-motion-policy",
    skeleton: {
      boneCount: 1,
      bones: [{ name: "Root", parentIndex: -1, local: { q: [0, 0, 0, 1], t: [0, 0, 0] } }],
      byName: new Map([["Root", 0]])
    },
    parts: [],
    materials: new Map(),
    clips: []
  };

  assert.throws(
    () => avatarToGlb({ ...base, inPlaceHorizontalRootMotionRoles: ["walk", "walk"] }),
    /contains a duplicate role/
  );
  assert.throws(
    () => avatarToGlb({ ...base, inPlaceHorizontalRootMotionRoles: "walk" }),
    /must be an array of role names/
  );
});

test("published Baroi locomotion is horizontally in-place", () => {
  const glb = fs.readFileSync(
    path.join(rebuildRoot, ".generated", "client-public", "assets", "npc", "mob", "europe", "baroi.glb")
  );
  const { json, binary } = readGlb(glb);
  const rootNode = json.skins[0].skeleton;
  const rootBindTranslation = json.nodes[rootNode].translation;

  for (const role of ["walk", "run"]) {
    const animation = json.animations.find((candidate) => candidate.name === role);
    assert.ok(animation, `Baroi ${role} animation is absent`);
    const channel = animation.channels.find(
      (candidate) => candidate.target.node === rootNode && candidate.target.path === "translation"
    );
    assert.ok(channel, `Baroi ${role} root translation channel is absent`);
    const translations = readFloatAccessor(json, binary, animation.samplers[channel.sampler].output);
    const verticalValues = [];
    for (let offset = 0; offset < translations.length; offset += 3) {
      assert.ok(
        Math.abs(translations[offset] - rootBindTranslation[0]) <= 1e-6,
        `Baroi ${role} root X escaped holder ownership at key ${offset / 3}`
      );
      assert.ok(
        Math.abs(translations[offset + 2] - rootBindTranslation[2]) <= 1e-6,
        `Baroi ${role} root Z escaped holder ownership at key ${offset / 3}`
      );
      verticalValues.push(translations[offset + 1]);
    }
    assert.ok(
      Math.max(...verticalValues) - Math.min(...verticalValues) > 0.01,
      `Baroi ${role} lost its authored vertical pose motion`
    );
  }
});

test("every holder-driven actor resource exports in-place locomotion", () => {
  const npcManifest = JSON.parse(
    fs.readFileSync(path.join(publicRoot, "assets", "npc", "manifest.json"), "utf8")
  );
  const avatarRoster = JSON.parse(
    fs.readFileSync(path.join(publicRoot, "assets", "char", "roster.json"), "utf8")
  );
  const resources = new Map();
  for (const entry of Object.values(npcManifest.models)) {
    if (entry.glb) resources.set(entry.glb, `NPC resource ${entry.glb}`);
  }
  for (const entry of avatarRoster.models) {
    if (entry.glb) resources.set(entry.glb, `avatar resource ${entry.glb}`);
  }

  let resourcesWithLocomotion = 0;
  let checkedRoles = 0;
  for (const [publicPath, label] of resources) {
    const roleCount = assertHorizontalLocomotionInPlace(
      fs.readFileSync(publicAssetPath(publicPath)),
      label
    );
    if (roleCount > 0) resourcesWithLocomotion += 1;
    checkedRoles += roleCount;
  }
  assert.equal(
    resourcesWithLocomotion,
    148,
    "the holder-driven actor census changed; review every new or removed locomotion resource"
  );
  assert.equal(
    checkedRoles,
    296,
    "the walk/run ownership census changed; update the ownership ratchet intentionally"
  );
});

test("published Baroi VAT preserves the in-place locomotion contract", () => {
  const vatDirectory = path.join(
    rebuildRoot,
    ".generated",
    "client-public",
    "assets",
    "npc",
    "vat",
    "mob",
    "europe"
  );
  const manifest = JSON.parse(fs.readFileSync(path.join(vatDirectory, "baroi.vat.json"), "utf8"));
  const binary = fs.readFileSync(path.join(vatDirectory, "baroi.vat.bin"));
  assert.equal(
    binary.byteLength,
    manifest.texture.frameCount * manifest.texture.floatsPerFrame * 2,
    "Baroi VAT must use the declared float16 matrix layout"
  );

  for (const role of ["walk", "run"]) {
    const clip = manifest.clips[role];
    assert.ok(clip, `Baroi VAT ${role} range is absent`);
    const horizontalX = [];
    const horizontalZ = [];
    const verticalY = [];
    for (let frame = clip.startFrame; frame <= clip.endFrame; frame += 1) {
      const rootMatrixOffset = frame * manifest.texture.floatsPerFrame;
      horizontalX.push(readFloat16(binary, rootMatrixOffset + 12));
      verticalY.push(readFloat16(binary, rootMatrixOffset + 13));
      horizontalZ.push(readFloat16(binary, rootMatrixOffset + 14));
    }
    assert.ok(
      Math.max(...horizontalX) - Math.min(...horizontalX) <= 1e-6,
      `Baroi VAT ${role} root X contains duplicate path travel`
    );
    assert.ok(
      Math.max(...horizontalZ) - Math.min(...horizontalZ) <= 1e-6,
      `Baroi VAT ${role} root Z contains duplicate path travel`
    );
    assert.ok(
      Math.max(...verticalY) - Math.min(...verticalY) > 0.01,
      `Baroi VAT ${role} lost its authored vertical pose motion`
    );
  }
});
