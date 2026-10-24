import fs from 'node:fs';
import path from 'node:path';
import { SITE } from '../site';

export type Img = { src: string; width?: number; height?: number };
export type Media = {
  type: 'image' | 'video';
  src?: string | null;
  poster?: string | null;
  width?: number;
  height?: number;
  duration?: number | string | null;
  gif?: boolean;
  remote?: string | null;
};
export type Author = { name?: string; handle?: string; avatar?: string | null };
export type Tweet = {
  author?: Author;
  text?: string;
  date?: number;
  stats?: Record<string, number>;
  media?: Media[];
  links?: string[];
};
export type Link = Tweet & {
  kind: 'tweet' | 'link' | 'youtube';
  url: string;
  domain: string;
  title?: string;
  description?: string;
  site?: string;
  image?: Img | null;
  text?: string;
  published?: string;
  quote?: Tweet;
  article?: { title?: string; text?: string; image?: Img | null };
};
export type RawPost = {
  id: number;
  url: string;
  date: string;
  edited?: boolean;
  views?: string;
  text: string;
  forwarded_from?: string | null;
  digest?: boolean;
  gholam?: { text: string; date?: string | null } | null;
  links?: Link[];
  media?: Media[];
  preview?: { url?: string; site?: string; title?: string; description?: string; image?: Img | null } | null;
  article: { title: string; source_title?: string | null; body: string[]; why?: string | null; tags: string[] };
};
export type Post = RawPost & {
  href: string;
  cover: Img | null;
  heroMedia: Media[];
  excerpt: string;
  readingMinutes: number;
  hasGholam: boolean;
  source: Link | null;
};

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
export const url = (p = '') => `${BASE}/${p.replace(/^\//, '')}`;

const PUBLIC = path.join(process.cwd(), 'public');
const exists = (src?: string | null) => !!src && fs.existsSync(path.join(PUBLIC, src));

/** Drop references to media files that were pruned from the media store. */
function cleanMedia(list: Media[] = []): Media[] {
  return list
    .map((m) => ({ ...m, src: exists(m.src) ? m.src : null, poster: exists(m.poster) ? m.poster : null }))
    .filter((m) => m.src || m.poster);
}
const cleanImg = (img?: Img | null) => (img && exists(img.src) ? img : null);

const clip = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n).replace(/\s+\S*$/, '') + '…');

function shape(raw: RawPost): Post {
  const links = (raw.links ?? []).map((l) => ({
    ...l,
    media: cleanMedia(l.media),
    image: cleanImg(l.image),
    author: l.author ? { ...l.author, avatar: exists(l.author.avatar) ? l.author.avatar : null } : undefined,
    quote: l.quote ? { ...l.quote, media: cleanMedia(l.quote.media) } : undefined,
    article: l.article ? { ...l.article, image: cleanImg(l.article.image) } : undefined,
  }));
  const own = cleanMedia(raw.media);
  const heroMedia = own.length ? own : links.find((l) => l.media?.length)?.media ?? [];
  const firstVisual = heroMedia[0];
  const cover =
    (firstVisual && (firstVisual.type === 'image' && firstVisual.src
      ? { src: firstVisual.src, width: firstVisual.width, height: firstVisual.height }
      : firstVisual.poster
        ? { src: firstVisual.poster, width: firstVisual.width, height: firstVisual.height }
        : null)) ||
    links.map((l) => l.article?.image || l.image).find(Boolean) ||
    cleanImg(raw.preview?.image) ||
    null;

  const body = raw.article.body.length ? raw.article.body : raw.text.split(/\n+/).filter(Boolean);
  const words = [...body, raw.article.why ?? ''].join(' ').split(/\s+/).length;
  return {
    ...raw,
    links,
    preview: raw.preview ? { ...raw.preview, image: cleanImg(raw.preview.image) } : null,
    article: { ...raw.article, body },
    href: url(`p/${raw.id}/`),
    cover,
    heroMedia,
    excerpt: clip((body[0] ?? '').replace(/\s+/g, ' '), 240),
    readingMinutes: Math.max(1, Math.round(words / 180)),
    hasGholam: !!raw.gholam?.text,
    source: links[0] ?? null,
  };
}

let cache: Post[] | null = null;

/** All posts, newest first. Falls back to data/sample when the crawler hasn't run yet. */
export function getPosts(): Post[] {
  if (cache) return cache;
  const real = import.meta.glob<RawPost>('../../data/posts/*.json', { eager: true, import: 'default' });
  const sample = import.meta.glob<RawPost>('../../data/sample/posts/*.json', { eager: true, import: 'default' });
  const raws = Object.values(Object.keys(real).length ? real : sample);
  cache = raws.filter((p) => p?.article).map(shape).sort((a, b) => b.id - a.id);
  return cache;
}

export function getChannel(): { title?: string; description?: string; avatar?: string | null; subscribers?: string } {
  const file = path.join(process.cwd(), 'data', 'channel.json');
  const info = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  return { ...info, avatar: exists(info.avatar) ? info.avatar : null };
}

export function getTags(): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const p of getPosts()) for (const t of p.article.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count);
}

export const tagHref = (tag: string) => url(`tag/${encodeURIComponent(tag)}/`);

export function related(post: Post, n = 3): Post[] {
  const tags = new Set(post.article.tags);
  return getPosts()
    .filter((p) => p.id !== post.id)
    .map((p) => ({ p, score: p.article.tags.filter((t) => tags.has(t)).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.p.id - a.p.id)
    .slice(0, n)
    .map((x) => x.p);
}

// ---- formatting (server side; the client re-renders dates when the reader picks another calendar) ----
export const faDate = (iso: string, opts: Intl.DateTimeFormatOptions = { dateStyle: 'long' }) =>
  new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: SITE.timeZone, ...opts }).format(new Date(iso));

export const dayKey = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: SITE.timeZone }).format(new Date(iso));

export const faNum = (n: number | string) => (typeof n === 'number' ? n.toLocaleString('fa-IR') : n.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]));

export const duration = (s?: number | string | null) => {
  if (s == null) return '';
  if (typeof s === 'string') return s;
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.round(s % 60)).padStart(2, '0')}`;
};
