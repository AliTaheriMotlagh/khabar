import rss from '@astrojs/rss';
import { SITE } from '../site';
import { abs, getPosts, sized } from '../lib/posts';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function GET() {
  return rss({
    title: SITE.name,
    description: SITE.description,
    site: abs(''),
    customData: `<language>fa-IR</language><image><url>${abs('icon-512.png')}</url><title>${SITE.name}</title><link>${abs('')}</link></image>`,
    items: getPosts().slice(0, 50).map((p) => {
      const cover = p.cover ? sized(p.cover.src || p.cover.poster, 'medium') : null;
      return {
        title: p.article.title,
        link: abs(`p/${p.id}/`),
        pubDate: new Date(p.date),
        description: p.excerpt || p.article.title,
        categories: p.article.tags,
        enclosure: cover ? { url: cover, type: 'image/jpeg', length: 0 } : undefined,
        content:
          (cover ? `<p><img src="${esc(cover)}" alt=""/></p>` : '') +
          p.article.body.map((t) => `<p>${esc(t)}</p>`).join('') +
          (p.article.why ? `<p><strong>چرا مهمه؟</strong> ${esc(p.article.why)}</p>` : '') +
          (p.source ? `<p><a href="${esc(p.source.url)}">منبع</a></p>` : ''),
      };
    }),
  });
}
