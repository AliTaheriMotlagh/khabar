// The home page's front panel (Masthead.astro), both editions: the lead story and the top stories beside it.
// The lead is the newest day's most important story with a picture (ai.x.importance), else the newest with one; the top
// list is the most important of the last 36 hours after it, topped up with the newest.
import { dayKey, tagHref, type Post } from './posts';
import { publisherOf } from './source';
import { enTopicHref, type EnPost } from './en';

export type FrontItem = {
  id: number;
  href: string;
  title: string;
  excerpt: string;
  kicker: { label: string; href: string } | null;
  date: string;
  /** The cover's address (pic() makes the relay chain), and the original post for when every address fails. */
  cover: string | null;
  fallback: string;
  by: string;
  must: boolean;
  rumor: { label: string; title: string } | null;
};

const TOP = 4;

function pick<T>(items: T[], cover: (t: T) => boolean, imp: (t: T) => number, id: (t: T) => number, date: (t: T) => string) {
  if (!items.length) return { lead: undefined, top: [] as T[] };
  const day0 = dayKey(date(items[0]));
  const byWeight = (a: T, b: T) => imp(b) - imp(a) || id(b) - id(a);
  const lead = items.filter((t) => cover(t) && dayKey(date(t)) === day0).sort(byWeight)[0] ?? items.find(cover) ?? items[0];
  const since = Date.parse(date(items[0])) - 36 * 36e5;
  const top = items.filter((t) => t !== lead && Date.parse(date(t)) > since).sort(byWeight).slice(0, TOP);
  for (const t of items) if (top.length < TOP && t !== lead && !top.includes(t)) top.push(t);
  return { lead, top };
}

/** The Persian home: stories only (the morning summary has its own box). */
export function frontFa(posts: Post[]) {
  const stories = posts.filter((p) => p.kind === 'story');
  const { lead, top } = pick(stories, (p) => !!p.cover, (p) => p.importance ?? 0, (p) => p.id, (p) => p.date);
  const item = (p: Post): FrontItem => ({
    id: p.id,
    href: p.href,
    title: p.article.title,
    excerpt: p.excerpt && p.excerpt !== p.article.title ? p.excerpt : '',
    kicker: p.article.tags[0] ? { label: p.article.tags[0], href: tagHref(p.article.tags[0]) } : null,
    date: p.date,
    cover: p.cover ? p.cover.src || p.cover.poster || null : null,
    fallback: p.url,
    by: p.source?.url ? publisherOf(p.source.url) : '',
    must: (p.importance ?? 0) >= 4,
    rumor: p.status === 'شایعه' ? { label: 'تأییدنشده', title: 'نشت خبر یا ادعایی که هنوز کسی رسماً تأییدش نکرده' } : null,
  });
  return { lead: lead && item(lead), leadPost: lead, top: top.map(item) };
}

export function frontEn(posts: EnPost[]) {
  const { lead, top } = pick(posts, (e) => !!e.post.cover, (e) => e.post.importance ?? 0, (e) => e.id, (e) => e.date);
  const item = (e: EnPost): FrontItem => ({
    id: e.id,
    href: e.href,
    title: e.title,
    excerpt: e.excerpt && e.excerpt !== e.title ? e.excerpt : '',
    kicker: e.topics[0] ? { label: e.topics[0].en, href: enTopicHref(e.topics[0].slug) } : null,
    date: e.date,
    cover: e.post.cover ? e.post.cover.src || e.post.cover.poster || null : null,
    fallback: e.post.url,
    by: e.publisher,
    must: (e.post.importance ?? 0) >= 4,
    rumor: e.status?.cls === 'is-rumor' ? { label: e.status.label, title: e.status.title } : null,
  });
  return { lead: lead && item(lead), leadPost: lead, top: top.map(item) };
}
