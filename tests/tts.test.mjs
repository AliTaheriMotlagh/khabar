// /api/tts against a stubbed fetch (no network): node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';

const card = { title: 'عنوان خبر', body: ['پاراگراف <اول> & دوم'], why: 'چرا مهمه' };
const calls = [];
globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), init });
  if (String(url).endsWith('/p/7/card.json')) return new Response(JSON.stringify(card));
  if (String(url).includes('tts.speech.microsoft.com')) return new Response(new Uint8Array([1, 2, 3]));
  return new Response('not found', { status: 404 });
};
const get = (fn, qs) => fn(new Request(`https://site.test/api/tts/${qs}`));

test('tts: off without a key', async () => {
  const off = await import('../api/tts.js?off');
  assert.equal((await get(off.GET, '?id=7&i=0')).status, 501);
  assert.equal((await get(off.GET, '?probe=1')).status, 501, 'probe says the cloud voice is off');
});

test('tts: reads paragraph i of the story, never request text', async () => {
  process.env.AZURE_SPEECH_KEY = 'k';
  process.env.AZURE_SPEECH_REGION = 'westeurope';
  const tts = await import('../api/tts.js?on');

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
