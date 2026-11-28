// /api/tts against a stubbed fetch (no network): node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';

const card = { title: 'عنوان خبر', body: ['پاراگراف <اول> & دوم'], why: 'چرا مهمه' };
const calls = [];
globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), init });
  if (String(url).endsWith('/p/7/card.json')) return new Response(JSON.stringify(card));
  if (String(url).endsWith('/p/18/card.json')) return new Response(JSON.stringify({ title: 'مدل GPT-5 آمد', body: ['OpenAI گفت'], why: null, lex: { 'GPT-5': 'جی پی تی پنج', OpenAI: 'اوپن اِی آی' }, clip: { hook: 'قلاب', points: ['یک', 'دو', 'سه'], why: 'چرا' }, film: { shots: [{ shot: 'hook', say: ['مدل GPT-5 آمد'] }, { shot: 'picture', say: ['خط دوم'] }, { shot: 'quiz', say: ['سؤال', 'جواب: OpenAI'] }] } }));
  if (String(url).endsWith('/daily/2026-11-18.json')) return new Response(JSON.stringify({ intro: 'صبح بخیر', links: { 7: 'برویم سراغ خبر' }, outro: 'خداحافظ' }));
  if (String(url).endsWith('/weekly/2026-11-20.json')) return new Response(JSON.stringify({ title: 'هفته', intro: 'شروع', items: [{ id: 7, line: 'اولی' }], outro: 'پایان' }));
  if (String(url).endsWith('/videos/7GNR3Ue7QFU/card.json')) return new Response(JSON.stringify({ title: 'تیزر', body: ['نکته'], why: 'ببینید' }));
  if (String(url).includes('tts.speech.microsoft.com')) return new Response(new Uint8Array([1, 2, 3]));
  return new Response('not found', { status: 404 });
};
const get = (fn, qs) => fn(new Request(`https://site.test/api/tts/${qs}`));

test('tts: off without a key', async () => {
  const off = await import('../server/tts.js?off');
  assert.equal((await get(off.GET, '?id=7&i=0')).status, 501);
  assert.equal((await get(off.GET, '?probe=1')).status, 501, 'probe says the cloud voice is off');
});

test('tts: reads paragraph i of the story, never request text', async () => {
  process.env.AZURE_SPEECH_KEY = 'k';
  process.env.AZURE_SPEECH_REGION = 'westeurope';
  const tts = await import('../server/tts.js?on');

  assert.equal((await get(tts.GET, '?probe=1')).status, 200);
  const res = await get(tts.GET, '?id=7&i=1&v=abc');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'audio/mpeg');
  assert.match(res.headers.get('cache-control'), /s-maxage=31536000/);
  assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], [1, 2, 3]);
  const azure = calls.at(-1);
  assert.equal(azure.url, 'https://westeurope.tts.speech.microsoft.com/cognitiveservices/v1');
  assert.equal(azure.init.headers['Ocp-Apim-Subscription-Key'], 'k');
  assert.match(azure.init.body, /fa-IR-DilaraNeural/);
  assert.match(azure.init.body, /پاراگراف &#60;اول&#62; &#38; دوم/, 'text is escaped for SSML');

  assert.equal((await get(tts.GET, '?id=7&i=3')).status, 404, 'past the last paragraph');
  assert.equal((await get(tts.GET, '?id=8&i=0')).status, 404, 'unknown story');
  assert.equal((await get(tts.GET, '?id=x&i=0')).status, 400);
  assert.equal((await get(tts.GET, '?id=7&i=-1')).status, 400);
});

test('tts: every line comes from the site\'s own files — spoken names, host lines, recap, video script, teaser', async () => {
  process.env.AZURE_SPEECH_KEY = 'k';
  process.env.AZURE_SPEECH_REGION = 'westeurope';
  const { textOf } = await import('../server/tts.js?lines');
  const at = (qs) => textOf(new URL(`https://site.test/api/tts/${qs}`));
  assert.equal(await at('?id=18&i=0'), 'مدل جی پی تی پنج آمد');
  assert.equal(await at('?id=18&i=1'), 'اوپن اِی آی گفت');
  assert.equal(await at('?id=18&k=clip&n=0'), 'قلاب');
  assert.equal(await at('?id=18&k=clip&n=4'), 'چرا');
  // A film's lines: every shot's in order (not paragraph 0 for each).
  assert.equal(await at('?id=18&k=film&n=0'), 'مدل جی پی تی پنج آمد');
  assert.equal(await at('?id=18&k=film&n=1'), 'خط دوم');
  assert.equal(await at('?id=18&k=film&n=3'), 'جواب: اوپن اِی آی');
  assert.equal(await at('?id=18&k=film&n=4'), '');
  assert.equal(await at('?day=2026-11-18&k=intro'), 'صبح بخیر');
  assert.equal(await at('?day=2026-11-18&k=7'), 'برویم سراغ خبر');
  assert.equal(await at('?day=2026-11-18&k=99'), '');
  assert.equal(await at('?week=2026-11-20&k=0'), 'اولی');
  assert.equal(await at('?week=2026-11-20&k=outro'), 'پایان');
  assert.equal(await at('?vid=7GNR3Ue7QFU&i=2'), 'ببینید');
  // Anything else is a bad request, never text from the request.
  for (const bad of ['?day=x&k=intro', '?day=2026-11-18&k=<b>', '?week=2026-11-20&k=title2', '?vid=../../x&i=0', '?id=18&k=clip&n=9', '?id=18&k=film&n=-1', '?id=18&k=film&n=x', '?id=abc&i=0']) assert.equal(await at(bad), null, bad);
});
