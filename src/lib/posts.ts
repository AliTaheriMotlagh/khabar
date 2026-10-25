import fs from 'node:fs';
import path from 'node:path';
import { SITE } from '../site';

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
export type DigestItem = { n: number; text: string; href: string; internal: boolean };
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
      return { n: Number(toLatin(m[1])), text: m[2], href: internal ? url(`p/${id}/`) : m[3], internal };
    });
}

function shape(raw: RawPost, ids: Set<number>): Post {
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
    (p) => p?.article && !(p.digest && persianShare(p.text) < 0.5),
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
/** The day in one sitting (the daily player and its teaser): stories and briefs from the 24 hours before the newest one,
 *  at least `min` of them on a quiet day. */
export function todayPosts(min = 8, max = 40): Post[] {
  const stories = getStories();
  const newest = stories[0] ? Date.parse(stories[0].date) : 0;
  const day = stories.filter((p) => newest - Date.parse(p.date) < 864e5);
  return (day.length >= min ? day : stories.slice(0, min)).slice(0, max);
}
/** What the player can show: the last three days, so "unread" still has stories after a day away. The browser picks
 *  today's or the reader's unread ones (src/scripts/player.ts). */
export function recentPosts(max = 60): Post[] {
  const stories = getStories();
  const newest = stories[0] ? Date.parse(stories[0].date) : 0;
  const today = todayPosts();
  const recent = stories.filter((p) => newest - Date.parse(p.date) < 3 * 864e5).slice(0, max);
  return recent.length >= today.length ? recent : today;
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
export const dayKey = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: SITE.timeZone }).format(new Date(iso));
export const faNum = (n: number | string) => (typeof n === 'number' ? n.toLocaleString('fa-IR') : n.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]));
export const duration = (s?: number | string | null) => {
  if (s == null || s === '') return '';
  if (typeof s === 'string') return s;
  return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
};
