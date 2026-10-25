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
// One circle of the recent news, no topics. What it holds is the reader's choice (settings): only what they haven't
// seen (the default), today's news, or all three days; newest first (the default) or oldest first.
/** `at`: the story's publish time, in ms · `kind`: story (Gholam's write-up) or brief. */
export type StoryItem = { id: number; at: number; kind?: string };

/** Drops the forwarded original that a story comments on: Telegram stamps a forward and the channel's note on it with
 *  the same second, and only the note gets Gholam's write-up, so the forward is a brief with the same news. */
export function dropCompanions<T extends StoryItem>(items: T[]): T[] {
  const stories = new Set(items.filter((i) => i.kind === 'story').map((i) => i.at));
  return items.filter((i) => i.kind !== 'brief' || !stories.has(i.at));
}

/** The stories' settings: what they show and in which order. */
export const STORY_SHOW = { unseen: 'خبرهای تازه', today: 'خبرهای امروز', all: 'سه روز اخیر' } as const;
export type StoryShow = keyof typeof STORY_SHOW;
export type StoryOrder = 'new' | 'old';

/** What the stories play, in the order they play: the unseen ones (`unread`), today's (Tehran's calendar day) or all
 *  of them, newest or oldest first. */
export function pickStories<T extends StoryItem>(items: T[], show: StoryShow, order: StoryOrder, unread: (id: number) => boolean, now = Date.now()): T[] {
  const kept = items.filter((i) => (show === 'all' ? true : show === 'today' ? isToday(i.at, now) : unread(i.id)));
  const dir = order === 'old' ? 1 : -1;
  return kept.sort((a, b) => dir * (a.at - b.at || a.id - b.id));
}

/** Where the show goes after story `at` of `items` (in play order): the next unseen one after it, then the ones
 *  before it that are still unseen (a show started at a story named in the address skips the ones before it), else
 *  -1: the end. */
export function nextUnseen(items: StoryItem[], at: number, unread: (id: number) => boolean) {
  for (let d = 1; d < items.length; d++) {
    const k = (at + d) % items.length;
    if (unread(items[k].id)) return k;
  }
  return -1;
}

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

/** The rail circle's data-rail-ids: "id:unix seconds", comma separated. */
export const encodeStories = (items: StoryItem[]) => items.map((i) => `${i.id}:${Math.round(i.at / 1000)}`).join(',');
export const decodeStories = (s: string): StoryItem[] =>
  s
    .split(',')
    .map((v) => v.split(':').map(Number))
    .filter(([id, at]) => id > 0 && at > 0)
    .map(([id, at]) => ({ id, at: at * 1000 }));
