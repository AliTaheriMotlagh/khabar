// What «گوش دادن» reads (src/lib/lines.ts): the rule itself, and — after a build — that a story's page and its card.json
// give the same paragraphs the same indices, since the cloud voice, the offline audio and the playlist go by index.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cardLines, storyLines } from '../src/lib/lines.ts';

test('lines: the text, not the headline; a repeated headline and bare links skipped', () => {
  assert.deepEqual(storyLines(1, 'تیتر', ['بند  اول', '', 'بند دوم']), [
    { text: 'بند اول', post: 1, i: 1 },
    { text: 'بند دوم', post: 1, i: 2 },
  ]);
  // A brief whose first line is its headline again.
  assert.deepEqual(storyLines(2, 'خبر کوتاه درباره‌ی ربات‌ها…', ['خبر کوتاه درباره‌ی ربات‌ها و آینده', 'ادامه']).map((l) => l.i), [2]);
  assert.deepEqual(storyLines(3, 'تیتر', ['🔗 https://example.com/x', 'متن']).map((l) => l.i), [2]);
  assert.deepEqual(storyLines(4, 'فقط تیتر', []), [{ text: 'فقط تیتر', post: 4, i: 0 }]);
  assert.deepEqual(storyLines(5, 'تیتر', ['متن'], true).map((l) => l.i), [0, 1]);
  assert.deepEqual(cardLines({ id: 6, title: 'تیتر', body: ['یک'], why: 'چون' }).map((l) => [l.i, l.text]), [[1, 'یک'], [2, 'چون']]);
});

const dist = path.resolve('dist');
const built = fs.existsSync(path.join(dist, 'p'));
test('lines: a story page and its card.json agree, paragraph by paragraph', { skip: built ? false : 'run `npm run build` first' }, () => {
  const ids = fs.readdirSync(path.join(dist, 'p')).filter((d) => /^\d+$/.test(d)).sort((a, b) => b - a).slice(0, 80);
  const decode = (s) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
  let checked = 0;
  for (const id of ids) {
    const page = fs.readFileSync(path.join(dist, 'p', id, 'index.html'), 'utf8');
    const card = JSON.parse(fs.readFileSync(path.join(dist, 'p', id, 'card.json'), 'utf8'));
    if (card.kind === 'digest') continue; // a digest's items show as links with their number apart: same indices, other text
    const prose = page.match(/<div class="prose"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? '';
    const paras = [...prose.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((m) => decode(m[1]));
    const why = page.match(/<aside class="why">[\s\S]*?<p>([\s\S]*?)<\/p>/)?.[1];
    const title = decode(page.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)[1]);
    const fromPage = storyLines(Number(id), title, [...paras, ...(why ? [decode(why)] : [])]);
    assert.deepEqual(fromPage, cardLines(card), `post ${id}`);
    checked++;
  }
  assert.ok(checked > 10, `checked ${checked} stories`);
});
