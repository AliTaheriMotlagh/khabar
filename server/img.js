// GET /api/img/?u=<image url>&w=<width> | ?p=<post>&i=<n>[&f=poster|preview]&w=<width> → the picture, resized to WebP.
// Most readers are in Iran: Telegram's and X's CDNs are filtered there, and connections to other foreign hosts (even
// Cloudflare's, where the wsrv.nl image proxy lives) stall when a browser multiplexes requests over them. The site's
// own domain is the one address known to work for anyone reading it, so pictures come through here first
// (src/lib/posts.ts, picture()): fetched server-side through wsrv.nl, which resizes and converts them (the original if
// it can't), and CDN-cached for good — one function call per picture and width, however many readers see it.
// Only the CDNs the channel's media live on (u=), or a post's Telegram media by index (the same lookup as
// /api/media), so this is not an open proxy; widths are the three the site uses, so the cache can't be flooded.
import { fail } from './_lib.js';
import { currentUrl, mediaParams } from './media.js';

const HOSTS = /^https:\/\/(pbs\.twimg\.com|[\w-]+\.telesco\.pe|i\.ytimg\.com)\//;
const WIDTHS = ['320', '800', '1400'];
const MAX = 15 * 1024 * 1024;
const resized = (url, w) => `https://wsrv.nl/?url=${encodeURIComponent(url)}&w=${w}&we&output=webp&q=80`;

async function picture(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; khabar)' }, signal: AbortSignal.timeout(8000) });
    const type = res.headers.get('content-type') ?? '';
    const size = Number(res.headers.get('content-length') ?? 0);
    if (res.ok && res.body && /^image\//.test(type) && size <= MAX) return { res, type, size };
    return { status: res.status === 404 ? 404 : /^image\//.test(type) || !res.ok ? 502 : 415 };
  } catch {
    return { status: 502 };
  }
}

export async function GET(request) {
  const q = new URL(request.url).searchParams;
  const w = WIDTHS.includes(q.get('w')) ? q.get('w') : null;
  let url = q.get('u');
  if (url) {
    if (!HOSTS.test(url)) return fail(request, 403, 'host not allowed');
  } else {
    const params = mediaParams(q);
    if (!params) return fail(request, 400, 'bad request');
    const found = await currentUrl(params);
    if (found.error) return fail(request, 502, 'telegram unreachable');
    if (!found.url) return fail(request, 404, 'no such media');
    url = found.url;
  }
  // Resized first; the original when the resizer can't get it.
  let got = w ? await picture(resized(url, w)) : { status: 0 };
  if (!got.res) got = await picture(url);
  if (!got.res) return fail(request, got.status, 'no picture');
  return new Response(got.res.body, {
    headers: {
      'Content-Type': got.type,
      ...(got.size ? { 'Content-Length': String(got.size) } : {}),
      'Cache-Control': 'public, max-age=86400, s-maxage=31536000, immutable',
      'Access-Control-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
