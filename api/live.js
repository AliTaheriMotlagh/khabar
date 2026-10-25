// POST /api/live { guest, post?, view?, name? } → { online, chat, today?, total?, views? }  (chat = newest chat message id)
// Called once per page view (view: true counts the visit) and then as a slow heartbeat while the tab is visible.
// Presence is a sorted set of guest hashes scored by last-seen time; "online" = seen in the last 2 minutes.
// Visits count like views on X: a reader adds one to the site total, and one to a post, at most once per 24 hours
// (a `SET … NX EX` marker per reader, and per reader and post). today = distinct readers on the Tehran calendar day.
import { POINTS, VIEW_WINDOW, award, cleanText, configured, day, fail, guestId, hash, json, limited, nameCmd, postId, postViews, preflight, readBody, redis } from './_lib.js';

const ONLINE_WINDOW = 120_000;
// The site's first day: the total starts as the sum of each day's distinct readers since then (see seedTotal).
const SINCE = Date.UTC(2026, 9, 23);

export const OPTIONS = preflight;

/** visits:total didn't exist before the 24-hour rule (the old counter went up on every page load): start it from the
 *  distinct readers of every day so far, which is what it would have counted. */
async function seedTotal() {
  const days = [];
  for (let t = SINCE; t <= Date.now() + 864e5; t += 864e5) days.push(new Date(t).toISOString().slice(0, 10), day(t));
  const counts = await redis(...[...new Set(days)].map((d) => ['PFCOUNT', `u:${d}`]));
  const sum = counts.reduce((n, c) => n + (Number(c) || 0), 0);
  await redis(['SET', 'visits:total', String(sum), 'NX']);
}

export async function POST(request) {
  if (!configured()) return fail(request, 503, 'not configured');
  const body = await readBody(request);
  const guest = guestId(body?.guest);
  if (!guest) return fail(request, 400, 'bad request');
  const gh = hash(guest);
  // Per guest only: this is the hottest route, and presence/view counters are low stakes.
  if (await limited(request, ['live', 20, 60, gh])) return fail(request, 429, 'slow down');

  const now = Date.now();
  const post = body.view ? postId(body.post) : null;
  const cmds = [['ZADD', 'online', String(now), gh], ['ZCOUNT', 'online', String(now - ONLINE_WINDOW), '+inf'], ['LINDEX', 'chat', '0']];
  if (Math.random() < 0.05) cmds.push(['ZREMRANGEBYSCORE', 'online', '0', String(now - ONLINE_WINDOW)]);
  if (body.view) {
    const [views] = post ? await postViews([post]) : [0]; // before SADD below, so a post's first count doesn't include this visit
    const at = cmds.length;
    cmds.push(['SET', `vs:${gh}`, '1', 'EX', String(VIEW_WINDOW), 'NX'], ['GET', 'visits:total'], ['PFADD', `u:${day()}`, gh], ['PFCOUNT', `u:${day()}`]);
    if (post) cmds.push(['SET', `vw:${post}:${gh}`, '1', 'EX', String(VIEW_WINDOW), 'NX'], ['SADD', `v:${post}`, gh]);
    cmds.push(...nameCmd(gh, cleanText(body.name, 32).replace(/\n/g, ' ')));
    const res = await redis(...cmds);
    const [newVisit, stored, , today] = res.slice(at, at + 4);
    const [newView, firstRead] = post ? res.slice(at + 4, at + 6) : [];
    if (stored == null) await seedTotal(); // today's readers, this one included: nothing to add on top
    const [total, viewed] = await redis(
      newVisit && stored != null ? ['INCR', 'visits:total'] : ['GET', 'visits:total'],
      ...(newView ? [['HINCRBY', 'h:uviews', post, '1']] : []),
      ...(firstRead ? award(gh, POINTS.read) : []), // first time this guest opened this post
    );
    const out = { online: Math.max(1, Number(res[1]) || 0), chat: res[2] ? JSON.parse(res[2]).id : null, total: Number(total) || 0, today: Number(today) || 0 };
    if (post) out.views = newView ? Number(viewed) || 0 : views;
    return json(request, out);
  }
  const res = await redis(...cmds);
  return json(request, { online: Math.max(1, Number(res[1]) || 0), chat: res[2] ? JSON.parse(res[2]).id : null });
}
