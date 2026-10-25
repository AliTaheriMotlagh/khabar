import { feedRev } from '../lib/posts';

// Polled by open pages (src/scripts/social.ts) to notice that a newer build has the channel's latest news.
export function GET() {
  return new Response(JSON.stringify(feedRev()), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
