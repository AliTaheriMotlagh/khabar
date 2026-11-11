// Readers per day and the most viewed stories, shared by stats.js (the visits page) and toprss.js (the weekly feed).
// Readers per day are the HyperLogLogs live.js keeps (`u:<day>`); a post's views per day are `dv:<day>` (live.js), all
// time `h:uviews`. One pipeline: 7 + 7 + 1 commands.
import { day, redis } from './_lib.js';

export const TOP = 10;
const hash = (flat) => {
  const out = new Map();
  for (let i = 0; i + 1 < (flat?.length ?? 0); i += 2) out.set(flat[i], Number(flat[i + 1]) || 0);
  return out;
};
const top = (counts, n) =>
  [...counts]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1] || Number(b[0]) - Number(a[0]))
    .slice(0, n)
    .map(([id, views]) => ({ id: Number(id), views }));

/** The last 7 Tehran days (oldest first, today last), their readers, and the top `n` stories today, this week, ever. */
export async function readStats(n = TOP) {
  // Noon-to-noon steps land on each Tehran day once, whatever the hour.
  const days = [...new Set(Array.from({ length: 8 }, (_, k) => day(Date.now() - (7 - k) * 864e5)))].slice(-7);
  const res = await redis(...days.map((d) => ['PFCOUNT', `u:${d}`]), ...days.map((d) => ['HGETALL', `dv:${d}`]), ['HGETALL', 'h:uviews']);
  const readers = res.slice(0, days.length);
  const perDay = res.slice(days.length, days.length * 2).map(hash);
  const week = new Map();
  for (const h of perDay) for (const [id, v] of h) week.set(id, (week.get(id) ?? 0) + v);
  return {
    days: days.map((d, i) => ({ day: d, readers: Number(readers[i]) || 0 })),
    top: { today: top(perDay.at(-1), n), week: top(week, n), all: top(hash(res.at(-1)), n) },
  };
}
