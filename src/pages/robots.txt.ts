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
      'Disallow: /p/*/card.json',
      'Disallow: /build.json',
      'Disallow: /recent.json',
      'Disallow: /ai.json',
      'Disallow: /investigate.json',
      '',
      `Sitemap: ${abs('sitemap-index.xml')}`,
      `Sitemap: ${abs('news-sitemap.xml')}`,
      '',
    ].join('\n'),
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  );
}
