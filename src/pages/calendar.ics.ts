// /calendar.ics: the events of /calendar/ as an iCalendar feed a phone, Google Calendar or Outlook can subscribe to
// (src/lib/calendar.ts; RFC 5545 in src/lib/ics.ts).
import { calendarFile } from '../lib/calendar';

export const GET = () => calendarFile('fa');
