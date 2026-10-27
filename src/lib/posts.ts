import fs from 'node:fs';
import path from 'node:path';
import { SITE } from '../site';
import { dropCompanions, lastDays, tehranDay } from './time';

// ---- data written by the crawler (pipeline/run.py) ----
export type Media = {
  type: 'image' | 'video';
  src?: string | null;
  poster?: string | null;
  ratio?: number | null; // height / width
  duration?: number | string | null;
  gif?: boolean;
};
export type Author = { name?: string; handle?: string; avatar?: string | null };
export type Tweet = { author?: Author; text?: string; date?: number; media?: Media[]; links?: string[] };
export type Link = Tweet & {
  kind: 'tweet' | 'link' | 'youtube';
  url: string;
  domain: string;
  title?: string;
  description?: string;
  site?: string;
  image?: string | null;
  video_id?: string;
  quote?: Tweet;
  article?: { title?: string; image?: string | null };
};
export type RawPost = {
  id: number;
  url: string;
  date: string;
  text: string;
  forwarded_from?: string | null;
  digest?: boolean;
  gholam?: { text: string; date?: string | null } | null;
  links?: Link[];
  media?: Media[];
  preview?: { url?: string; site?: string; title?: string; description?: string; image?: string | null } | null;
  article: { title: string; source_title?: string | null; body: string[]; why?: string | null; tags: string[] };
  updated?: string | null;
};

// ---- shaped for the templates ----
export type DigestItem = { n: number; text: string; href: string; internal: boolean; id: number };
export type Post = RawPost & {
  /** story: has Gholam's Persian write-up · digest: the channel's 24-hour summary · brief: a short post without one */
  kind: 'story' | 'digest' | 'brief';
  href: string;
  /** Always a still image (never a video file), for cards, thumbnails and social previews. */
  cover: Media | null;
  gallery: Media[];
  excerpt: string;
  source: Link | null;
  digestItems: DigestItem[];
  minutes: number;
  /** On the timeline, topics, today and feeds: the channel's own Persian words. An English-only link post (no
   *  Gholam translation) still gets its page, for links that point to it, but stays off the lists. */
  listed: boolean;
};

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
export const url = (p = '') => `${BASE}/${p.replace(/^\//, '')}`;
/** Absolute URL on the primary domain (canonical, sitemap, social cards). */
export const abs = (p = '') => new URL(p.replace(/^\//, ''), `${SITE.url}/`).href;

/** X/Twitter images come in sizes: ask for a small one in lists, a large one on article pages. */
export function sized(src: string | null | undefined, size: 'small' | 'medium' | 'large' = 'medium') {
  if (!src) return '';
  try {
    const u = new URL(src);
    if (u.hostname === 'pbs.twimg.com' && u.pathname.startsWith('/media/')) {
      u.searchParams.set('name', size);
      return u.href;
    }
  } catch {}
  return src;
}

// Telegram's CDN URLs are signed and expire, and the crawler only re-reads the newest posts: each Telegram image or
// video also gets the address of /api/media, which redirects to the current URL. The page switches to it when the stored
// URL fails (src/scripts/media.ts, data-fresh).
const TG_CDN = /^https:\/\/[\w.-]*telesco\.pe\//;
const freshUrls = new Map<string, string>();
function noteFresh(raw: RawPost) {
  (raw.media ?? []).forEach((m, i) => {
    const at = `${SITE.api}/api/media/?p=${raw.id}&i=${i}`;
    if (m.src && TG_CDN.test(m.src)) freshUrls.set(m.src, at);
    if (m.poster && TG_CDN.test(m.poster)) freshUrls.set(m.poster, `${at}&f=poster`);
  });
  const preview = raw.preview?.image;
  if (preview && TG_CDN.test(preview)) freshUrls.set(preview, `${SITE.api}/api/media/?p=${raw.id}&f=preview`);
}
/** Where to get a fresh copy of a Telegram media URL (undefined for any other URL). */
export const fresh = (src: string | null | undefined) => (src ? freshUrls.get(src) : undefined);

// Most readers are in Iran, where Telegram's and X's CDNs are filtered, and where a browser's connection to other
// foreign hosts stalls once it carries several requests at a time (measured: wsrv.nl and images.weserv.nl, on
// Cloudflare, return nothing to 9 multiplexed requests; the site's own Vercel domain serves them in 2 s). So a picture
// from those CDNs comes through the site itself first (api/img.js: resized to WebP via wsrv.nl server-side, CDN-cached);
// then through wsrv.nl directly; then from the original address (fine with a VPN). Pictures from other sites (link
// previews) go wsrv.nl, then original. src/scripts/media.ts walks the list (data-alt) and moves on when an address
// fails or just hangs. A Telegram picture goes by its post and index: always the current signed URL, and the same
// address forever, so caches keep serving it. Social cards and JSON-LD keep the original URLs (read by crawlers abroad);
// RSS goes through the relay (feedPicture).
const PROXY = 'https://wsrv.nl/';
const WIDTH = { small: 320, medium: 800, large: 1400 }; // api/img.js accepts exactly these
const RELAYED = /^https:\/\/(pbs\.twimg\.com|[\w-]+\.telesco\.pe|i\.ytimg\.com)\//; // and only these hosts
const absolute = (u: string) => (u.startsWith('/') ? `${SITE.api || SITE.url}${u}` : u);
const viaProxy = (u: string, size: keyof typeof WIDTH) => `${PROXY}?url=${encodeURIComponent(absolute(u))}&w=${WIDTH[size]}&we&output=webp&q=80`;
/** The site's own address for a picture from the channel's CDNs (api/img.js), or null for any other picture. */
function relayed(raw: string | null | undefined, src: string, size: keyof typeof WIDTH) {
  const tg = fresh(raw);
  const w = `&w=${WIDTH[size]}`;
  return tg ? tg.replace('/api/media/', '/api/img/') + w : RELAYED.test(src) ? `${SITE.api}/api/img/?u=${encodeURIComponent(src)}${w}` : null;
}
/** An image's addresses, best first: `src` for the HTML and the rest, space-separated, for data-alt. */
export function picture(raw: string | null | undefined, size: keyof typeof WIDTH = 'medium'): { src: string; alt: string | undefined } {
  const src = sized(raw, size);
  if (!/^https:\/\//.test(src)) return { src, alt: undefined };
  const tg = fresh(raw);
  const list = [relayed(raw, src, size), viaProxy(tg ?? src, size), src, tg].filter((u): u is string => !!u);
  return { src: list[0], alt: list.slice(1).join(' ') };
}
/** One lasting address for a picture read elsewhere (RSS): feed readers keep it for good, and many of them read from
 *  Iran, so a Telegram/X picture goes through the site's relay on the primary domain (WebP), anything else as it is. */
export function feedPicture(raw: string | null | undefined, size: keyof typeof WIDTH = 'medium') {
  const src = sized(raw, size);
  if (!/^https:\/\//.test(src)) return null;
  const relay = relayed(raw, src, size);
  return relay ? { url: abs(relay), type: 'image/webp' } : { url: src, type: imageType(src) };
}
const imageType = (u: string) => {
  const ext = new URL(u).pathname.match(/\.(png|gif|webp|avif|svg)$/i)?.[1].toLowerCase();
  return ext ? (ext === 'svg' ? 'image/svg+xml' : `image/${ext}`) : 'image/jpeg';
};
/** Attributes for an <img>: the first address, and the others to fall back to. */
export const pic = (raw: string | null | undefined, size: keyof typeof WIDTH = 'medium') => {
  const p = picture(raw, size);
  return { src: p.src, 'data-alt': p.alt };
};

const clip = (s: string, n: number) => {
  s = s.replace(/\s+/g, ' ').trim();
  return s.length <= n ? s : s.slice(0, n).replace(/\s+\S*$/, '').replace(/[\s.،,:;؛-]+$/, '') + '…';
};
/** The first sentence of a line, whole when it's a reasonable length: titles are never cut mid-thought. */
const firstSentence = (s: string) => {
  const line = s.replace(/\s+/g, ' ').trim();
  const sentence = line.split(/(?<=[.!؟?])\s+/)[0];
  return sentence.length >= 20 && sentence.length <= 200 ? sentence : clip(line, 200);
};
const persianShare = (s: string) => {
  const letters = s.match(/\p{L}/gu) ?? [];
  return letters.length ? letters.filter((c) => /[؀-ۿ]/.test(c)).length / letters.length : 0;
};

// The whole channel is about AI: a "هوش مصنوعی" tag would sit on every story and say nothing.
const HIDDEN_TAGS = new Set(['هوش مصنوعی']);

const DIGEST_LINE = /^[\s‎‏]*([0-9۰-۹]+)\s*[—–-]\s*(.+?)\s*\((https?:\/\/t\.me\/\w+\/(\d+))\)\s*$/;
const toLatin = (s: string) => s.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));

function digestItems(text: string, ids: Set<number>): DigestItem[] {
  return text
    .split('\n')
    .map((line) => line.match(DIGEST_LINE))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => {
      const id = Number(m[4]);
      const internal = ids.has(id);
      return { n: Number(toLatin(m[1])), text: m[2], href: internal ? url(`p/${id}/`) : m[3], internal, id };
    });
}

function shape(raw: RawPost, ids: Set<number>): Post {
  noteFresh(raw);
  const links = raw.links ?? [];
  const own = (raw.media ?? []).filter((m) => m.src || m.poster);
  const linked = links.flatMap((l) => [...(l.media ?? []), ...(l.quote?.media ?? [])]).filter((m) => m.src || m.poster);
  const gallery = own.length ? own : linked;
  // The cover is always a still picture: the first image, a video's poster, or the linked page's image.
  const firstStill = gallery.map((m) => ({ src: m.type === 'video' ? m.poster : m.src, ratio: m.ratio })).find((m) => m.src);
  const pageImage = links.map((l) => l.article?.image || l.image).find(Boolean) || raw.preview?.image || null;
  const cover: Media | null = firstStill ? { type: 'image', ...firstStill } : pageImage ? { type: 'image', src: pageImage } : null;

  const kind: Post['kind'] = raw.digest ? 'digest' : raw.gholam?.text ? 'story' : 'brief';
  const items = kind === 'digest' ? digestItems(raw.text, ids) : [];
  const body = raw.article.body.length ? raw.article.body : raw.text.split(/\n+/).filter((l) => l.trim() && !/^https?:\/\/\S+$/.test(l.trim()));
  const title =
    kind === 'digest'
      ? raw.text.split('\n').find((l) => l.trim())?.trim() || 'خلاصه‌ی خبرها'
      : kind === 'brief'
        ? firstSentence(body[0] || raw.article.source_title || raw.preview?.title || raw.article.title)
        : raw.article.title;
  const tags = raw.article.tags.filter((t) => !HIDDEN_TAGS.has(t));
  const words = [...body, raw.article.why ?? ''].join(' ').split(/\s+/).length;
  // The title is the lede's first sentence, so the excerpt picks up where it ends instead of repeating it.
  const lede = body.join(' ').replace(/\s+/g, ' ').trim();
  const at = title.endsWith('…') ? -1 : lede.indexOf(title);
  const rest = at >= 0 && at < 40 ? lede.slice(at + title.length).replace(/^[\s.!؟?،,:;؛]+/, '') : lede;

  return {
    ...raw,
    links,
    kind,
    article: { ...raw.article, title, body, tags },
    href: url(`p/${raw.id}/`),
    cover,
    gallery,
    excerpt: kind === 'digest' ? items.slice(0, 3).map((i) => i.text).join(' · ') : clip(rest, 220),
    source: links[0] ?? null,
    digestItems: items,
    minutes: Math.max(1, Math.round(words / 200)),
    listed: kind !== 'brief' || persianShare(body.join(' ')) >= 0.5,
  };
}

let cache: Post[] | null = null;

/** Every post that gets a page, newest first. English copies of the daily digest are skipped: the Persian one is published. */
export function getPosts(): Post[] {
  if (cache) return cache;
  const raws = Object.values(import.meta.glob<RawPost>('../../data/posts/*.json', { eager: true, import: 'default' })).filter(
    // A post without a readable date (Telegram's page had no time tag) can't be placed on the timeline.
    (p) => p?.article && !Number.isNaN(Date.parse(p.date)) && !(p.digest && persianShare(p.text) < 0.5),
  );
  const ids = new Set(raws.map((p) => p.id));
  cache = raws.map((p) => shape(p, ids)).sort((a, b) => b.id - a.id);
  return cache;
}

/** What the lists show (home, pages, topics, today, feeds): only the channel's Persian posts. */
export const getFeed = () => getPosts().filter((p) => p.listed);
export const getStories = () => getFeed().filter((p) => p.kind !== 'digest');
/** What a newer build would bring: a newer listed post, or more of them (a brief turns listed once Gholam's Persian
 *  arrives). An open page compares it with /build.json to offer the news without a manual reload. */
export function feedRev() {
  const feed = getFeed();
  return { latest: feed[0]?.id ?? 0, count: feed.length };
}
/** What the player and the story rail carry: the three calendar days up to the newest story, whole days (at least `min`
 *  stories after a quiet spell). */
export function recentPosts(min = 8): Post[] {
  const stories = getStories();
  const recent = lastDays(stories.map((p) => ({ p, id: p.id, at: Date.parse(p.date) }))).map((i) => i.p);
  return recent.length >= min ? recent : stories.slice(0, min);
}
/** The stories, one stream newest first, no topics (a forwarded original a story comments on is left out as its
 *  duplicate, src/lib/time.ts, dropCompanions). The browser keeps only what its reader hasn't seen. */
export function storyItems(): { id: number; at: number; kind: string; p: Post }[] {
  return dropCompanions(recentPosts().map((p) => ({ id: p.id, at: Date.parse(p.date), kind: p.kind, p })));
}
/** A story's still pictures, at most `n`: its images and its videos' posters, else the cover. */
export function stills(p: Post, n = 6): string[] {
  const own = p.gallery.map((m) => (m.type === 'video' ? m.poster : m.src)).filter((s): s is string => !!s);
  const list = own.length ? own : [p.cover?.src || p.cover?.poster].filter((s): s is string => !!s);
  return [...new Set(list)].slice(0, n);
}

/** The story's video (src/scripts/video.ts): a title scene, then chapters, each a heading, the lines it says — indices
 *  into card.json's spoken lines [title, ...body, why], which /api/tts reads — and its pictures. A story or a brief:
 *  its text (lines with links left out, up to about VIDEO_CHARS characters), then «چرا مهمه؟»; the headline is said
 *  unless the first paragraph already says it. The 24-hour summary: one chapter per item, with the pictures of the
 *  story it points to. */
export type VideoChapter = { head: string | null; say: number[]; pics: string[] };
const VIDEO_CHARS = 2400;
export function videoPlan(p: Post): { title: boolean; chapters: VideoChapter[] } {
  if (p.kind === 'digest') {
    const byId = new Map(getPosts().map((x) => [x.id, x]));
    return {
      title: true,
      chapters: p.digestItems.map((it, k) => {
        const linked = byId.get(it.id);
        return { head: faNum(it.n), say: [k + 1], pics: linked ? stills(linked, 2) : [] };
      }),
    };
  }
  const head = p.article.title.replace(/…$/, '').trim();
  const say: number[] = [];
  let n = 0;
  p.article.body.forEach((raw, k) => {
    const text = raw.trim();
    if (!text || n >= VIDEO_CHARS || /https?:\/\//.test(text)) return;
    say.push(k + 1);
    n += text.length;
  });
  const chapters: VideoChapter[] = say.length ? [{ head: null, say, pics: stills(p) }] : [];
  if (p.article.why) chapters.push({ head: 'چرا مهمه؟', say: [p.article.body.length + 1], pics: [] });
  return { title: !p.article.body[0]?.includes(head.slice(0, 30)), chapters };
}

/** The channel's Persian morning summary (posted ~07:36 Tehran), the home page's brief. */
export const latestDigest = () => getPosts().find((p) => p.kind === 'digest') ?? null;

export function getChannel(): { title?: string; description?: string; avatar?: string | null; subscribers?: string } {
  const file = path.join(process.cwd(), 'data', 'channel.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
}

export function getTags(): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const p of getFeed()) for (const t of p.article.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count);
}

export const tagHref = (tag: string) => url(`tag/${encodeURIComponent(tag)}/`);

export function related(post: Post, n = 4): Post[] {
  const tags = new Set(post.article.tags);
  return getStories()
    .filter((p) => p.id !== post.id)
    .map((p) => ({ p, score: p.article.tags.filter((t) => tags.has(t)).length * 10 - Math.abs(p.id - post.id) / 100 }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map((x) => x.p);
}

// ---- formatting (server side; the client re-renders relative times so they never go stale) ----
const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: SITE.timeZone, ...opts });
export const faDate = (iso: string, opts: Intl.DateTimeFormatOptions = { dateStyle: 'long' }) => fmt(opts).format(new Date(iso));
export const faTime = (iso: string) => fmt({ hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
export const dayKey = (iso: string) => tehranDay(iso);
export const faNum = (n: number | string) => (typeof n === 'number' ? n.toLocaleString('fa-IR') : n.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]));
export const duration = (s?: number | string | null) => {
  if (s == null || s === '') return '';
  if (typeof s === 'string') return s;
  return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
};
