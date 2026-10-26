// The catalog of downloadable Persian voices (src/lib/voices.ts): node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DEFAULT_VOICE, VOICES, families, mirrors, speedOf, voiceById } from '../src/lib/voices.ts';

const ORDER = ['sherpa-onnx-wasm-main-tts.js', 'sherpa-onnx-tts.js', 'sherpa-onnx-wasm-main-tts.wasm', 'sherpa-onnx-wasm-main-tts.data'];

test('voices: every entry is complete, pinned and in the worker\'s file order', () => {
  assert.equal(new Set(VOICES.map((v) => v.id)).size, VOICES.length, 'ids are unique');
  for (const v of VOICES) {
    assert.deepEqual(v.files.map((f) => f.name), ORDER, v.id);
    for (const f of v.files) {
      assert.match(f.sha256, /^[0-9a-f]{64}$/, `${v.id}/${f.name}`);
      assert.ok(f.size > 0, `${v.id}/${f.name}`);
    }
    const model = v.config.offlineTtsModelConfig;
    assert.ok(model && (model.offlineTtsVitsModelConfig || model.offlineTtsMatchaModelConfig || model.offlineTtsKokoroModelConfig), v.id);
    assert.equal(model.numThreads, 1, `${v.id}: one thread (no SharedArrayBuffer on the site)`);
    assert.ok(v.rtf > 0, `${v.id}: measured (node scripts/voices.mjs bench)`);
    assert.ok(['زن', 'مرد'].includes(v.gender), v.id);
    assert.ok(v.name && v.about, v.id);
    assert.ok(mirrors(v.id).every((m) => m.includes(`/wasm-${v.id}/`)));
  }
});

test('voices: a file with one hash has one size (stored once, by hash)', () => {
  const size = new Map();
  for (const f of VOICES.flatMap((v) => v.files)) {
    if (size.has(f.sha256)) assert.equal(size.get(f.sha256), f.size, f.name);
    size.set(f.sha256, f.size);
  }
  // The runtime is the same in every package: a second voice doesn't download it again.
  assert.equal(new Set(VOICES.map((v) => v.files[2].sha256)).size, 1);
});

test('voices: each speaker has a preview, its full build first, and one recommended voice', () => {
  for (const group of families()) {
    assert.ok(!group[0].light, `${group[0].family}: full build first`);
    assert.ok(fs.existsSync(`public/voices/${group[0].family}.mp3`), `${group[0].family}: public/voices/${group[0].family}.mp3`);
    assert.equal(new Set(group.map((v) => v.name)).size, 1, `${group[0].family}: one name`);
  }
  assert.equal(VOICES.filter((v) => v.recommended).length, 1);
  assert.ok(!voiceById(DEFAULT_VOICE).light);
});

test('voices: the voice downloaded before the choice existed is still the same files at the same address', () => {
  // Readers who have it are moved to the new storage by these (src/scripts/voice.ts, migrate()).
  const v = voiceById(DEFAULT_VOICE);
  assert.deepEqual(
    v.files.map((f) => f.sha256),
    ['ebec9541e999ae99fb267ef40d527ac0f1e436bf5a0b55ec73b10eaae278a14a', '51c0523f16a864ec942409aa0fe6e80a581bfb54a492ed94ecbdce491f9e9a79', 'cfd3c816c2f02477c234b66f00af11cc500f45904956f7e44d86f81bf4fe41d5', 'e354f66cbd0c167b6e6f502c63628bcf4368f51767f22b5c621fdbdc55559c51'],
  );
  assert.equal(mirrors(DEFAULT_VOICE)[0], 'https://huggingface.co/datasets/jiangzhuo9357/sherpa-onnx-tts-models/resolve/c17064a360099d72cf3973cfdaaddc46acf98bfb/wasm-piper-fa-ganji-medium/');
});

test('voices: speed labels', () => {
  assert.equal(speedOf({ rtf: 0.17 }).slow, false);
  assert.equal(speedOf({ rtf: 0.6 }).slow, true);
});
