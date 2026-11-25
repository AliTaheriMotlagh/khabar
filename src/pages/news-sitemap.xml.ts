// Google News sitemap: articles from the last two days (https://developers.google.com/search/docs/crawling-indexing/sitemaps/news-sitemap),
// the Persian stories and their English pages (each its own language; the pair linked with xhtml:link hreflang).
import { SITE } from '../site';
import { abs, getFeed } from '../lib/posts';
import { EN, enOf } from '../lib/en';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function GET() {
  const cutoff = Date.now() - 2 * 864e5;
  const items = getFeed().filter((p) => new Date(p.date).getTime() > cutoff);
  const pair = (fa: string, en: string | null) =>
    en ? `<xhtml:link rel="alternate" hreflang="fa" href="${fa}"/><xhtml:link rel="alternate" hreflang="en" href="${en}"/>` : '';
  const body = items
    .flatMap((p) => {
      const e = p.kind === 'digest' ? null : enOf(p.id);
      const fa = abs(`p/${p.id}/`);
      const en = e ? abs(`en/p/${e.id}/`) : null;
      const out = [
        `<url><loc>${fa}</loc>${pair(fa, en)}<news:news><news:publication><news:name>${esc(SITE.name)}</news:name><news:language>fa</news:language></news:publication><news:publication_date>${p.date}</news:publication_date><news:title>${esc(p.article.title)}</news:title></news:news></url>`,
      ];
      if (e && en)
        out.push(
          `<url><loc>${en}</loc>${pair(fa, en)}<news:news><news:publication><news:name>${esc(EN.name)}</news:name><news:language>en</news:language></news:publication><news:publication_date>${e.date}</news:publication_date><news:title>${esc(e.title)}</news:title></news:news></url>`,
        );
      return out;
    })
    .join('');
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${body}</urlset>`,
    { headers: { 'Content-Type': 'application/xml; charset=utf-8' } },
  );
}
