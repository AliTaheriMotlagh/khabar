// The owner's page (src/pages/admin): everything behind `Authorization: Bearer ADMIN_TOKEN`; 501 without one.
// GET  /api/admin → { totals, hours: { today, yesterday } (new visits by Tehran hour), sources (7 days),
//                     reports (most reported comments, with the comment), recent (newest comments site-wide),
//                     crawl (GITHUB_DISPATCH_TOKEN's health and the site workflow's last runs, see crawlHealth),
//                     readers (30 Tehran days, oldest first), events (what readers used, 7 days: live.js `ev:<day>`),
//                     tts (Azure characters this month and last, vs the free 500K), push (subscribers by mode, sent in
//                     7 days), top (most read today / this week), engagement (comments and reactions: totals, most) }
//                     flags (comments the model flagged as insult/spam/off-topic: pipeline/comments.py → `flags`)
// POST /api/admin { action: 'hide' | 'unhide' | 'dismiss' | 'delete' | 'unflag', post, id }   moderate one comment
// Wrong tokens are counted per address and refused for an hour after a handful, so the token can't be guessed.
import { timingSafeEqual } from 'node:crypto';
import { REACTIONS, configured, day, fail, github, githubToken, json, limited, postId, preflight, readBody, redis } from './_lib.js';
import { readStats } from './_stats.js';
import { commentId, deleteComment, findComment, hideComment, publicView, unhideComment } from './_moderation.js';

export const OPTIONS = preflight;

function authorized(request) {
  const token = process.env.ADMIN_TOKEN;
  const given = (request.headers.get('authorization') || '').replace(/^Bearer /, '');
  if (!token || !given) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** 401 for a wrong token (and 429 after too many), null when the caller is the owner. */
async function guard(request) {
  if (!configured() || !process.env.ADMIN_TOKEN) return fail(request, 501, 'not configured');
  if (authorized(request)) return null;
  if (await limited(request, ['admin-fail', 10, 3600])) return fail(request, 429, 'too many tries');
  return fail(request, 401, 'unauthorized');
}

const pairs = (flat) => {
  const out = [];
  for (let i = 0; i + 1 < (flat?.length ?? 0); i += 2) out.push([flat[i], Number(flat[i + 1]) || 0]);
  return out;
};
const hours = (flat) => {
  const h = new Array(24).fill(0);
  for (const [k, v] of pairs(flat)) if (Number(k) >= 0 && Number(k) < 24) h[Number(k)] = v;
  return h;
};

/** Is the crawl healthy? GITHUB_DISPATCH_TOKEN starts it (/api/watch, /api/sync): when it expires, new posts wait for
 *  GitHub's schedule (hours). GitHub names a token's expiry in a response header, so the page warns weeks ahead. */
export async function crawlHealth() {
  if (!githubToken()) return { token: 'missing' };
  try {
    const res = await github('/runs?per_page=10');
    const expiry = res.headers.get('github-authentication-token-expiration');
    const expires = expiry ? new Date(expiry.replace(' UTC', 'Z').replace(' ', 'T')).toISOString() : null;
    if (!res.ok) return { token: res.status === 401 || res.status === 403 ? 'unauthorized' : 'error', status: res.status, expires };
    const runs = ((await res.json()).workflow_runs ?? []).filter((r) => r.status === 'completed');
    const ok = runs.find((r) => r.conclusion === 'success');
    return {
      token: 'ok',
      expires,
      lastSuccess: ok?.updated_at ?? null,
      // Failures since the last success: one is a hiccup, several in a row is a broken build.
      failing: ok ? runs.indexOf(ok) : runs.length,
      lastFailure: runs.find((r) => r.conclusion === 'failure')?.html_url ?? null,
    };
  } catch (e) {
    return { token: 'error', status: 0, error: e.message };
  }
}

const sumHash = (flat) => pairs(flat).reduce((n, [, v]) => n + v, 0);
const topOf = (flat, n = 5) => pairs(flat).sort((a, b) => b[1] - a[1]).slice(0, n).map(([id, count]) => ({ id: Number(id), count }));
const month = (offset = 0) => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - offset);
  return d.toISOString().slice(0, 7);
};
export const TTS_FREE = 500_000;

/** Everything else the owner's page shows, in two round trips (the readers' days, events, usage; then the stats). */
async function moreStats() {
  // Noon-to-noon steps land on each Tehran day once.
  const days30 = [...new Set(Array.from({ length: 31 }, (_, k) => day(Date.now() - (30 - k) * 864e5)))].slice(-30);
  const days7 = days30.slice(-7);
  const [subs, sent, chars, clips, comments, ...rest] = await redis(
    ['HGETALL', 'push:subs'],
    ['ZCOUNT', 'push:sent', String(Date.now() - 7 * 864e5), '+inf'],
    ['HGETALL', 'tts:chars'],
    ['HGETALL', 'tts:clips'],
    ['HGETALL', 'h:comments'],
    ...REACTIONS.map((r) => ['HGETALL', `h:react:${r}`]),
    ...days30.map((d) => ['PFCOUNT', `u:${d}`]),
    ...days7.map((d) => ['HGETALL', `ev:${d}`]),
  );
  const reacts = rest.slice(0, REACTIONS.length);
  const readers = rest.slice(REACTIONS.length, REACTIONS.length + days30.length);
  const evs = rest.slice(REACTIONS.length + days30.length);
  const modes = {};
  for (let i = 1; i < (subs?.length ?? 0); i += 2) {
    try {
      const m = JSON.parse(subs[i]).mode || 'all';
      modes[m] = (modes[m] ?? 0) + 1;
    } catch {}
  }
  const events = {};
  for (const flat of evs) for (const [k, v] of pairs(flat)) events[k] = (events[k] ?? 0) + v;
  const byPostReactions = new Map();
  for (const flat of reacts) for (const [id, v] of pairs(flat)) byPostReactions.set(id, (byPostReactions.get(id) ?? 0) + v);
  const tts = new Map(pairs(chars));
  const ttsClips = new Map(pairs(clips));
  const stats = await readStats(10).catch(() => null);
  return {
    readers: days30.map((d, i) => ({ day: d, readers: Number(readers[i]) || 0 })),
    events: { days: days7.length, counts: events, today: Object.fromEntries(pairs(evs.at(-1))) },
    tts: { free: TTS_FREE, month: month(), chars: tts.get(month()) ?? 0, clips: ttsClips.get(month()) ?? 0, last: { month: month(1), chars: tts.get(month(1)) ?? 0 } },
    push: { modes, sent7: Number(sent) || 0 },
    top: stats ? { today: stats.top.today, week: stats.top.week } : null,
    engagement: {
      comments: sumHash(comments),
      reactions: REACTIONS.map((r, i) => ({ reaction: r, count: sumHash(reacts[i]) })),
      mostCommented: topOf(comments),
      mostReacted: [...byPostReactions].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, count]) => ({ id: Number(id), count })),
    },
  };
}

export async function GET(request) {
  const denied = await guard(request);
  if (denied) return denied;
  const crawl = crawlHealth();
  const days = Array.from({ length: 7 }, (_, k) => day(Date.now() - k * 864e5));
  const [today, yesterday, reports, recent, total, online, subs, flagged, ...sources] = await redis(
    ['HGETALL', `vh:${days[0]}`],
    ['HGETALL', `vh:${days[1]}`],
    ['ZREVRANGE', 'reports', '0', '29', 'WITHSCORES'],
    ['LRANGE', 'c:recent', '0', '49'],
    ['GET', 'visits:total'],
    ['ZCOUNT', 'online', String(Date.now() - 120_000), '+inf'],
    ['HLEN', 'push:subs'],
    ['HGETALL', 'flags'],
    ...days.map((d) => ['HGETALL', `ref:${d}`]),
  );
  const more = moreStats();
  const bySource = new Map();
  for (const flat of sources) for (const [k, v] of pairs(flat)) bySource.set(k, (bySource.get(k) ?? 0) + v);

  // The reported comments, with their text and whether they are hidden (one look per story).
  const reported = pairs(reports).map(([key, n]) => ({ post: key.split(':')[0], id: key.split(':')[1], reports: n }));
  const flags = [];
  for (let i = 0; i + 1 < (flagged?.length ?? 0); i += 2) {
    try {
      const [post, id] = flagged[i].split(':');
      flags.push({ post, id, ...JSON.parse(flagged[i + 1]) });
    } catch {}
  }
  const posts = [...new Set([...reported.map((r) => r.post), ...flags.map((f) => f.post)])];
  const lists = posts.length ? await redis(...posts.flatMap((p) => [['LRANGE', `c:${p}`, '0', '299'], ['SMEMBERS', `ch:${p}`]])) : [];
  const byPost = new Map(posts.map((p, i) => [p, { rows: lists[i * 2].map((r) => JSON.parse(r)), hidden: new Set(lists[i * 2 + 1]) }]));
  const hiddenOf = (post, id) => byPost.get(String(post))?.hidden.has(id) ?? false;

  return json(request, {
    totals: { visits: Number(total) || 0, online: Number(online) || 0, subscribers: Number(subs) || 0, reported: reported.length },
    hours: { today: hours(today), yesterday: hours(yesterday) },
    sources: [...bySource].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([source, visits]) => ({ source, visits })),
    reports: reported.map((r) => {
      const c = byPost.get(r.post)?.rows.find((x) => x.id === r.id);
      return { ...r, post: Number(r.post), hidden: hiddenOf(r.post, r.id), comment: c ? publicView(c) : null };
    }),
    recent: recent.map((r) => JSON.parse(r)),
    flags: flags
      .map((f) => {
        const c = byPost.get(f.post)?.rows.find((x) => x.id === f.id);
        return { post: Number(f.post), id: f.id, why: f.why, at: f.at, hidden: hiddenOf(f.post, f.id), comment: c ? publicView(c) : null };
      })
      .filter((f) => f.comment && !f.hidden),
    crawl: await crawl,
    ...(await more),
  });
}

export async function POST(request) {
  const denied = await guard(request);
  if (denied) return denied;
  const body = await readBody(request);
  const post = postId(body?.post);
  const id = commentId(body?.id);
  if (!post || !id) return fail(request, 400, 'bad request');
  switch (body.action) {
    case 'hide':
      await hideComment(post, id);
      return json(request, { ok: true, hidden: true });
    case 'unhide':
      await unhideComment(post, id);
      return json(request, { ok: true, hidden: false });
    case 'dismiss':
      // Reports looked at and found fine: forget them, leave the comment as it is.
      await redis(['DEL', `cr:${post}:${id}`], ['ZREM', 'reports', `${post}:${id}`]);
      return json(request, { ok: true });
    case 'unflag':
      await redis(['HDEL', 'flags', `${post}:${id}`]);
      return json(request, { ok: true });
    case 'delete': {
      const found = await findComment(post, id);
      if (!found) return fail(request, 404, 'not found');
      await deleteComment(post, found);
      return json(request, { ok: true });
    }
    default:
      return fail(request, 400, 'bad action');
  }
}
