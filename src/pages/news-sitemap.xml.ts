// Google News sitemap: articles from the last two days (https://developers.google.com/search/docs/crawling-indexing/sitemaps/news-sitemap).
import { SITE } from '../site';
import { abs, getPosts } from '../lib/posts';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function GET() {
  const cutoff = Date.now() - 2 * 864e5;
  const items = getPosts().filter((p) => new Date(p.date).getTime() > cutoff);
  const body = items
    .map(
      (p) => `<url><loc>${abs(`p/${p.id}/`)}</loc><news:news><news:publication><news:name>${esc(SITE.name)}</news:name><news:language>fa</news:language></news:publication><news:publication_date>${p.date}</news:publication_date><news:title>${esc(p.article.title)}</news:title></news:news></url>`,
    )
    .join('');
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">${body}</urlset>`,
    { headers: { 'Content-Type': 'application/xml; charset=utf-8' } },
  );
}
