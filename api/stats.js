// GET /api/stats → { days: [{ day, readers }] (the last 7 Tehran days, oldest first, today last),
//                    top: { today, week, all: [{ id, views }] } }
// The visits page (src/pages/stats/index.astro). Readers per day are the HyperLogLogs live.js already keeps (`u:<day>`);
// a post's views per day are `dv:<day>` (live.js), all time `h:uviews`. Online now, today's readers and the total come
// with every page's /api/live call, so they aren't repeated here. One pipeline, cached on the CDN for 10 minutes:
// Upstash bills each command, and these numbers don't need to be fresher.
import { configured, day, fail, json, preflight, redis } from './_lib.js';

export const OPTIONS = preflight;
const TOP = 8;

const hash = (flat) => {
  const out = new Map();
  for (let i = 0; i + 1 < (flat?.length ?? 0); i += 2) out.set(flat[i], Number(flat[i + 1]) || 0);
  return out;
};
const top = (counts) =>
  [...counts]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1] || Number(b[0]) - Number(a[0]))
    .slice(0, TOP)
    .map(([id, views]) => ({ id: Number(id), views }));

export async function GET(request) {
  if (!configured()) return fail(request, 503, 'not configured');
  // Noon-to-noon steps land on each Tehran day once, whatever the hour.
  const days = [...new Set(Array.from({ length: 8 }, (_, k) => day(Date.now() - (7 - k) * 864e5)))].slice(-7);
  const res = await redis(...days.map((d) => ['PFCOUNT', `u:${d}`]), ...days.map((d) => ['HGETALL', `dv:${d}`]), ['HGETALL', 'h:uviews']);
  const readers = res.slice(0, days.length);
  const perDay = res.slice(days.length, days.length * 2).map(hash);
  const week = new Map();
  for (const h of perDay) for (const [id, v] of h) week.set(id, (week.get(id) ?? 0) + v);
  return json(
    request,
    {
      days: days.map((d, i) => ({ day: d, readers: Number(readers[i]) || 0 })),
      top: { today: top(perDay.at(-1)), week: top(week), all: top(hash(res.at(-1))) },
    },
    { cache: 600 },
  );
}
