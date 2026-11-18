// English words in Persian letters for the browser's Persian-only voices (server/_latin.js, through server/_say.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { latinWord } from '../server/_latin.js';
import { sayLine, toShown } from '../server/_say.js';
import { cloudOf, storyLines } from '../src/lib/lines.ts';

test('latin: the news names, acronyms, versions and domains', () => {
  const cases = {
    OpenAI: 'اوپن‌ای‌آی', 'GPT-5': 'جی‌پی‌تی‌پنج', LLM: 'ال‌ال‌ام', 'x.com': 'ایکس‌دات‌کام', DeepSeek: 'دیپ‌سیک', Claude: 'کلود',
    'Llama-3.1': 'لاما‌سه‌ممیز‌یک', streaming: 'استریمینگ', 'Qwen3.5-9B': 'کوئن‌سه‌ممیز‌پنج‌نه‌بی', MCP: 'ام‌سی‌پی', '2026': 'دو‌هزار‌و‌بیست‌و‌شش',
  };
  for (const [en, fa] of Object.entries(cases)) assert.equal(latinWord(en), fa, en);
  // Whatever the word, only Persian letters and the joiner come out: nothing for Cilla Mini to drop.
  for (const w of ['RightNow', 'Synthesia', 'Perplexity', 'co-founder', 'Reinforcement', 'NotebookLM', 'Zxqv', 'a']) assert.match(latinWord(w), /^[؀-ۿ‌]+$/, w);
});

test('latin: one word for one word, the highlight maps back, the lexicon wins, the cloud keeps English', () => {
  const text = 'شرکت OpenAI مدل GPT-5 را با $5B معرفی کرد.';
  const plain = sayLine(text, undefined);
  assert.equal(plain.say, text, 'without `latin` nothing changes (the cloud voice)');
  const { say, map } = sayLine(text, { OpenAI: 'اُپن‌اِی‌آی' }, true);
  assert.equal(say, 'شرکت اُپن‌اِی‌آی مدل جی‌پی‌تی‌پنج را با پنج‌میلیارد‌دلار معرفی کرد.');
  assert.equal(say.split(/\s+/).length, text.split(/\s+/).length, 'as many words as shown');
  assert.equal(text.slice(toShown(map, say.indexOf('جی‌پی‌تی'))).startsWith('GPT-5'), true);
  // The lexicon's spelling isn't marked; this file's are, and the cloud's address hashes the text without them.
  assert.deepEqual(map.map((m) => m[4] ?? 0), [0, 1, 1]);
  const [line] = storyLines(1, 'عنوان', [text], false, { OpenAI: 'اُپن‌اِی‌آی' });
  assert.equal(cloudOf(line), sayLine(text, { OpenAI: 'اُپن‌اِی‌آی' }).say);
});
