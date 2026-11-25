// iCalendar (RFC 5545) for the events calendars: the subscribable feeds (/calendar.ics, /en/calendar.ics) at build time
// and a single event's file made in the browser (src/scripts/calendar.ts: «add to my calendar» on iPhone/Mac). No
// imports, shared by build and browser, unit-tested from Node (tests/site.test.mjs). Every event is all-day
// (DTSTART;VALUE=DATE): a story says a day, never an hour. Lines end in CRLF, folded at 75 octets, text escaped.

export type IcsEvent = { uid: string; date: string; summary: string; description?: string; url?: string };
export type IcsCalendar = { name: string; description?: string; lang: 'fa' | 'en'; host: string; events: IcsEvent[]; stamp?: Date };

/** TEXT values: backslash, semicolon, comma and newlines escaped (RFC 5545 3.3.11). */
export const icsEscape = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Fold a content line into ≤75-octet pieces (a continuation starts with one space) without splitting a UTF-8 character. */
export function fold(line: string): string {
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const cp = ch.codePointAt(0)!;
    const n = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    if (bytes + n > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

/** 2026-11-25 → 20261125 */
export const icsDay = (d: string) => d.replaceAll('-', '');
/** The day after (an all-day event's DTEND is exclusive). */
export const icsNextDay = (d: string) => icsDay(new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10));
const stampOf = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');

function vevent(e: IcsEvent, stamp: string, host: string): string[] {
  return [
    'BEGIN:VEVENT',
    `UID:${e.uid}@${host}`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${icsDay(e.date)}`,
    `DTEND;VALUE=DATE:${icsNextDay(e.date)}`,
    `SUMMARY:${icsEscape(e.summary)}`,
    ...(e.description ? [`DESCRIPTION:${icsEscape(e.description)}`] : []),
    ...(e.url ? [`URL;VALUE=URI:${e.url}`] : []),
    'TRANSP:TRANSPARENT',
    'END:VEVENT',
  ];
}

/** A whole calendar: a subscribed feed (refreshed twice a day) or one event's file. */
export function icsCalendar(c: IcsCalendar): string {
  const stamp = stampOf(c.stamp ?? new Date());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${c.host}//calendar//${c.lang.toUpperCase()}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEscape(c.name)}`,
    ...(c.description ? [`X-WR-CALDESC:${icsEscape(c.description)}`] : []),
    // All-day events carry no time zone; this only names the calendar's home for apps that ask.
    'X-WR-TIMEZONE:Asia/Tehran',
    'REFRESH-INTERVAL;VALUE=DURATION:PT12H',
    'X-PUBLISHED-TTL:PT12H',
    ...c.events.flatMap((e) => vevent(e, stamp, c.host)),
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}

/** Google Calendar's "add this event" page (Android's calendar, any browser): an all-day event on `date`. */
export function googleEventUrl(e: { date: string; summary: string; description?: string; url?: string }) {
  const q = new URLSearchParams({ action: 'TEMPLATE', text: e.summary, dates: `${icsDay(e.date)}/${icsNextDay(e.date)}`, details: [e.description, e.url].filter(Boolean).join('\n\n'), ...(e.url && { location: e.url }) });
  return `https://calendar.google.com/calendar/render?${q}`;
}
/** Google Calendar's "subscribe to this calendar" page, for a webcal:// address. */
export const googleSubscribeUrl = (https: string) => `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(https.replace(/^https?:/, 'webcal:'))}`;
/** Outlook.com's "subscribe from web". */
export const outlookSubscribeUrl = (https: string, name: string) => `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(https)}&name=${encodeURIComponent(name)}`;
