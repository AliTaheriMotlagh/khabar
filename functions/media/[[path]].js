// /media/*: the films everyone can watch, in R2 (bucket khabar-media, binding MEDIA in wrangler.toml), served from the
// site's own domain — readers in Iran reach it as they reach the site (an r2.dev address may be filtered).
//   GET  /media/films/<id>-<shape>.mp4         the film (ranges for seeking), cached at the edge
//   GET  /media/films/?ids=1,2,3               which of these stories have a public film: { "<id>": ["h","v"], … }
//   POST /media/films/<id>-<shape>.mp4         publish one: the body is the MP4 made on a reader's device (the video
//                                              sheet's «انتشار برای همه») or by the runner (scripts/films.mjs)
//   DELETE /media/films/<id>-<shape>.mp4       owner only (x-media-key = MEDIA_KEY)
// A reader's upload is checked as far as a server can without watching it: an MP4 (its `ftyp` box), ≤ 40 MB, for a
// story the site has, a few an hour per reader, and only where no film is published yet — the runner's (or the
// owner's) replaces any. Each object keeps who made it (`by`), so the owner can find and remove a reader's.
import { configured, limited } from '../../server/_lib.js';

const KEY = /^films\/(\d{1,8})-([hvs])\.mp4$/;
const MAX = 40 * 1024 * 1024;
const SHAPES = ['h', 'v', 's'];
const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', ...extra } });

export async function onRequest(ctx) {
  const { request, env } = ctx;
  if (!env.MEDIA) return json({ error: 'storage not configured' }, 501);
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/media\//, '');
  const owner = !!env.MEDIA_KEY && request.headers.get('x-media-key') === env.MEDIA_KEY;

  if (path === 'films/' || path === 'films') {
    if (request.method !== 'GET') return json({ error: 'method' }, 405);
    const ids = (url.searchParams.get('ids') ?? '').split(',').filter((x) => /^\d{1,8}$/.test(x)).slice(0, 60);
    const heads = await Promise.all(ids.flatMap((id) => SHAPES.map((s) => env.MEDIA.head(`films/${id}-${s}.mp4`).then((o) => (o ? [id, s] : null)))));
    const have = {};
    for (const h of heads) if (h) (have[h[0]] ??= []).push(h[1]);
    return json(have, 200, { 'cache-control': 'public, max-age=30, s-maxage=60' });
  }

  const m = path.match(KEY);
  if (!m) return json({ error: 'not found' }, 404);

  if (request.method === 'GET' || request.method === 'HEAD') {
    const cache = caches.default;
    const range = request.headers.get('range');
    if (!range && request.method === 'GET') {
      const hit = await cache.match(request);
      if (hit) return hit;
    }
    const obj = await env.MEDIA.get(path, range ? { range: request.headers } : {});
    if (!obj) return json({ error: 'not found' }, 404, { 'cache-control': 'public, max-age=30' });
    const headers = new Headers({
      'content-type': 'video/mp4',
      'accept-ranges': 'bytes',
      etag: obj.httpEtag,
      // A film may be replaced by a better one (the runner's): an hour at the edge, revalidated after.
      'cache-control': 'public, max-age=600, s-maxage=3600',
      'access-control-allow-origin': '*',
      'x-made-by': obj.customMetadata?.by ?? 'unknown',
    });
    if (range && obj.range) {
      const { offset = 0, length = obj.size - offset } = obj.range;
      headers.set('content-range', `bytes ${offset}-${offset + length - 1}/${obj.size}`);
      headers.set('content-length', String(length));
      return new Response(request.method === 'HEAD' ? null : obj.body, { status: 206, headers });
    }
    headers.set('content-length', String(obj.size));
    const res = new Response(request.method === 'HEAD' ? null : obj.body, { headers });
    if (request.method === 'GET') ctx.waitUntil(cache.put(request, res.clone()).catch(() => {}));
    return res;
  }

  if (request.method === 'DELETE') {
    if (!owner) return json({ error: 'forbidden' }, 403);
    await env.MEDIA.delete(path);
    return json({ ok: true });
  }

  if (request.method === 'POST' || request.method === 'PUT') {
    const size = Number(request.headers.get('content-length') ?? 0);
    if (!size || size > MAX) return json({ error: 'size' }, 413);
    if (!/^video\/mp4\b/.test(request.headers.get('content-type') ?? '')) return json({ error: 'type' }, 415);
    // A story the site has.
    const card = await fetch(`${url.origin}/p/${m[1]}/card.json`);
    if (!card.ok) return json({ error: 'no such story' }, 404);
    if (!owner) {
      if (await env.MEDIA.head(path)) return json({ error: 'exists' }, 409);
      if (configured() && (await limited(request, ['film', 4, 3600], ['film-day', 12, 86400]).catch(() => false))) return json({ error: 'slow down' }, 429);
    }
    const body = new Uint8Array(await request.arrayBuffer());
    if (body.length !== size || body.length < 1024) return json({ error: 'size' }, 400);
    // An MP4 starts with its `ftyp` box.
    if (String.fromCharCode(...body.subarray(4, 8)) !== 'ftyp') return json({ error: 'not an mp4' }, 415);
    await env.MEDIA.put(path, body, {
      httpMetadata: { contentType: 'video/mp4' },
      customMetadata: { by: owner ? request.headers.get('x-made-by') || 'runner' : 'reader', at: new Date().toISOString() },
    });
    await caches.default.delete(new Request(`${url.origin}/media/${path}`)).catch(() => {});
    return json({ ok: true, url: `/media/${path}` }, 201);
  }
  return json({ error: 'method' }, 405);
}
