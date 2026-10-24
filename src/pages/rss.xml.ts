import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { SITE } from '../site';
import { getPosts, url } from '../lib/posts';

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

export function GET(context: APIContext) {
  const abs = (p: string) => new URL(url(p), context.site).href;
  return rss({
    title: SITE.name,
    description: SITE.description,
    site: abs(''),
    customData: '<language>fa-IR</language>',
    items: getPosts().slice(0, 50).map((p) => ({
      title: p.article.title,
      link: abs(`p/${p.id}/`),
      pubDate: new Date(p.date),
      description: p.excerpt,
      categories: p.article.tags,
      content:
        (p.cover ? `<p><img src="${abs(p.cover.src)}" alt=""/></p>` : '') +
        p.article.body.map((t) => `<p>${esc(t)}</p>`).join('') +
        (p.article.why ? `<p><strong>چرا مهمه؟</strong> ${esc(p.article.why)}</p>` : ''),
    })),
  });
}
