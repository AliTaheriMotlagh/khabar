import { feedRev, getFeed, picture } from '../lib/posts';

// The newest listed posts, small: what the workflow announces to readers with notifications on (scripts/notify.mjs
// reads it from the live site, so it only announces what readers can already open). `latest` is build.json's.
export function GET() {
  const feed = getFeed();
  const since = Date.parse(feed[0]?.date ?? '') - 3 * 864e5;
  const posts = feed
    .filter((p, i) => i < 40 || Date.parse(p.date) >= since)
    .slice(0, 120)
    .map((p) => ({
      id: p.id,
      title: p.article.title,
      href: p.href,
      date: p.date,
      kind: p.kind,
      tags: p.article.tags,
      thumb: p.cover ? picture(p.cover.src || p.cover.poster, 'small').src : null,
    }));
  return new Response(JSON.stringify({ latest: feedRev().latest, posts }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
