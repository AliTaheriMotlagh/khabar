import { feedPicture, feedRev, getFeed, picture } from '../lib/posts';

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
      // A few words (pipeline/ai.py): a notification listing several stories uses them.
      ...(p.short !== p.article.title && { short: p.short }),
      href: p.href,
      date: p.date,
      kind: p.kind,
      // Mehrzad's own video: announced in every notification mode (server/push.js).
      ...(p.type === 'ویدیوی مهرزاد' && { video: true }),
      // Topics first (a notification names the first); then who it's about, for readers who follow them (/who/).
      tags: [...p.article.tags, ...p.entities.slice(0, 3).map((e) => `who:${e.slug}`)],
      thumb: p.cover ? picture(p.cover.src || p.cover.poster, 'small').src : null,
      // The notification's picture (server/push.js): a lasting address the phone can reach from Iran, never a filtered CDN.
      ...(p.cover && feedPicture(p.cover.src || p.cover.poster, 'medium') && { image: feedPicture(p.cover.src || p.cover.poster, 'medium')!.url }),
    }));
  return new Response(JSON.stringify({ latest: feedRev().latest, posts }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
