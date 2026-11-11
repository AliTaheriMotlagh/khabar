// api/router.js is the site's only Vercel Function (the Hobby plan fails a deployment with more than 12).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

process.env.KHABAR_MEMORY_STORE = '1';
const router = await import('../api/router.js');

test('router: api/ holds one function, and every server route is listed in it', () => {
  const fns = fs.readdirSync('api').filter((f) => !f.startsWith('_') && !f.startsWith('.'));
  assert.deepEqual(fns, ['router.js'], 'a new file in api/ is another Vercel Function: add routes to server/ and api/router.js instead');
  const routes = fs.readdirSync('server').filter((f) => f.endsWith('.js') && !f.startsWith('_')).map((f) => f.slice(0, -3));
  assert.deepEqual(Object.keys(router.routes).sort(), routes.sort());
});

test('router: by path, or by the `route` the rewrite adds, 404 and 405', async () => {
  const req = (url, method = 'GET') => new Request(url, { method });
  assert.equal(router.routeOf(req('https://x.test/api/stats/')), router.routes.stats);
  assert.equal(router.routeOf(req('https://x.test/api/comments?post=1')), router.routes.comments);
  assert.equal(router.routeOf(req('https://x.test/rss/top.xml?route=toprss')), router.routes.toprss);
  assert.equal(router.routeOf(req('https://x.test/api/router/?route=live&post=3')), router.routes.live);
  assert.equal(router.routeOf(req('https://x.test/api/_lib/')), null);
  assert.equal(router.routeOf(req('https://x.test/api/hasOwnProperty/')), null);
  assert.equal((await router.GET(req('https://x.test/api/nope/'))).status, 404);
  const res = await router.PUT(req('https://x.test/api/stats/', 'PUT'));
  assert.equal(res.status, 405);
  assert.match(res.headers.get('allow'), /GET/);
  assert.equal((await router.GET(req('https://x.test/api/stats/'))).status, 200);
});
