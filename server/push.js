// Notifications of new stories (Web Push, see _push.js). Off — 501 — until VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are set.
// GET  /api/push → { key }                                         the public key a browser subscribes with
// POST /api/push { action: 'subscribe', guest, sub, mode, topics }  mode: 'all' | 'topics' (the followed ones) | 'daily'
// POST /api/push { action: 'unsubscribe', endpoint }
// POST /api/push { action: 'renew', old, sub }                     the service worker, when the browser replaced it
// POST /api/push { action: 'send', posts: [{ id, title, tags, kind }] }   Authorization: Bearer PUSH_SECRET
//      Called by the site workflow (scripts/notify.mjs) once the new stories are live. Each post is announced once
//      (`push:sent`); the very first call only records what is already out, so turning this on announces nothing old.
// Keys: push:subs (hash: endpoint hash → { sub, mode, topics, at }) · push:sent (zset: post id → when announced)
import { cleanText, configured, fail, guestId, hash, json, limited, postId, preflight, readBody, redis } from './_lib.js';
import { sendPush, validSubscription, vapidConfigured } from './_push.js';

export const OPTIONS = preflight;
const MODES = ['all', 'topics', 'daily'];
const SITE_NAME = 'فیوچر فوکوس';
const KEEP_SENT = 30 * 864e5;
const on = () => configured() && vapidConfigured();
const subKey = (endpoint) => hash(`push:${endpoint}`);

export async function GET(request) {
  if (!on()) return fail(request, 501, 'not configured');
  return json(request, { key: process.env.VAPID_PUBLIC_KEY }, { cache: 3600 });
}

export async function POST(request) {
  if (!on()) return fail(request, 501, 'not configured');
  const body = await readBody(request);
  if (!body) return fail(request, 400, 'bad request');
  if (body.action === 'send') return send(request, body);

  if (body.action === 'unsubscribe') {
    if (typeof body.endpoint !== 'string') return fail(request, 400, 'bad request');
    await redis(['HDEL', 'push:subs', subKey(body.endpoint)]);
    return json(request, { ok: true });
  }

  if (body.action === 'renew') {
    const sub = validSubscription(body.sub);
    if (!sub || typeof body.old !== 'string') return fail(request, 400, 'bad request');
    if (await limited(request, ['push-renew', 10, 3600])) return fail(request, 429, 'slow down');
    const [old] = await redis(['HGET', 'push:subs', subKey(body.old)]);
    if (!old) return fail(request, 404, 'unknown');
    await redis(['HSET', 'push:subs', subKey(sub.endpoint), JSON.stringify({ ...JSON.parse(old), sub, at: Date.now() })], ['HDEL', 'push:subs', subKey(body.old)]);
    return json(request, { ok: true });
  }

  if (body.action === 'subscribe') {
    const guest = guestId(body.guest);
    const sub = validSubscription(body.sub);
    const mode = MODES.includes(body.mode) ? body.mode : 'all';
    if (!guest || !sub) return fail(request, 400, 'bad subscription');
    if (await limited(request, ['push-sub', 20, 3600, hash(guest)])) return fail(request, 429, 'slow down');
    const topics = [...new Set((Array.isArray(body.topics) ? body.topics : []).map((t) => cleanText(t, 40)).filter(Boolean))].slice(0, 40);
    await redis(['HSET', 'push:subs', subKey(sub.endpoint), JSON.stringify({ sub, mode, topics, at: Date.now() })]);
    return json(request, { ok: true });
  }
  return fail(request, 400, 'bad action');
}

/** What one subscriber hears about: everything, the stories of their topics, or the daily summary only. */
export function pick(rec, posts) {
  if (rec.mode === 'daily') return posts.filter((p) => p.kind === 'digest');
  if (rec.mode === 'topics') return posts.filter((p) => p.kind !== 'digest' && p.tags.some((t) => rec.topics.includes(t)));
  return posts;
}

/** The notification for a batch: one story by its headline, several as a count with the first headlines. */
export function message(posts, origin) {
  const one = posts.length === 1;
  const first = posts[0];
  return {
    title: one ? first.title : `${posts.length.toLocaleString('fa-IR')} خبر تازه در ${SITE_NAME}`,
    body: one ? (first.kind === 'digest' ? `خلاصه‌ی خبرهای امروز · ${SITE_NAME}` : `${first.tags[0] ? `${first.tags[0]} · ` : ''}${SITE_NAME}`) : posts.slice(0, 3).map((p) => `• ${p.title}`).join('\n'),
    url: one ? `${origin}/p/${first.id}/` : `${origin}/`,
    tag: 'news',
  };
}

async function send(request, body) {
  const secret = process.env.PUSH_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) return fail(request, 401, 'unauthorized');
  const posts = (Array.isArray(body.posts) ? body.posts : [])
    .slice(0, 50)
    .map((p) => ({ id: postId(p?.id), title: cleanText(p?.title, 160).replace(/\n/g, ' '), tags: (Array.isArray(p?.tags) ? p.tags : []).map((t) => cleanText(t, 40)).slice(0, 5), kind: p?.kind === 'digest' ? 'digest' : 'story' }))
    .filter((p) => p.id && p.title);
  if (!posts.length) return json(request, { sent: 0, posts: 0 });

  const now = Date.now();
  const [count] = await redis(['ZCARD', 'push:sent']);
  const added = await redis(...posts.map((p) => ['ZADD', 'push:sent', 'NX', String(now), p.id]), ['ZREMRANGEBYSCORE', 'push:sent', '0', String(now - KEEP_SENT)]);
  // First call ever: what is out already isn't news to anyone.
  if (!Number(count)) return json(request, { sent: 0, posts: 0, seeded: posts.length });
  const fresh = posts.filter((_, i) => Number(added[i]) === 1);
  if (!fresh.length) return json(request, { sent: 0, posts: 0 });

  const origin = (process.env.SITE_URL || new URL(request.url).origin).replace(/\/$/, '');
  const [flat] = await redis(['HGETALL', 'push:subs']);
  const subs = [];
  for (let i = 0; i + 1 < (flat?.length ?? 0); i += 2) {
    try {
      subs.push({ key: flat[i], rec: JSON.parse(flat[i + 1]) });
    } catch {}
  }
  let sent = 0;
  let failed = 0;
  const gone = [];
  // A few at a time: a function has a time limit, and push services rate-limit bursts.
  for (let i = 0; i < subs.length; i += 25) {
    await Promise.all(
      subs.slice(i, i + 25).map(async ({ key, rec }) => {
        const mine = pick(rec, fresh);
        if (!mine.length) return;
        try {
          const status = await sendPush(rec.sub, message(mine, origin), { topic: 'news' });
          if (status === 404 || status === 410) gone.push(key);
          else if (status >= 200 && status < 300) sent++;
          else failed++;
        } catch {
          failed++;
        }
      }),
    );
  }
  if (gone.length) await redis(...gone.map((k) => ['HDEL', 'push:subs', k]));
  return json(request, { sent, failed, removed: gone.length, posts: fresh.length, subscribers: subs.length });
}
