// /calendar.ics: the events of /calendar/ (PLAN.md P3-5) as an iCalendar feed a phone or Outlook can subscribe to.
// All-day events; the last month's and everything ahead. RFC 5545: CRLF, lines folded at 75 octets, text escaped.
import type { APIRoute } from 'astro';
import { SITE } from '../site';
import { abs } from '../lib/posts';
import { tehranDay } from '../lib/time';
import { events } from '../lib/tracker';

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
/** Fold a line into ≤75-octet pieces without splitting a UTF-8 character. */
export function fold(line: string): string {
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
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
const day = (d: string) => d.replaceAll('-', '');
const next = (d: string) => day(new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10));

export const GET: APIRoute = () => {
  const since = new Date(Date.parse(tehranDay(Date.now())) - 31 * 86_400_000).toISOString().slice(0, 10);
  const host = new URL(SITE.url).host;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${host}//calendar//FA`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(`رویدادهای هوش مصنوعی — ${SITE.name}`)}`,
    'X-WR-TIMEZONE:Asia/Tehran',
    'REFRESH-INTERVAL;VALUE=DURATION:PT12H',
    ...events()
      .filter((e) => e.date >= since)
      .flatMap((e) => [
        'BEGIN:VEVENT',
        `UID:${e.post.id}-${e.date}@${host}`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${day(e.date)}`,
        `DTEND;VALUE=DATE:${next(e.date)}`,
        `SUMMARY:${esc(e.what)}`,
        `DESCRIPTION:${esc(`${e.post.article.title}\n${abs(`p/${e.post.id}/`)}`)}`,
        `URL:${abs(`p/${e.post.id}/`)}`,
        'END:VEVENT',
      ]),
    'END:VCALENDAR',
  ];
  return new Response(lines.map(fold).join('\r\n') + '\r\n', { headers: { 'Content-Type': 'text/calendar; charset=utf-8' } });
};
