// Dates and the story circles, shared by the build (src/lib/posts.ts) and the browser (src/scripts/). No imports and no
// browser or Vite globals, so tests/time.test.mjs runs it straight in Node.
// "Today" is always the reader's calendar day in Tehran, the same day the timeline's «امروز» pill names.
export const TZ = 'Asia/Tehran';
export const HOUR = 36e5;
export const DAY = 864e5;

const ms = (when: string | number | Date) => new Date(when).getTime();
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ });
/** The calendar day in Tehran, as YYYY-MM-DD. */
export const tehranDay = (when: string | number | Date) => dayFmt.format(new Date(when));
/** Whole calendar days in Tehran from `when` to `now`: 0 = the same day, 1 = yesterday. */
export const daysAgo = (when: string | number | Date, now: number = Date.now()) => Math.round((Date.parse(tehranDay(now)) - Date.parse(tehranDay(when))) / DAY);
export const isToday = (when: string | number | Date, now: number = Date.now()) => daysAgo(when, now) === 0;

const rtf = new Intl.RelativeTimeFormat('fa-IR', { numeric: 'auto' });
const shortDate = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: TZ, day: 'numeric', month: 'long' });
/** "۵ دقیقه پیش", "۳ ساعت پیش", then calendar days ("دیروز", "پریروز", "۴ روز پیش"), then the date. Days are counted on
 *  the calendar, not in 24-hour blocks, so a time never disagrees with the day it is listed under. */
export function relTime(when: string | number | Date, now: number = Date.now()) {
  const mins = (now - ms(when)) / 6e4;
  if (mins < 1) return 'همین حالا';
  if (mins < 60) return rtf.format(-Math.round(mins), 'minute');
  if (mins < 60 * 24) return rtf.format(-Math.round(mins / 60), 'hour');
  const days = daysAgo(when, now);
  if (days < 7) return rtf.format(-days, 'day');
  return shortDate.format(new Date(when));
}

// ---------- the stories (home rail → /today/), like Instagram's ----------
// One circle per topic, the way Instagram has one per account: every story is in exactly one circle, so nothing plays
// twice. Inside a circle the stories play oldest first and pick up at the first one this reader hasn't seen; circles
// with something unseen come first, the ones watched to the end turn grey and move to the back.
/** `at`: the story's publish time, in ms. */
export type StoryItem = { id: number; at: number };
/** `tags`: its topics, most relevant first · `kind`: story (Gholam's write-up) or brief. */
export type TaggedStory = StoryItem & { tags: string[]; kind?: string };
export type StoryGroup<T extends StoryItem = StoryItem> = { key: string; name: string; items: T[] };
/** The circle for stories whose topics have no circle of their own. */
export const OTHER = { key: 'more', name: 'خبرهای دیگر' } as const;

/** Drops the forwarded original that a story comments on: Telegram stamps a forward and the channel's note on it with
 *  the same second, and only the note gets Gholam's write-up, so the forward is a brief with the same news. */
export function dropCompanions<T extends TaggedStory>(items: T[]): T[] {
  const stories = new Set(items.filter((i) => i.kind === 'story').map((i) => i.at));
  return items.filter((i) => i.kind !== 'brief' || !stories.has(i.at));
}

/** The circles: each story goes to its most relevant topic that has at least `min` stories here, the rest to
 *  «خبرهای دیگر». Circles newest first (by their newest story), «خبرهای دیگر» last; inside, oldest first. */
export function groupStories<T extends TaggedStory>(items: T[], min = 2): StoryGroup<T>[] {
  // A topic too small for a circle gives its stories to their next topic, which can make that one too small: repeat
  // until every circle left has `min` stories (the set of topics only shrinks, so this ends).
  let open = new Set(items.flatMap((i) => i.tags));
  let home = new Map<number, string>();
  for (;;) {
    home = new Map(items.map((i) => [i.id, i.tags.find((t) => open.has(t)) ?? OTHER.key]));
    const size = new Map<string, number>();
    for (const t of home.values()) size.set(t, (size.get(t) ?? 0) + 1);
    const small = [...open].filter((t) => (size.get(t) ?? 0) < min);
    if (!small.length) break;
    for (const t of small) open.delete(t);
  }
  const groups = new Map<string, StoryGroup<T>>();
  for (const i of items) {
    const key = home.get(i.id)!;
    if (!groups.has(key)) groups.set(key, { key, name: key === OTHER.key ? OTHER.name : key, items: [] });
    groups.get(key)!.items.push(i);
  }
  const newest = (g: StoryGroup<T>) => Math.max(...g.items.map((i) => i.at));
  return [...groups.values()]
    .map((g) => ({ ...g, items: [...g.items].sort((a, b) => a.at - b.at || a.id - b.id) }))
    .sort((a, b) => Number(a.key === OTHER.key) - Number(b.key === OTHER.key) || newest(b) - newest(a));
}

/** The rail's order for this reader: circles with something unseen first, the one with the newest unseen story
 *  leading; then the circles watched to the end, newest first. */
export function orderGroups<G extends { items: StoryItem[] }>(groups: G[], unread: (id: number) => boolean): G[] {
  const newest = (items: StoryItem[]) => (items.length ? Math.max(...items.map((i) => i.at)) : 0);
  const rank = (g: G) => {
    const fresh = g.items.filter((i) => unread(i.id));
    return { fresh: fresh.length > 0, at: newest(fresh.length ? fresh : g.items) };
  };
  return groups
    .map((g) => ({ g, r: rank(g) }))
    .sort((a, b) => Number(b.r.fresh) - Number(a.r.fresh) || b.r.at - a.r.at)
    .map((x) => x.g);
}

/** Where a circle starts: at its first unseen story, or from the top once everything in it was seen. */
export const resumeAt = (items: StoryItem[], unread: (id: number) => boolean) => Math.max(0, items.findIndex((i) => unread(i.id)));

/** What the stories carry: the last `days` Tehran calendar days up to the newest item (items newest first), whole days
 *  only, so «همه» never holds half of its oldest day. Past `max` items the oldest days are dropped, never the newest. */
export function lastDays<T extends StoryItem>(items: T[], days = 3, max = 120): T[] {
  if (!items.length) return [];
  let kept = items.filter((i) => daysAgo(i.at, items[0].at) < days);
  while (kept.length > max) {
    const oldest = tehranDay(kept[kept.length - 1].at);
    const rest = kept.filter((i) => tehranDay(i.at) !== oldest);
    if (!rest.length) return kept.slice(0, max); // one day busier than max: its newest
    kept = rest;
  }
  return kept;
}

/** A rail circle's data-ids: "id:unix seconds", comma separated. */
export const encodeStories = (items: StoryItem[]) => items.map((i) => `${i.id}:${Math.round(i.at / 1000)}`).join(',');
export const decodeStories = (s: string): StoryItem[] =>
  s
    .split(',')
    .map((v) => v.split(':').map(Number))
    .filter(([id, at]) => id > 0 && at > 0)
    .map(([id, at]) => ({ id, at: at * 1000 }));
