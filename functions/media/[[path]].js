// /media/*: the films everyone can watch, in R2 (bucket khabar-media, binding MEDIA in wrangler.toml), served from the
// site's own domain — readers in Iran reach it as they reach the site (an r2.dev address may be filtered).
//   GET  /media/films/<id>-<shape>.mp4         the film (ranges for seeking), cached at the edge
//   GET  /media/films/?ids=1,2,3               which of these stories have a public film: { "<id>": ["h","v"], … }
//   POST /media/films/<id>-<shape>.mp4         publish one: the body is the MP4 made on a reader's device (the video
//                                              sheet's «انتشار برای همه») or by the runner (scripts/films.mjs)
//   GET  /media/films/?ids=1,2,3&meta=1        the same with each film's length and cover: { "<id>": { "h": { "sec": 74.2,
//                                              "cover": true } } } (the cinema's list)
//   POST /media/films/<id>-<shape>.jpg         the film's cover (its designed first frame, JPEG ≤ 600 KB), with the film or
//                                              after it — only while the film is there; `x-seconds` on the film's POST is kept
//   DELETE /media/films/<id>-<shape>.mp4       owner only (x-media-key = MEDIA_KEY)
// A reader's upload is checked as far as a server can without watching it: an MP4 (its `ftyp` box), ≤ 40 MB, for a
// story the site has, a few an hour per reader, and only where no film is published yet — the runner's (or the
// owner's) replaces any. Each object keeps who made it (`by`), so the owner can find and remove a reader's.
import { configured, limited } from '../../server/_lib.js';

const KEY = /^films\/(\d{1,8})-([hvs])\.(mp4|jpg)$/;
// The podcast's episodes (scripts/podcast.mjs): the MP3 and its timed lines; only the owner's key publishes them.
const POD = /^podcast\/(\d{4}-\d{2}-\d{2})\.(mp3|json)$/;
const TYPES = { mp3: 'audio/mpeg', json: 'application/json; charset=utf-8', mp4: 'video/mp4', jpg: 'image/jpeg' };
const COVER_MAX = 600 * 1024;
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
    const meta = url.searchParams.has('meta');
    const heads = await Promise.all(
      ids.flatMap((id) =>
        SHAPES.map(async (s) => {
          const o = await env.MEDIA.head(`films/${id}-${s}.mp4`);
          if (!o) return null;
          const cover = meta ? !!(await env.MEDIA.head(`films/${id}-${s}.jpg`)) : false;
          return [id, s, { sec: Number(o.customMetadata?.sec) || null, cover }];
        }),
      ),
    );
    const have = {};
    for (const h of heads) if (h) meta ? ((have[h[0]] ??= {})[h[1]] = h[2]) : (have[h[0]] ??= []).push(h[1]);
    return json(have, 200, { 'cache-control': 'public, max-age=30, s-maxage=60' });
  }

  const pod = path.match(POD);
  const m = path.match(KEY);
  if (!m && !pod) return json({ error: 'not found' }, 404);
  const type = TYPES[path.split('.').pop()];

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
      'content-type': type,
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
    // A film goes with its cover.
    await env.MEDIA.delete(m?.[3] === 'mp4' ? [path, path.replace(/\.mp4$/, '.jpg')] : path);
    return json({ ok: true });
  }

  if ((request.method === 'POST' || request.method === 'PUT') && pod) {
    if (!owner) return json({ error: 'forbidden' }, 403);
    const body = new Uint8Array(await request.arrayBuffer());
    if (!body.length || body.length > 80 * 1024 * 1024) return json({ error: 'size' }, 413);
    await env.MEDIA.put(path, body, { httpMetadata: { contentType: type }, customMetadata: { by: 'runner', at: new Date().toISOString() } });
    await caches.default.delete(new Request(`${url.origin}/media/${path}`)).catch(() => {});
    return json({ ok: true, url: `/media/${path}` }, 201);
  }

  if ((request.method === 'POST' || request.method === 'PUT') && m[3] === 'jpg') {
    const size = Number(request.headers.get('content-length') ?? 0);
    if (!size || size > COVER_MAX) return json({ error: 'size' }, 413);
    if (!/^image\/jpeg\b/.test(request.headers.get('content-type') ?? '')) return json({ error: 'type' }, 415);
    // Only a published film's cover, and a reader's only where none is there yet.
    if (!(await env.MEDIA.head(`films/${m[1]}-${m[2]}.mp4`))) return json({ error: 'no such film' }, 404);
    if (!owner) {
      if (await env.MEDIA.head(path)) return json({ error: 'exists' }, 409);
      if (configured() && (await limited(request, ['cover', 6, 3600]).catch(() => false))) return json({ error: 'slow down' }, 429);
    }
    const body = new Uint8Array(await request.arrayBuffer());
    if (body.length !== size || body[0] !== 0xff || body[1] !== 0xd8) return json({ error: 'not a jpeg' }, 415);
    await env.MEDIA.put(path, body, { httpMetadata: { contentType: 'image/jpeg' }, customMetadata: { by: owner ? 'runner' : 'reader', at: new Date().toISOString() } });
    await caches.default.delete(new Request(`${url.origin}/media/${path}`)).catch(() => {});
    return json({ ok: true, url: `/media/${path}` }, 201);
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
      customMetadata: {
        by: owner ? request.headers.get('x-made-by') || 'runner' : 'reader',
        at: new Date().toISOString(),
        ...(Number(request.headers.get('x-seconds')) > 0 && { sec: String(Math.round(Number(request.headers.get('x-seconds')) * 10) / 10) }),
      },
    });
    await caches.default.delete(new Request(`${url.origin}/media/${path}`)).catch(() => {});
    return json({ ok: true, url: `/media/${path}` }, 201);
  }
  return json({ error: 'method' }, 405);
}
