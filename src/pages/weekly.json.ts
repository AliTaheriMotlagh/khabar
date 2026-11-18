import { weeklies } from '../lib/knowledge';

// The newest weekly recap's key and title (pipeline/daily.py --weekly): the weekly workflow waits for it to be live
// before it sends the notification (scripts/notify.mjs --weekly).
export function GET() {
  const w = weeklies()[0];
  return new Response(JSON.stringify(w ? { week: w.week, title: w.title } : {}), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
