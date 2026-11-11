// GET /api/toprss (also /rss/top.xml, vercel.json) → RSS 2.0 of the week's most viewed stories, most viewed first.
// Views from _stats.js; each story's headline, text and picture from its card.json on the site (TTS_SOURCE, else this
// deployment). Cached on the CDN for an hour.
import { configured, fail, preflight } from './_lib.js';
import { readStats } from './_stats.js';

export const OPTIONS = preflight;
const SITE_NAME = 'فیوچر فوکوس';
const xml = (s) => String(s ?? '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F￾￿]/g, '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export async function GET(request) {
  if (!configured()) return fail(request, 503, 'not configured');
  const origin = new URL(request.url).origin;
  const site = (process.env.SITE_URL || origin).replace(/\/$/, '');
  const source = process.env.TTS_SOURCE || origin;
  const { top } = await readStats(15);
  const cards = await Promise.all(
    top.week.map((t) =>
      fetch(new URL(`/p/${t.id}/card.json`, source), { signal: AbortSignal.timeout(5000) })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ),
  );
  const abs = (u) => (u && u.startsWith('/') ? `${site}${u}` : u);
  const items = top.week
    .map((t, i) => [t, cards[i]])
    .filter(([, c]) => c)
    .map(([t, c], rank) => {
      const link = `${site}/p/${c.id}/`;
      const text = (c.body ?? []).find((p) => p && p !== c.title) ?? c.why ?? '';
      return `<item><title>${xml(c.title)}</title><link>${xml(link)}</link><guid isPermaLink="true">${xml(link)}</guid>` +
        `<pubDate>${new Date(c.date).toUTCString()}</pubDate>` +
        (c.tag ? `<category>${xml(c.tag)}</category>` : '') +
        `<description>${xml(`${(rank + 1).toLocaleString('fa-IR')}. ${t.views.toLocaleString('fa-IR')} بازدید این هفته — ${text}`)}</description>` +
        (c.cover ? `<media:thumbnail url="${xml(abs(c.cover))}"/>` : '') +
        `</item>`;
    })
    .join('');
  const body =
    `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/"><channel>` +
    `<title>${xml(`${SITE_NAME} — پربازدیدترین‌های هفته`)}</title><link>${xml(`${site}/week/`)}</link>` +
    `<description>${xml(`خبرهایی از ${SITE_NAME} که در هفت روز گذشته بیشتر از همه خوانده شده‌اند.`)}</description>` +
    `<language>fa-IR</language><ttl>60</ttl><atom:link href="${xml(`${site}/rss/top.xml`)}" rel="self" type="application/rss+xml"/>` +
    `<lastBuildDate>${new Date().toUTCString()}</lastBuildDate>${items}</channel></rss>`;
  return new Response(body, {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=21600', 'Access-Control-Allow-Origin': '*' },
  });
}
