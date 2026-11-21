// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// The primary site is https://blog.remixt.app (see src/site.ts). The GitHub Pages workflow builds a mirror
// with SITE_URL / BASE_PATH (e.g. https://you.github.io + /khabar); canonical URLs still point at the primary site.
const PRIMARY = 'https://blog.remixt.app';

// The sitemap tells search engines when each story last changed and shows them its picture (Google Images), read
// straight from data/ (the config can't use src/lib/posts.ts). Pictures on Telegram's/X's filtered CDNs go through the
// site's relay on the primary domain, as in the feeds (posts.ts feedPicture): Telegram's own addresses expire.
function seoIndex() {
  const dir = path.resolve('data/posts');
  const posts = new Map();
  let newest = 0;
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    if (!f.endsWith('.json')) continue;
    try {
      /** @type {any} */ const p = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      const at = Date.parse(p.updated || p.gholam?.date || p.date);
      if (Number.isNaN(at)) continue;
      newest = Math.max(newest, at);
      /** @type {any[]} */ const media = p.media ?? [];
      /** @type {any[]} */ const linkedMedia = (p.links ?? []).flatMap((/** @type {any} */ l) => l.media ?? []);
      const i = media.findIndex((m) => m.src || m.poster);
      const m = i >= 0 ? media[i] : null;
      const linked = linkedMedia.find((x) => x.src || x.poster);
      const still = m ? (m.type === 'video' ? m.poster : m.src) : linked ? (linked.type === 'video' ? linked.poster : linked.src) : null;
      let img = null;
      if (m && still && /telesco\.pe\//.test(still)) img = `${PRIMARY}/api/img/?p=${p.id}&i=${i}${m.type === 'video' ? '&f=poster' : ''}&w=1400`;
      else if (still && /^https:\/\/(pbs\.twimg\.com|i\.ytimg\.com)\//.test(still)) img = `${PRIMARY}/api/img/?u=${encodeURIComponent(still)}&w=1400`;
      posts.set(String(p.id), { at, img });
    } catch {}
  }
  const videos = new Map();
  try {
    const v = JSON.parse(fs.readFileSync(path.resolve('data/videos.json'), 'utf8'));
    for (const x of v.videos ?? v ?? []) if (x?.id) videos.set(x.id, { at: Date.parse(x.date) || newest, img: `${PRIMARY}/api/img/?u=${encodeURIComponent(x.thumb || `https://i.ytimg.com/vi/${x.id}/hqdefault.jpg`)}&w=1400` });
  } catch {}
  return { posts, videos, newest };
}
const seo = seoIndex();
const BASE = (process.env.BASE_PATH || '/').replace(/\/$/, ''); // the mirror's /khabar prefix, '' on the primary

export default defineConfig({
  site: process.env.SITE_URL || PRIMARY,
  base: process.env.BASE_PATH || '/',
  trailingSlash: 'always',
  build: { format: 'directory', inlineStylesheets: 'auto' },
  prefetch: { prefetchAll: false, defaultStrategy: 'hover' },
  integrations: [
    sitemap({
      filter: (page) => !/\/(saved|search|me|offline|admin)\/$/.test(page),
      serialize(item) {
        const p = new URL(item.url).pathname;
        const post = p.match(/\/p\/(\d+)\/$/)?.[1];
        const video = p.match(/\/videos\/([\w-]{11})\/$/)?.[1];
        const hit = post ? seo.posts.get(post) : video ? seo.videos.get(video) : null;
        if (hit) {
          item.lastmod = new Date(hit.at).toISOString();
          // Older stories rarely change; the newest week still gets Gholam's late edits.
          item.changefreq = /** @type {any} */ (Date.now() - hit.at < 7 * 864e5 ? 'daily' : 'monthly');
          if (hit.img) /** @type {any} */ (item).img = [{ url: hit.img }];
        } else if (/^\/(|today\/|tag\/[^/]+\/|videos\/|week\/|glossary\/|who\/[^/]+\/)$/.test(p.slice(BASE.length))) {
          // Lists that change with every new story.
          if (seo.newest) item.lastmod = new Date(seo.newest).toISOString();
          item.changefreq = /** @type {any} */ ('hourly');
        } else {
          // Older archive pages, and the site's own pages (about, feeds…).
          item.changefreq = /** @type {any} */ (/\/(page|tag\/[^/]+)\/\d+\/$/.test(p) ? 'daily' : 'weekly');
        }
        return item;
      },
    }),
  ],
});
