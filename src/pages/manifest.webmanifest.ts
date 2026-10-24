import { SITE } from '../site';
import { url } from '../lib/posts';

export function GET() {
  return new Response(
    JSON.stringify({
      name: SITE.name,
      short_name: SITE.name,
      description: SITE.description,
      lang: 'fa',
      dir: 'rtl',
      start_url: url(),
      scope: url(),
      display: 'standalone',
      background_color: '#f7f7f4',
      theme_color: SITE.themeColor,
      icons: [
        { src: url('icon-192.png'), sizes: '192x192', type: 'image/png' },
        { src: url('icon-512.png'), sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
      ],
    }),
    { headers: { 'Content-Type': 'application/manifest+json' } },
  );
}
