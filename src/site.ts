// Site identity — edit these to rebrand. Everything else is generated from the channel.
export const SITE = {
  name: 'فیوچر فوکوس',
  nameLatin: 'Future Focus',
  // Primary address: canonical URLs, sitemap and social cards always point here (the GitHub Pages copy is a mirror).
  url: 'https://blog.remixt.app',
  tagline: 'اخبار هوش مصنوعی و فناوری، ساده و خودمونی',
  description:
    'تازه‌ترین اخبار هوش مصنوعی، فناوری و آینده از کانال «Future Focus with Mehrzad» — با ترجمه‌ی فارسی و خودمونی داش غلام، تصویر و ویدیو، و پیوند به منبع اصلی.',
  channel: 'dlmehr',
  owner: { name: 'مهرزاد صمدی', nameLatin: 'Mehrzad Samadi', url: 'https://mehrzad.ai/' },
  // Who built this site (credited in the footer).
  author: { name: 'علی طاهری مطلق', nameLatin: 'Ali Taheri Motlagh', url: 'https://alitaherimotlagh.vercel.app/' },
  // The site's source code (footer and about page).
  repo: 'https://github.com/AliTaheriMotlagh/khabar',
  gholam: 'داش غلام',
  timeZone: 'Asia/Tehran',
  pageSize: 20,
  themeColor: '#2f4fd8',
  // IndexNow (Bing, Yandex, Seznam, Naver…): new stories are announced the moment they're live (scripts/notify.mjs).
  // Not a secret — the engines check it at /<key>.txt, which must hold the same text (tests/seo.test.mjs).
  indexNowKey: 'a2e8b0f25f1440184512d4968ba8125c',
  // Guest comments, reactions, chat and live counters (Vercel Functions in /api). Empty = same origin.
  api: (import.meta.env.PUBLIC_API_URL ?? '').replace(/\/$/, ''),
};
