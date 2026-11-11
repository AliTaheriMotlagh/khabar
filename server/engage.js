// GET /api/engage?ids=1,2,3 → { "1": { r: { like: 3, … }, c: 2, v: 40 }, … }  (reactions, comments, views)
// One Redis round trip for a whole page of the feed (one HMGET per reaction), cached briefly on the CDN.
// Views count each reader once per 24 hours (see live.js); posts without a count yet take one more trip, once.
import { REACTIONS, configured, fail, json, postId, postViews, preflight, redis } from './_lib.js';

export const OPTIONS = preflight;

export async function GET(request) {
  if (!configured()) return fail(request, 503, 'not configured');
  const ids = [...new Set((new URL(request.url).searchParams.get('ids') || '').split(',').map(postId).filter(Boolean))].slice(0, 60);
  if (!ids.length) return json(request, {});
  const [rows, views] = await Promise.all([
    redis(...REACTIONS.map((r) => ['HMGET', `h:react:${r}`, ...ids]), ['HMGET', 'h:comments', ...ids]),
    postViews(ids),
  ]);
  const out = {};
  ids.forEach((id, i) => {
    const r = {};
    REACTIONS.forEach((name, j) => {
      const n = Number(rows[j][i]) || 0;
      if (n > 0) r[name] = n;
    });
    const c = Number(rows[REACTIONS.length][i]) || 0;
    const v = views[i] || 0;
    if (c || v || Object.keys(r).length) out[id] = { r, c, v };
  });
  return json(request, out, { cache: 20 });
}
