// functions/media/[[path]].js (the public films in R2) against an in-memory bucket: publishing, the cover, the index
// the build reads (src/lib/films.ts), deleting. node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
const MEDIA = {
  async head(k) {
    const o = store.get(k);
    return o ? { size: o.body.length, customMetadata: o.meta, httpEtag: '"e"' } : null;
  },
  async get(k) {
    const o = store.get(k);
    if (!o) return null;
    return { size: o.body.length, customMetadata: o.meta, httpEtag: '"e"', body: o.body, json: async () => JSON.parse(new TextDecoder().decode(o.body)) };
  },
  async put(k, body, opts = {}) {
    store.set(k, { body: typeof body === 'string' ? new TextEncoder().encode(body) : body, meta: opts.customMetadata ?? {} });
  },
  async delete(keys) {
    for (const k of [keys].flat()) store.delete(k);
  },
};
globalThis.caches = { default: { match: async () => undefined, put: async () => {}, delete: async () => true } };
globalThis.fetch = async (u) => (String(u).endsWith('/p/7/card.json') ? new Response('{}') : new Response('no', { status: 404 }));
const { onRequest } = await import('../functions/media/[[path]].js');
const call = (path, init = {}) => onRequest({ request: new Request(`https://site.test/media/${path}`, init), env: { MEDIA, MEDIA_KEY: 'key' }, waitUntil() {} });
const mp4 = () => {
  const b = new Uint8Array(4096);
  b.set([0, 0, 0, 24, 102, 116, 121, 112], 0); // …ftyp
  return b;
};
const jpg = () => {
  const b = new Uint8Array(2048);
  b.set([0xff, 0xd8], 0);
  return b;
};

test('films: a reader publishes once, with its cover and length; the index lists it; the owner deletes it', async () => {
  let res = await call('films/7-v.mp4', { method: 'POST', headers: { 'content-type': 'video/mp4', 'content-length': '4096', 'x-seconds': '74.26' }, body: mp4() });
  assert.equal(res.status, 201);
  res = await call('films/7-v.mp4', { method: 'POST', headers: { 'content-type': 'video/mp4', 'content-length': '4096' }, body: mp4() });
  assert.equal(res.status, 409, 'first wins');
  res = await call('films/8-v.mp4', { method: 'POST', headers: { 'content-type': 'video/mp4', 'content-length': '4096' }, body: mp4() });
  assert.equal(res.status, 404, 'a story the site has');
  res = await call('films/7-v.mp4', { method: 'POST', headers: { 'content-type': 'video/mp4', 'content-length': '2048' }, body: new Uint8Array(2048) });
  assert.equal(res.status, 409);
  res = await call('films/7-v.jpg', { method: 'POST', headers: { 'content-type': 'image/jpeg', 'content-length': '2048' }, body: jpg() });
  assert.equal(res.status, 201);
  let index = await (await call('films/index.json')).json();
  assert.equal(index['7'].v.sec, 74.3);
  assert.equal(index['7'].v.cover, true);
  assert.match(index['7'].v.at, /^\d{4}-\d\d-\d\dT/);
  assert.deepEqual(await (await call('films/?ids=7,8')).json(), { 7: ['v'] });
  assert.equal((await call('films/7-v.mp4', { method: 'DELETE' })).status, 403);
  assert.equal((await call('films/7-v.mp4', { method: 'DELETE', headers: { 'x-media-key': 'key' } })).status, 200);
  index = await (await call('films/index.json')).json();
  assert.deepEqual(index, {});
  assert.equal((await call('films/index.json', { method: 'POST', body: '{}' })).status, 405, 'the index is never written from outside');
});
