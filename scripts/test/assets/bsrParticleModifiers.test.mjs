import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { parseCharacterBsr } from '../../build/char/formats.mjs';
import { dataAssetPath } from '../../build/shared/jmxAssetIO.mjs';
import { collectModelParticleReferences, collectEffectReferences } from '../../build/effects/buildEffectPrograms.mjs';

function fixture() {
  const bytes = Buffer.alloc(1024);
  bytes.write('JMXVRES 0109');
  let p = 0x80;
  bytes.writeUInt32LE(p, 0x0c + 6 * 4);
  const u32 = value => { bytes.writeUInt32LE(value >>> 0, p); p += 4; };
  const str = value => { u32(value.length); p += bytes.write(value, p, 'latin1'); };
  const vector = values => { for (const v of values) { bytes.writeFloatLE(v, p); p += 4; } };
  u32(1); // First list, one set.
  u32(2); u32(-1); str('ambient'); u32(1); u32(0x30000);
  for (let i = 1; i <= 6; i++) u32(i);
  bytes.set([7,8,9,10], p); p += 4;
  u32(2);
  const payloadStart = p;
  for (const optional of [0, 2]) { // Native tests nonzero, not equality with one.
    u32(11); str('system\\fixture.efp'); str('Bip01 Head');
    vector([1.25, -2.5, 3.75]); u32(12);
    bytes.set([13,14,15,optional], p); p += 4;
    if (optional) vector([4,5,6]);
  }
  const payloadEnd = p;
  u32(0); // Second list.
  // A discriminating part-link tail detects a wrong particle cursor.
  u32(1); u32(4); u32(2); u32(1); u32(77); u32(99);
  return { bytes: bytes.subarray(0, p), payloadStart, payloadEnd };
}

test('BSR particle modifiers retain both optional-vector branches and the following part-link table', () => {
  const { bytes, payloadStart, payloadEnd } = fixture();
  const parsed = parseCharacterBsr(bytes);
  const [modifier] = parsed.particleModifiers;
  assert.equal(modifier.kind, 2);
  assert.equal(modifier.stateId, -1);
  assert.equal(modifier.animationSetName, 'ambient');
  assert.deepEqual(modifier.baseWords, [1,2,3,4,5,6]);
  assert.deepEqual(modifier.baseBytes, [7,8,9,10]);
  assert.deepEqual(modifier.entries[0], {
    field00: 11, effectPath: 'system\\fixture.efp', boneName: 'Bip01 Head',
    vector3c: [1.25,-2.5,3.75], field4c: 12, flags50: [13,14,15], flag53: 0, vector54: null
  });
  assert.equal(modifier.entries[1].flag53, 2);
  assert.deepEqual(modifier.entries[1].vector54, [4,5,6]);
  assert.deepEqual(parsed.partLink, { a: 1, b: 4, c: 2, pairs: [{ key: 77, value: 99 }] });
  for (let length = payloadStart; length < payloadEnd; length++) {
    assert.throws(() => parseCharacterBsr(bytes.subarray(0, length)), `truncation at ${length}`);
  }
});

test('retail helper model retains its authored particle reference despite having no mesh', () => {
  const parsed = parseCharacterBsr(fs.readFileSync(dataAssetPath('res/etc/helpermark.bsr')));
  assert.deepEqual(parsed.meshPaths, []);
  assert.equal(parsed.particleModifiers.length, 1);
  assert.equal(parsed.particleModifiers[0].entries[0].effectPath, 'system\\system_helpermark.efp');
  assert.deepEqual(parsed.particleModifiers[0].entries[0].vector3c, [0,3,0]);
});

test('particle closure follows both model slots once and propagates missing source failures', () => {
  const visited = [];
  const table = { 1: { authoredStages: [
    { objectResourcePath: 'RES\\A.BSR', secondaryObjectPath: 'res/b.bsr' },
    { objectResourcePath: 'res/a.bsr', secondaryObjectPath: 'direct.efp' }
  ] } };
  const references = collectModelParticleReferences(table, model => {
    visited.push(model);
    return { particleModifiers: [{ entries: [{ effectPath: 'SYSTEM\\SHARED.EFP' }, { effectPath: 'system/shared.efp' }] }] };
  });
  assert.deepEqual(visited, ['res/a.bsr', 'res/b.bsr']);
  assert.deepEqual(references, visited.map(modelPath => ({ modelPath, effectPath: 'system/shared.efp' })));
  assert.throws(() => collectModelParticleReferences(table, () => { throw new Error('missing source'); }), /missing source/);
});

test('enabled native records discover helper, quest and capture particles through model ownership', () => {
  const closure = collectEffectReferences();
  for (const name of ['helpermark', 'questmark_end', 'questmark_going', 'questmark_start', 'capture_mark']) {
    const effectPath = `system/system_${name}.efp`;
    assert.ok(closure.references.includes(effectPath), effectPath);
    assert.ok(closure.modelParticleReferences.some(row => row.effectPath === effectPath));
  }
});
