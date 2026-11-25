// The events calendars (/calendar/ + /calendar.ics, /en/calendar/ + /en/calendar.ics): the dated events the stories
// announce (src/lib/tracker.ts events), shaped once for the page, the subscribable file and the per-event «add to my
// calendar» buttons (src/scripts/calendar.ts). The English calendar has only events whose story has an English page,
// titled by that page's headline (the model writes the event's own words in Persian).
import { SITE } from '../site';
import { abs, url } from './posts';
import { tehranDay } from './time';
import { events } from './tracker';
import { EN, enOf } from './en';
import { icsCalendar } from './ics';

export type DayEvent = {
  uid: string;
  date: string;
  /** The event, in the calendar's language. */
  summary: string;
  description: string;
  /** The story's page: absolute (in the calendar file) and on this site. */
  url: string;
  href: string;
  /** The story's short headline, linked under the event on the page. */
  story: string;
};

export const CAL = {
  fa: { name: `رویدادهای هوش مصنوعی — ${SITE.name}`, description: `عرضه‌ها، رویدادها و مهلت‌هایی که خبرهای ${SITE.name} تاریخشان را گفته‌اند.`, file: 'calendar.ics', page: 'calendar/' },
  en: { name: `AI events — ${EN.name}`, description: `Launches, events and deadlines the stories on ${EN.name} give a date for.`, file: 'en/calendar.ics', page: 'en/calendar/' },
} as const;

const cache: { fa?: DayEvent[]; en?: DayEvent[] } = {};
/** Every event, by date (the past ones too: the page and the file each pick their window). */
export function calEvents(lang: 'fa' | 'en'): DayEvent[] {
  const hit = cache[lang];
  if (hit) return hit;
  const out: DayEvent[] = [];
  for (const e of events()) {
    if (lang === 'fa') {
      const link = abs(`p/${e.post.id}/`);
      out.push({ uid: `${e.post.id}-${e.date}`, date: e.date, summary: e.what, description: `${e.post.article.title}\n${link}`, url: link, href: e.post.href, story: e.post.short });
    } else {
      const en = enOf(e.post.id);
      // Two events of one story on one day would be two equal entries (both named by the story's headline).
      if (!en || out.some((o) => o.uid === `${en.id}-${e.date}-en`)) continue;
      const link = abs(`en/p/${en.id}/`);
      out.push({ uid: `${en.id}-${e.date}-en`, date: e.date, summary: en.title, description: `${en.excerpt}\n${link}`.trim(), url: link, href: en.href, story: en.short });
    }
  }
  // One post can date two things on the same day: each event keeps its own UID (a calendar merges equal ones).
  const seen = new Map<string, number>();
  for (const e of out) {
    const n = (seen.get(e.uid) ?? 0) + 1;
    seen.set(e.uid, n);
    if (n > 1) e.uid = `${e.uid}-${n}`;
  }
  return (cache[lang] = out);
}

/** The window of the subscribable file: the last month's events and everything ahead. */
export const calSince = () => new Date(Date.parse(tehranDay(Date.now())) - 31 * 86_400_000).toISOString().slice(0, 10);

export function calendarFile(lang: 'fa' | 'en') {
  const c = CAL[lang];
  const since = calSince();
  return new Response(
    icsCalendar({ name: c.name, description: c.description, lang, host: new URL(SITE.url).host, events: calEvents(lang).filter((e) => e.date >= since) }),
    { headers: { 'Content-Type': 'text/calendar; charset=utf-8' } },
  );
}
/** The page's subscribe addresses. */
export const calLinks = (lang: 'fa' | 'en') => ({ https: abs(CAL[lang].file), local: url(CAL[lang].file), name: CAL[lang].name });
