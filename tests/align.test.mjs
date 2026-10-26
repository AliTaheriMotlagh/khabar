// Word timings from a clip's sound (src/lib/align.ts): node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { align, pauseAfter, weight, words } from '../src/lib/align.ts';

const RATE = 16000;
// A fixed pseudo-random sequence, so the tests are the same every run.
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

/** A made-up clip: each word a burst of noise (a dip between its syllables), the voice's pauses after commas and
 *  sentences, a short one now and then between words; with the true times. */
function clip(ws, { lead = 0.25, tail = 0.4 } = {}) {
  const parts = [];
  const spans = [];
  let at = 0;
  const quiet = (s) => {
    parts.push(new Float32Array(Math.round(s * RATE)).map(() => (rand() - 0.5) * 0.002));
    at += s;
  };
  quiet(lead);
  ws.forEach((w, i) => {
    const len = weight(w) * 0.1 * (0.75 + rand() * 0.5);
    const n = Math.round(len * RATE);
    const syl = Math.max(1, Math.round(len / 0.18));
    parts.push(new Float32Array(n).map((_, k) => (rand() - 0.5) * 0.6 * (0.35 + 0.65 * Math.abs(Math.sin((Math.PI * syl * k) / n)))));
    spans.push({ from: at, to: (at += len) });
    if (i < ws.length - 1) quiet([rand() < 0.3 ? 0.03 : 0, 0.2, 0.36][pauseAfter(w)] * (0.8 + rand() * 0.4));
  });
  quiet(tail);
  const pcm = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) pcm.set(p, (o += p.length) - p.length);
  return { pcm, spans };
}

const TEXT = 'گوگل می‌گوید مدل Gemini 4 Argon به کشف مثال‌های نقض در فیزیک پلاسما کمک کرده، و سرعت ۴٫۴ برابر شده است. پژوهشگران در مقاله‌ای گزارش دادند امتیاز مدل‌ها هر ۵۳٫۹ روز دو برابر شده؛ هزینه هم به حدود یک‌ششم رسیده است.';

test('words / weight / pauseAfter', () => {
  assert.deepEqual(words('  یک  دو\nسه '), ['یک', 'دو', 'سه']);
  assert.ok(weight('Argon') > weight('به'));
  assert.ok(weight('۵۳٫۹') > weight('روز') * 2, 'a number is said as words');
  assert.equal(pauseAfter('است.'), 2);
  assert.equal(pauseAfter('شده؛'), 1);
  assert.equal(pauseAfter('کرده،'), 1);
  assert.equal(pauseAfter('«گفت»'), 0);
  assert.equal(pauseAfter('برابر'), 0);
});

test('align: every word in order, inside the clip, none empty', () => {
  const ws = words(TEXT);
  const { pcm } = clip(ws);
  const got = align(pcm, RATE, ws);
  assert.equal(got.length, ws.length);
  got.forEach((s, i) => {
    assert.ok(s.to > s.from, `word ${i} has a length`);
    if (i) assert.ok(s.from >= got[i - 1].to - 1e-9, `word ${i} starts after the one before ends`);
  });
  assert.ok(got[0].from >= 0 && got.at(-1).to <= pcm.length / RATE + 0.01);
});

test('align: words land on their sound (made-up clips, 20 runs)', () => {
  const ws = words(TEXT);
  let worst = 0;
  let sum = 0;
  let n = 0;
  for (let run = 0; run < 20; run++) {
    const { pcm, spans } = clip(ws);
    const got = align(pcm, RATE, ws);
    got.forEach((s, i) => {
      const err = Math.abs(s.from - spans[i].from);
      sum += err;
      n++;
      worst = Math.max(worst, err);
      // After a comma or a sentence the pause pins the next word down.
      if (i && pauseAfter(ws[i - 1])) assert.ok(err < 0.05, `run ${run}: «${ws[i]}» after a pause starts ${err.toFixed(3)} s off`);
    });
  }
  assert.ok(sum / n < 0.08, `mean start error ${(sum / n).toFixed(3)} s`);
  // Each made-up word is ±25% off its weight, so between two pauses the guess can drift this far. (On the site's real
  // voices, against each sentence's prefixes spoken alone: 0.11 s mean, 0.09 s median.)
  assert.ok(worst < 0.45, `worst start error ${worst.toFixed(3)} s`);
});

test('align: speech starts after the lead-in silence and ends before the tail', () => {
  const ws = words('سلام رفیق، خبر تازه داریم.');
  const { pcm, spans } = clip(ws, { lead: 0.6, tail: 0.8 });
  const got = align(pcm, RATE, ws);
  assert.ok(Math.abs(got[0].from - spans[0].from) < 0.02);
  assert.ok(Math.abs(got.at(-1).to - spans.at(-1).to) < 0.02);
});

test('align: edge cases', () => {
  assert.deepEqual(align(new Float32Array(1000), RATE, []), []);
  const one = align(clip(['سلام']).pcm, RATE, ['سلام']);
  assert.equal(one.length, 1);
  // Silence (a voice that said nothing): the words still get the whole clip, in order.
  const mute = align(new Float32Array(RATE), RATE, ['یک', 'دو', 'سه']);
  assert.equal(mute.length, 3);
  assert.ok(mute[0].from === 0 && mute[2].to <= 1.01 && mute[1].from >= mute[0].to);
});
