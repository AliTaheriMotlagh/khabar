// GET /api/media/?p=<post>&i=<n>[&f=poster] → 302 to a freshly signed Telegram CDN URL for that post's n-th media item;
// &f=preview → its link preview's picture (Telegram hosts those too, and they are many posts' cover).
// Telegram signs its CDN URLs and they expire; the crawler re-reads only the newest pages, so an older post's stored
// URL can stop working. When a Telegram image or video fails, the page asks here: this reads the post's public embed
// (from Vercel, where t.me is reachable) and points the browser at the current URL. No storage, CDN-cached for an hour.
// Order matches pipeline/telegram.py (_parse_message): every photo, then every video (a "too big" video = its thumbnail).
import { fail, postId, preflight } from './_lib.js';

const CHANNEL = process.env.TG_CHANNEL || 'dlmehr';
const CDN = /^https:\/\/[\w.-]*telesco\.pe\//;
const BG = /background-image:\s*url\(['"]?([^'")]+)['"]?\)/;

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'");

/** [{ src, poster }] in the crawler's order, from a post's embed HTML. */
export function parseMedia(html) {
  const photos = [...html.matchAll(/<a[^>]*class="[^"]*tgme_widget_message_photo_wrap[^"]*"[^>]*>/g)]
    .map((m) => m[0].match(BG)?.[1])
    .filter(Boolean)
    .map((src) => ({ src: decode(src), poster: null }));
  // Each video player runs up to the next player (or the end): its thumbnail and <video> are inside.
  const parts = html.split(/(?=<[a-z]+[^>]*class="[^"]*tgme_widget_message_(?:round)?video_player)/).slice(1);
  const videos = parts
    .map((part) => {
      const thumb = part.match(/class="[^"]*tgme_widget_message_(?:round)?video_thumb[^"]*"[^>]*style="([^"]*)"/)?.[1].match(BG)?.[1];
      const src = part.match(/<video[^>]*\ssrc="([^"]+)"/)?.[1];
      const poster = thumb ? decode(thumb) : null;
      return src ? { src: decode(src), poster } : poster ? { src: poster, poster: null } : null;
    })
    .filter(Boolean);
  return [...photos, ...videos];
}

/** The link preview's picture (pipeline: .link_preview_image / .link_preview_right_image), if any. */
export function parsePreview(html) {
  const tag = html.match(/<[a-z]+[^>]*class="[^"]*link_preview_(?:right_)?image[^"]*"[^>]*>/)?.[0];
  const url = tag?.match(BG)?.[1];
  return url ? decode(url) : null;
}

const done = (request, status, headers = {}) =>
  new Response(null, { status, headers: { 'Access-Control-Allow-Origin': '*', ...headers } });

export const OPTIONS = preflight;

/** Parses ?p=<post>&i=<n>&f=<field> → { post, i, field }, or null when malformed. */
export function mediaParams(q) {
  const post = postId(q.get('p'));
  const i = /^\d{1,2}$/.test(q.get('i') ?? '') ? Number(q.get('i')) : null;
  const field = ['poster', 'preview'].includes(q.get('f')) ? q.get('f') : 'src';
  return !post || (i == null && field !== 'preview') ? null : { post, i, field };
}

/** The current Telegram CDN URL of a post's media item: { url } (null when the post has no such item), or { error }
 *  when t.me couldn't be read. Shared with /api/img, which fetches the bytes instead of redirecting. */
export async function currentUrl({ post, i, field }) {
  let html;
  try {
    const res = await fetch(`https://t.me/${CHANNEL}/${post}?embed=1&mode=tme`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; khabar)' },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) throw new Error(`t.me ${res.status}`);
    html = await res.text();
  } catch {
    return { error: true };
  }
  const url = field === 'preview' ? parsePreview(html) : parseMedia(html)[i]?.[field];
  return { url: url && CDN.test(url) ? url : null };
}

export async function GET(request) {
  const params = mediaParams(new URL(request.url).searchParams);
  if (!params) return fail(request, 400, 'bad request');
  const { url, error } = await currentUrl(params);
  if (error) return done(request, 502, { 'Cache-Control': 'no-store' });
  // Not there (deleted post, edited album): say so for a while, so a broken image doesn't ask on every view.
  if (!url) return done(request, 404, { 'Cache-Control': 'public, max-age=0, s-maxage=600' });
  return done(request, 302, { Location: url, 'Cache-Control': 'public, max-age=1800, s-maxage=3600' });
}
