// The English edition (/en/): the same news told with the real source text — the post's tweet, the article it links,
// the quoted post — never Gholam's Persian. A post whose source has no English text isn't in it. The headline is the
// model's English one (`ai.en`, pipeline/ai_en.py) when it has written it, else the linked article's own title, else
// the source's first sentence. Topics, types and statuses keep the Persian site's (the same data), named in English.
import { englishDigests, getStories, url, type Link, type Post } from './posts';
import { cleanUrl, citedLinks, langOf, publisherOf, sourceKind } from './source';
import { SITE } from '../site';

export const TOPIC_EN: Record<string, [string, string]> = {
  'آنتروپیک': ['Anthropic', 'anthropic'], 'اوپن‌ای‌آی': ['OpenAI', 'openai'], 'ایجنت': ['AI Agents', 'agents'], 'کدنویسی': ['Coding', 'coding'],
  'چین': ['China', 'china'], 'گوگل': ['Google', 'google'], 'امنیت': ['Security', 'security'], 'متن‌باز': ['Open Source', 'open-source'],
  'استارتاپ': ['Startups', 'startups'], 'رباتیک': ['Robotics', 'robotics'], 'علم': ['Science', 'science'], 'انویدیا': ['NVIDIA', 'nvidia'],
  'تراشه': ['Chips', 'chips'], 'کسب‌وکار': ['Business', 'business'], 'سلامت': ['Health', 'health'], 'ایلان ماسک': ['Elon Musk', 'elon-musk'],
  'متا': ['Meta', 'meta'], 'صدا و موسیقی': ['Voice & Music', 'voice-music'], 'سیاست و قانون': ['Policy & Law', 'policy'], 'اپل': ['Apple', 'apple'],
  'تصویر و ویدیو': ['Image & Video', 'image-video'], 'مایکروسافت': ['Microsoft', 'microsoft'], 'اشتغال': ['Jobs', 'jobs'], 'آمازون': ['Amazon', 'amazon'],
  'آموزش': ['Education', 'education'], 'گجت': ['Gadgets', 'gadgets'], 'فضا': ['Space', 'space'], 'شبکه‌های اجتماعی': ['Social Media', 'social-media'],
  'سرگرمی': ['Entertainment', 'entertainment'], 'رمزارز': ['Crypto', 'crypto'], 'کوانتوم': ['Quantum', 'quantum'], 'سامسونگ': ['Samsung', 'samsung'],
  'هوش مصنوعی': ['AI', 'ai'],
};
export const TYPE_EN: Record<string, string> = {
  'خبر': 'News', 'ابزار و محصول': 'Tools & Products', 'پژوهش و مقاله': 'Research', 'آموزش': 'Tutorials', 'نظر و تحلیل': 'Opinion & Analysis', 'ویدیوی مهرزاد': "Mehrzad's Videos",
};
export const STATUS_EN: Record<string, { label: string; title: string; cls: string }> = {
  'رسمی': { label: 'Official', title: 'Announced by the company or maker itself', cls: 'is-official' },
  'گزارش': { label: 'Reported', title: 'Reported by a newsroom or analyst; the maker has not said it yet', cls: 'is-report' },
  'شایعه': { label: 'Unconfirmed', title: 'A leak or a claim nobody has officially confirmed yet', cls: 'is-rumor' },
};
export const enTopic = (fa: string) => (TOPIC_EN[fa] ? { fa, en: TOPIC_EN[fa][0], slug: TOPIC_EN[fa][1] } : null);
export const enTopicHref = (slug: string) => url(`en/topic/${slug}/`);

export type EnPost = {
  id: number;
  href: string;
  /** The Persian page of the same post. */
  faHref: string;
  title: string;
  short: string;
  body: string[];
  quote: { author: string; text: string } | null;
  excerpt: string;
  /** Who said it: the tweet's author («Reuters (@Reuters)») or the publisher. */
  by: string;
  publisher: string;
  /** The original post or article. */
  sourceUrl: string;
  cited: string[];
  lang: string;
  date: string;
  post: Post;
  topics: { fa: string; en: string; slug: string }[];
  type: string | null;
  status: (typeof STATUS_EN)[string] | null;
  minutes: number;
};

const WALL = /^\s*(?:-\s*)?YouTube\s*$|^Before you continue|^X - The Everything App|^(Log in|Sign up) /i;
const URLS = /https?:\/\/\S+/g;
const clean = (s: string) => s.replace(URLS, '').replace(/[ \t]+/g, ' ').replace(/\s+([.,;:!?])/g, '$1').trim();
const clip = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n).replace(/\s+\S*$/, '').replace(/[\s,;:–—-]+$/, '') + '…');
const latin = (s: string) => {
  const letters = s.match(/\p{L}/gu) ?? [];
  return letters.length ? letters.filter((c) => /\p{Script=Latin}/u.test(c)).length / letters.length : 0;
};
/** Paragraphs of a post's text: its lines, links dropped (they're listed under the story), handles kept. */
const paragraphs = (text: string) =>
  text
    .split(/\n+/)
    .map(clean)
    .filter((l) => (l.match(/\p{L}/gu) ?? []).length >= 2 && !/^(Quoting|Read more:?|Link:?|🔗)$/i.test(l));
/** A headline from a sentence: the first sentence, joined with the next when it only introduces it («…today:»). */
function headline(lines: string[]): string {
  const text = lines.join(' ');
  const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z0-9"“‘'@#$])/);
  let h = sentences[0] ?? '';
  if (/:\s*$/.test(h) || h.length < 28) h = sentences.slice(0, 2).join(' ');
  h = h.replace(/[.:;,]\s*$/, '').replace(/\s*[🚀🔥👇🧵✨📢🚨⚡️💥🎉]+\s*/gu, ' ').trim();
  return clip(h, 120);
}

function shapeEn(p: Post): EnPost | null {
  if (p.kind === 'digest') return null;
  const links: Link[] = p.links ?? [];
  const tweet = links.find((l) => l.kind === 'tweet' && l.text);
  const page = links.find((l) => l.kind !== 'tweet' && l.title && !WALL.test(l.title));
  const ai = (p.ai as { en?: { title?: string; short?: string; failed?: boolean } } | null | undefined)?.en;
  const own = p.text && latin(p.text.replace(URLS, '')) > 0.8 ? paragraphs(p.text) : [];
  let body = tweet ? paragraphs(tweet.text ?? '') : own;
  if (page?.description && latin(page.description) > 0.7) {
    const d = clean(page.description);
    if (d.length > 30 && !body.some((b) => b.includes(d.slice(0, 40)))) body = [...body, d];
  }
  if (!body.length && page?.title) body = [clean(page.title)];
  const text = body.join(' ');
  if ((text.match(/\p{L}/gu) ?? []).length < 25 || latin(text) < 0.7) return null;
  const lang = langOf(text)?.code ?? 'en';
  // A linked page's own title is the headline when it's a newsroom's or a maker's (or there's no post text); a code
  // page's («x at main · owner/repo», «GitHub - …») or a generic site name never is.
  const codePage = /( at (main|master) · |^GitHub - | · GitHub$|^huggingface\.co|Hugging Face$)/i.test(page?.title ?? '');
  const known = !!page && !!sourceKind(page);
  const pageTitle = page?.title && !codePage && (known || !tweet) && latin(page.title) > 0.8 && page.title.length >= 20 ? clean(page.title) : '';
  const title = (ai && !ai.failed && ai.title) || pageTitle || headline(body);
  const quoteText = tweet?.quote?.text ? clean(tweet.quote.text) : '';
  const author = tweet?.author;
  const publisher = tweet ? publisherOf(page?.url ?? '') || 'X' : publisherOf(page?.url ?? p.preview?.url ?? '') || p.preview?.site || '';
  const by = author?.name ? `${author.name}${author.handle ? ` (@${author.handle.replace(/^@/, '')})` : ''}` : publisher;
  const rest = body.join(' ');
  const at = rest.indexOf(title.replace(/…$/, ''));
  const excerpt = clip(at === 0 ? rest.slice(title.length).replace(/^[\s.:;,!?]+/, '') || rest : rest, 220);
  const words = (rest + ' ' + quoteText).split(/\s+/).length;
  return {
    id: p.id,
    href: url(`en/p/${p.id}/`),
    faHref: p.href,
    title,
    short: (ai && !ai.failed && ai.short) || clip(title, 48),
    body,
    quote: quoteText && latin(quoteText) > 0.6 ? { author: tweet?.quote?.author?.name || tweet?.quote?.author?.handle || '', text: quoteText } : null,
    excerpt,
    by,
    publisher,
    sourceUrl: cleanUrl(tweet?.url ?? page?.url ?? p.source?.url ?? p.url),
    cited: [...new Set([...(page ? [cleanUrl(page.url)] : []), ...citedLinks(tweet?.text)])].slice(0, 4),
    lang,
    date: p.date,
    post: p,
    topics: p.article.tags.map(enTopic).filter((t): t is NonNullable<ReturnType<typeof enTopic>> => !!t),
    type: p.type ? TYPE_EN[p.type] ?? null : null,
    status: p.status ? STATUS_EN[p.status] ?? null : null,
    minutes: Math.max(1, Math.round(words / 230)),
  };
}

let cache: EnPost[] | null = null;
/** Every story with English source text, newest first. */
export function getEn(): EnPost[] {
  if (!cache) cache = getStories().map(shapeEn).filter((x): x is EnPost => !!x);
  return cache;
}
const byId = () => new Map(getEn().map((e) => [e.id, e]));
let ids: Map<number, EnPost> | null = null;
/** The English version of a post, if it has one. */
export const enOf = (id: number) => (ids ??= byId()).get(id) ?? null;

/** The channel's newest English 24-hour summary (the Persian site shows the Persian one), its items linked to English
 *  pages where they have one. */
export function enDigest() {
  const d = englishDigests()[0];
  if (!d) return null;
  return { ...d, items: d.items.map((i) => ({ ...i, href: enOf(i.id)?.href ?? null })) };
}

/** Related English stories: the Persian site's related ids that have an English page, else shared topics. */
export function enRelated(e: EnPost, n = 4): EnPost[] {
  const map = (ids ??= byId());
  const list = e.post.relatedIds.map((id) => map.get(id)).filter((x): x is EnPost => !!x && x.id !== e.id);
  if (list.length >= 2) return list.slice(0, n);
  const tags = new Set(e.topics.map((t) => t.slug));
  return getEn()
    .filter((x) => x.id !== e.id && x.topics.some((t) => tags.has(t.slug)))
    .sort((a, b) => Math.abs(a.id - e.id) - Math.abs(b.id - e.id))
    .slice(0, n);
}

export function enTopics(): { fa: string; en: string; slug: string; count: number }[] {
  const counts = new Map<string, { fa: string; en: string; slug: string; count: number }>();
  for (const e of getEn()) for (const t of e.topics) counts.set(t.slug, { ...t, count: (counts.get(t.slug)?.count ?? 0) + 1 });
  return [...counts.values()].sort((a, b) => b.count - a.count);
}

const fmts = new Map<string, Intl.DateTimeFormat>();
export function enDate(iso: string, opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }) {
  const key = JSON.stringify(opts);
  let f = fmts.get(key);
  if (!f) fmts.set(key, (f = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...opts })));
  return f.format(new Date(iso));
}
export const enTime = (iso: string) => enDate(iso, { hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'short' });
export const EN = {
  name: SITE.nameLatin,
  tagline: 'AI and tech news from the source, as it breaks',
  description: `The latest AI, technology and future news from the "${SITE.nameLatin} with Mehrzad" Telegram channel — every story with its original source, pictures and video, in English and Persian.`,
};

/** schema.org for an English list page: a CollectionPage (WebPage on the home) with its stories. */
export function enListLd(name: string, path: string, items: EnPost[], home = false) {
  const site = SITE.url;
  const abs = (p: string) => new URL(p.replace(/^\//, ''), `${site}/`).href;
  return [
    {
      '@context': 'https://schema.org',
      '@type': home ? 'WebPage' : 'CollectionPage',
      '@id': abs(path),
      url: abs(path),
      name,
      inLanguage: 'en',
      isPartOf: { '@id': `${site}/#website` },
      publisher: { '@id': `${site}/#org` },
      ...(items[0] && { dateModified: items[0].post.updated || items[0].date }),
      mainEntity: {
        '@type': 'ItemList',
        itemListOrder: 'https://schema.org/ItemListOrderDescending',
        numberOfItems: Math.min(items.length, 30),
        itemListElement: items.slice(0, 30).map((e, i) => ({ '@type': 'ListItem', position: i + 1, url: abs(`en/p/${e.id}/`), name: e.title.slice(0, 110) })),
      },
    },
  ];
}
export const EN_PAGE_SIZE = 20;
