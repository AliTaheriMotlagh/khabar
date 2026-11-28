// GET /api/clip/?u=<video.twimg.com MP4> | ?p=<post>&i=<n> → the story's own video, its bytes, readable by the page.
// A story's film (src/scripts/film.ts, src/scripts/footage.ts) shows the source's real footage under the narration:
// the browser decodes the MP4 with WebCodecs and draws its frames on the film's canvas, which it can only do with a
// file it may read (CORS) — X's and Telegram's CDNs don't say so, and both are filtered in Iran. So the clip comes
// through the site's own domain, as pictures do (server/img.js): only those two CDNs (or a post's Telegram media by
// index, the current signed URL, server/media.js), only MP4, at most MAX bytes; cached at the edge for a week
// (functions/_router.js), so one fetch per clip however many films are made of it.
import { fail } from './_lib.js';
import { currentUrl, mediaParams } from './media.js';

const HOSTS = /^https:\/\/(video\.twimg\.com|[\w-]+\.telesco\.pe)\//;
export const MAX = 40 * 1024 * 1024;

/** The clip's address from the query: { url } when it may be relayed, { status } otherwise. */
export async function clipUrl(q) {
  const u = q.get('u');
  if (u) return HOSTS.test(u) && !/\.m3u8(\?|$)/.test(u) ? { url: u } : { status: 403 };
  const params = mediaParams(q);
  if (!params || params.field !== 'src') return { status: 400 };
  const found = await currentUrl(params);
  if (found.error) return { status: 502 };
  return found.url ? { url: found.url } : { status: 404 };
}

export async function GET(request) {
  const q = new URL(request.url).searchParams;
  const { url, status } = await clipUrl(q);
  if (!url) return fail(request, status, 'no clip');
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; khabar)' }, signal: AbortSignal.timeout(15000) });
  } catch {
    return fail(request, 502, 'source unreachable');
  }
  const type = res.headers.get('content-type') ?? '';
  const size = Number(res.headers.get('content-length') ?? 0);
  if (!res.ok || !res.body) return fail(request, res.status === 404 ? 404 : 502, 'no clip');
  if (!/^video\/mp4\b|^application\/octet-stream\b/.test(type)) return fail(request, 415, 'not an mp4');
  if (!size || size > MAX) return fail(request, 413, 'too large');
  return new Response(res.body, {
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': String(size),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=86400, s-maxage=604800',
      'Access-Control-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
