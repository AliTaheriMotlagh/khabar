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
        { name: 'امروز در یک نگاه', short_name: 'امروز', description: 'خبرهای امروز، پشت سر هم مثل یک ویدیو', url: url('today/?source=pwa') },
        { name: 'خبرهای نخوانده', short_name: 'نخوانده', url: url('today/?s=unseen&source=pwa') },
        { name: 'ذخیره‌شده‌ها', url: url('saved/') },
        { name: 'جستجو', url: url('search/') },
        { name: 'پروفایل من', url: url('me/') },
      ],
    }),
    { headers: { 'Content-Type': 'application/manifest+json' } },
  );
}
