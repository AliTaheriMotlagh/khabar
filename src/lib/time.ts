// Dates and the story sets, shared by the build (src/lib/posts.ts) and the browser (src/scripts/). No imports and no
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

// ---------- the four stories (home rail → /today/?s=…) ----------
/** new: arrived since the last visit and not seen yet · unseen: not opened or watched · today: published today (Tehran) ·
 *  all: everything the player carries (the last three calendar days, see lastDays). Every set plays all it holds, so the
 *  rail's count, the player's «۵ / ۶۰» and the tab title's new count agree. */
export const STORY_SETS = ['new', 'unseen', 'today', 'all'] as const;
export type StorySet = (typeof STORY_SETS)[number];
/** `at`: the story's publish time, in ms. */
export type StoryItem = { id: number; at: number };
export const storySet = (v: string | null | undefined): StorySet => (STORY_SETS as readonly string[]).includes(v ?? '') ? (v as StorySet) : 'today';

/** The stories a set plays, in the order given (newest first). `unread` and `pending` are the reader's own state. */
export function chooseStories<T extends StoryItem>(
  set: StorySet,
  items: T[],
  { now = Date.now(), unread = () => true, pending = new Set<number>() }: { now?: number; unread?: (id: number) => boolean; pending?: Set<number> } = {},
): T[] {
  const keep = (i: T) =>
    set === 'new' ? pending.has(i.id) && unread(i.id) : set === 'unseen' ? unread(i.id) : set === 'today' ? isToday(i.at, now) : true;
  return items.filter(keep);
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

/** The rail's data-recent: "id:unix seconds", comma separated. */
export const encodeStories = (items: StoryItem[]) => items.map((i) => `${i.id}:${Math.round(i.at / 1000)}`).join(',');
export const decodeStories = (s: string): StoryItem[] =>
  s
    .split(',')
    .map((v) => v.split(':').map(Number))
    .filter(([id, at]) => id > 0 && at > 0)
    .map(([id, at]) => ({ id, at: at * 1000 }));
