import { abs } from '../lib/posts';

// Every crawler is welcome (search engines and AI assistants alike: the site wants to be found and quoted); the API,
// the owner's page and the small JSON files the pages read are not content.
export function GET() {
  return new Response(
    [
      'User-agent: *',
      'Allow: /',
      'Disallow: /api/',
      'Disallow: /admin/',
      'Disallow: /studio/',
      'Disallow: /p/*/card.json',
      'Disallow: /build.json',
      'Disallow: /recent.json',
      'Disallow: /ai.json',
      'Disallow: /investigate.json',
      // The explorer's searches (/investigate/?q=…) are one page each to a crawler, all with the same canonical: not content.
      'Disallow: /*?q=',
      // The English edition (/en/) is content like the rest: its pages are in the same sitemaps, paired by hreflang.
      'Allow: /en/',
      '',
      `Sitemap: ${abs('sitemap-index.xml')}`,
      `Sitemap: ${abs('news-sitemap.xml')}`,
      '',
    ].join('\n'),
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  );
}
