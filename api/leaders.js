// GET /api/leaders → { week: [{ name, points }] } — this week's most active guests (reads, reactions, comments, chat).
import { configured, fail, json, preflight, redis, week } from './_lib.js';

export const OPTIONS = preflight;

export async function GET(request) {
  if (!configured()) return fail(request, 503, 'not configured');
  const [flat] = await redis(['ZREVRANGE', `lb:${week()}`, '0', '9', 'WITHSCORES']);
  const ids = flat.filter((_, i) => i % 2 === 0);
  const [names] = ids.length ? await redis(['HMGET', 'names', ...ids]) : [[]];
  const list = ids.map((id, i) => ({ name: names[i] || `مهمان ${id.slice(0, 4)}`, points: Number(flat[i * 2 + 1]) || 0 }));
  return json(request, { week: list }, { cache: 60 });
}
