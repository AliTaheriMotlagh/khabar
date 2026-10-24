// POST /api/live { guest, post?, view?, name? } → { online, chat, today?, total?, views? }  (chat = newest chat message id)
// Called once per page view (view: true counts the visit) and then as a slow heartbeat while the tab is visible.
// Presence is a sorted set of guest hashes scored by last-seen time; "online" = seen in the last 2 minutes.
import { POINTS, award, cleanText, configured, day, fail, guestId, hash, json, limited, nameCmd, postId, preflight, readBody, redis } from './_lib.js';

const ONLINE_WINDOW = 120_000;

export const OPTIONS = preflight;

export async function POST(request) {
  if (!configured()) return fail(request, 503, 'not configured');
  const body = await readBody(request);
  const guest = guestId(body?.guest);
  if (!guest) return fail(request, 400, 'bad request');
  if (await limited(request, 'live', 30, 60)) return fail(request, 429, 'slow down');

  const gh = hash(guest);
  const now = Date.now();
  const post = postId(body.post);
  const cmds = [['ZADD', 'online', String(now), gh], ['ZCOUNT', 'online', String(now - ONLINE_WINDOW), '+inf'], ['LINDEX', 'chat', '0']];
  if (Math.random() < 0.05) cmds.push(['ZREMRANGEBYSCORE', 'online', '0', String(now - ONLINE_WINDOW)]);
  if (body.view) {
    cmds.push(['INCR', 'views:total'], ['PFADD', `u:${day()}`, gh], ['PFCOUNT', `u:${day()}`]);
    if (post) cmds.push(['HINCRBY', 'h:views', post, '1'], ['SADD', `v:${post}`, gh]);
    cmds.push(...nameCmd(gh, cleanText(body.name, 32).replace(/\n/g, ' ')));
  }
  const res = await redis(...cmds);
  const out = { online: Math.max(1, Number(res[1]) || 0), chat: res[2] ? JSON.parse(res[2]).id : null };
  if (body.view) {
    const i = cmds.findIndex((c) => c[0] === 'INCR');
    out.total = Number(res[i]) || 0;
    out.today = Number(res[i + 2]) || 0;
    if (post) {
      out.views = Number(res[i + 3]) || 0;
      if (res[i + 4]) await redis(...award(gh, POINTS.read)); // first time this guest opened this post
    }
  }
  return json(request, out);
}
