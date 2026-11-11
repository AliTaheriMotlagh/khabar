// GET /api/stats → { days: [{ day, readers }] (the last 7 Tehran days, oldest first, today last),
//                    top: { today, week, all: [{ id, views }] } }
// The visits page (src/pages/stats/index.astro) and the week's most read (src/pages/week). Online now, today's readers
// and the total come with every page's /api/live call, so they aren't repeated here. Cached on the CDN for 10 minutes:
// Upstash bills each command (see _stats.js), and these numbers don't need to be fresher.
import { configured, fail, json, preflight } from './_lib.js';
import { readStats } from './_stats.js';

export const OPTIONS = preflight;

export async function GET(request) {
  if (!configured()) return fail(request, 503, 'not configured');
  return json(request, await readStats(), { cache: 600 });
}
