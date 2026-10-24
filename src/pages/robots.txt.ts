import { abs } from '../lib/posts';

export function GET() {
  return new Response(
    ['User-agent: *', 'Allow: /', 'Disallow: /api/', '', `Sitemap: ${abs('sitemap-index.xml')}`, `Sitemap: ${abs('news-sitemap.xml')}`, ''].join('\n'),
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  );
}
