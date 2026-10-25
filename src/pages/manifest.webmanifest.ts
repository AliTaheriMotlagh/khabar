import { SITE } from '../site';
import { url } from '../lib/posts';

export function GET() {
  return new Response(
    JSON.stringify({
      id: url(),
      name: `${SITE.name} — ${SITE.nameLatin}`,
      short_name: SITE.name,
      description: SITE.description,
      lang: 'fa',
      dir: 'rtl',
      start_url: `${url()}?source=pwa`,
      scope: url(),
      display: 'standalone',
      background_color: '#f5f6fa',
      theme_color: SITE.themeColor,
      categories: ['news', 'technology'],
      icons: [
        { src: url('icon-192.png'), sizes: '192x192', type: 'image/png' },
        { src: url('icon-512.png'), sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
      ],
      shortcuts: [
        { name: 'استوری خبرها', short_name: 'استوری', description: 'خبرهای تازه، موضوع به موضوع مثل استوری، از همان جا که ماندید', url: url('today/?source=pwa') },
        { name: 'ذخیره‌شده‌ها', url: url('saved/') },
        { name: 'جستجو', url: url('search/') },
        { name: 'پروفایل من', url: url('me/') },
      ],
    }),
    { headers: { 'Content-Type': 'application/manifest+json' } },
  );
}
