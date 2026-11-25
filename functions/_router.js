// Cloudflare Pages Functions: the same API as Vercel's api/router.js (server/<route>.js, Request → Response).
// Wrangler's env vars and secrets reach the server code through process.env (nodejs_compat, compatibility_date
// ≥ 2025-04-01 populates it). Files starting with `_` in functions/ are not routes.
//
// Vercel's CDN kept what the API marks `s-maxage` (engage's counts for 2 minutes, a relayed picture or a cloud-voice
// clip for a year); a Pages Function's answer isn't cached by itself, so without this every listen would be synthesized
// by Azure again (its free 500K characters a month) and every picture fetched through wsrv.nl again. The Cache API does
// it here, per data centre: a GET without credentials whose answer says `s-maxage` is stored, and served (ranges
// included — Safari plays audio only from a ranged answer) until it expires, without running the route again.
import { GET } from '../api/router.js';

const SHARED = /(?:^|,)\s*s-maxage=(\d+)/;

export async function cached(request, run, waitUntil = () => {}) {
  const cache = globalThis.caches?.default;
  if (!cache || request.method !== 'GET' || request.headers.has('authorization')) return run(request);
  const range = request.headers.get('range');
  const key = new Request(request.url, { method: 'GET' });
  const asked = range ? new Request(request.url, { method: 'GET', headers: { range } }) : key;
  const hit = await cache.match(asked).catch(() => undefined);
  if (hit) return hit;
  // The route always answers in full (a cached copy serves the ranges).
  const res = await run(range ? key : request);
  const ttl = Number(res.headers.get('cache-control')?.match(SHARED)?.[1] ?? 0);
  if (!ttl || (res.status !== 200 && res.status !== 302 && res.status !== 404) || res.headers.has('set-cookie')) return res;
  const store = cache.put(key, res.clone()).catch(() => {});
  if (!range) {
    waitUntil(store);
    return res;
  }
  await store;
  return (await cache.match(asked).catch(() => undefined)) ?? res;
}

export const onRequest = (ctx) => cached(ctx.request, GET, (p) => ctx.waitUntil(p));
