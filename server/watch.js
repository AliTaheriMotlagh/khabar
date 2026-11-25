// GET|POST /api/watch/?key=<WATCH_SECRET> → { queued, reason }: starts a crawl as soon as the channel has news, instead
// of waiting for the 20-minute schedule. Called every minute by the Worker in workers/watch/ (a Cloudflare cron
// trigger, without the key: the shared tick below) and by any external cron with the key; see README.
// News = a post newer than the newest crawl (once Gholam has commented on it, or GRACE seconds after it appeared: he
// answers within ~30 s and skips the daily digests), or Gholam's comment on a recent post newer than that crawl, or a
// post that crawl held back waiting for him (HOLD) once the hold is over.
// Stateless: the channel's page and GitHub's run list are the state, so no Redis. Most minutes cost one t.me fetch.
// Needs WATCH_SECRET and GITHUB_DISPATCH_TOKEN (see _lib.js); 501 without them.
import { dispatch, fail, github, githubToken, json, preflight } from './_lib.js';

const CHANNEL = process.env.TG_CHANNEL || 'dlmehr';
// Only posts this recent get their discussion read (Gholam's comment, the hold). Any post newer than the newest crawl
// starts one, however old: a post that nobody looked at within this window (the cron down, no page open) used to wait
// for GitHub's schedule, which skips hours at a time (posts 6734–6735 on 11-25 waited 2 h).
const WINDOW = Number(process.env.WATCH_MINUTES || 60) * 60_000;
const GRACE = Number(process.env.WATCH_GRACE || 180) * 1000;
// The crawl holds a new post without Gholam's comment off the site this long (pipeline/config.py GHOLAM_HOLD_MINUTES):
// a crawl that started within it gets one more after it, so a post he never translates isn't stranded until the schedule.
const HOLD = Number(process.env.WATCH_HOLD || 600) * 1000;
const GHOLAM_NAME = 'غلام';
const GHOLAM_SIGNATURE = 'داش غلام';

const tme = async (path) => {
  const res = await fetch(`https://t.me/${path}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; khabar)' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`t.me ${res.status}`);
  return res.text();
};

/** The posts on the channel's public page: [{ id, at }] (ms). */
export function parseChannel(html) {
  return html
    .split(`data-post="${CHANNEL}/`)
    .slice(1)
    .map((part) => ({
      id: Number(part.match(/^\d+/)?.[0]),
      at: Date.parse(part.match(/class="[^"]*tgme_widget_message_date[^"]*"[^>]*>\s*<time[^>]*datetime="([^"]+)"/)?.[1]),
    }))
    .filter((p) => p.id && p.at);
}

/** When Gholam last commented in a post's discussion widget (ms), or 0. */
export function parseGholam(html) {
  const comments = html.split('tme_widget_discussion').slice(1).join('');
  let at = 0;
  for (const msg of comments.split(/(?=<div[^>]*class="[^"]*\btgme_widget_message\b)/)) {
    const author = msg.match(/class="[^"]*author_name[^"]*"[^>]*>([^<]*)</)?.[1] ?? '';
    if (!author.includes(GHOLAM_NAME) && !msg.includes(GHOLAM_SIGNATURE)) continue;
    at = Math.max(at, Date.parse(msg.match(/<time[^>]*datetime="([^"]+)"/)?.[1]) || 0);
  }
  return at;
}

// A failed crawl counts as one for this long after it ended, then another is started (GitHub's schedule is too
// unreliable to be the retry); a crawl that keeps failing is so retried about as often as the schedule would.
const RETRY = Number(process.env.WATCH_RETRY || 1200) * 1000;

/** When the newest crawl that will have (or had) a look at the channel was started (ms), or 0. A cancelled run was a
 *  queued one replaced by a newer one. A code push's run doesn't crawl. */
export const isCrawl = (r, now = Date.now()) =>
  r.event !== 'push' &&
  r.conclusion !== 'cancelled' &&
  !(r.conclusion === 'failure' && now - Date.parse(r.updated_at ?? r.created_at) > RETRY);
async function lastCrawl(now) {
  const res = await github('/runs?per_page=10');
  if (!res.ok) throw new Error(`github ${res.status}`);
  const run = ((await res.json()).workflow_runs ?? []).find((r) => isCrawl(r, now));
  return run ? Date.parse(run.created_at) : 0;
}

/** Why a crawl should start now, or null. */
async function news(now = Date.now()) {
  const posts = parseChannel(await tme(`s/${CHANNEL}`));
  if (!posts.length) return null;
  const since = await lastCrawl(now);
  // Past the grace a new post needs no look at its discussion.
  const missed = posts.find((p) => p.at > since && now - p.at > GRACE);
  if (missed) return `post ${missed.id}`;
  const recent = posts.filter((p) => now - p.at < WINDOW).slice(-5);
  // A widget that can't be read counts as "no comment yet": GRACE still lets the post through.
  const gholam = await Promise.all(
    recent.map((p) => tme(`${CHANNEL}/${p.id}?embed=1&discussion=1&comments_limit=30`).then(parseGholam, () => 0)),
  );
  for (const [i, p] of recent.entries()) {
    if (p.at > since && (gholam[i] || now - p.at > GRACE)) return `post ${p.id}`;
    if (p.at <= since && gholam[i] > since) return `gholam ${p.id}`;
    if (p.at <= since && since - p.at < HOLD && now - p.at > HOLD && !gholam[i]) return `held ${p.id}`;
  }
  return null;
}

async function check(request) {
  try {
    const reason = await news();
    if (reason) {
      const res = await dispatch();
      if (!res.ok) return fail(request, 502, `github ${res.status}`);
    }
    return json(request, { queued: Boolean(reason), reason });
  } catch (e) {
    return fail(request, 502, e.message);
  }
}

// Without the key: a "tick" from an open page (src/scripts/social.ts), so the site keeps up with the channel even when
// the external cron is down (it called the old Vercel address for days after that was switched off). The answer is
// shared for TICK seconds — Cloudflare's cache in this data centre, else this instance's memory — so however many
// readers tick, the channel and GitHub are asked about once a minute.
// 50 s, not 60: the Worker in workers/watch/ calls it every minute, and a 60-s answer would still be fresh a minute later.
const TICK = Number(process.env.WATCH_TICK || 50);
let last = { at: 0, body: null };
async function tick(request) {
  const cache = globalThis.caches?.default;
  const key = new Request(new URL('/api/watch/?tick=1', request.url).href);
  if (cache) {
    const hit = await cache.match(key).catch(() => null);
    if (hit) return hit;
  } else if (Date.now() - last.at < TICK * 1000) return json(request, { ...last.body, shared: true });
  const res = await check(request);
  const body = await res.clone().json().catch(() => ({}));
  last = { at: Date.now(), body };
  if (cache) {
    const keep = new Response(JSON.stringify({ ...body, shared: true }), {
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': `public, max-age=${TICK}` },
    });
    await cache.put(key, keep).catch(() => {});
  }
  return res;
}

async function handle(request) {
  const secret = process.env.WATCH_SECRET;
  if (!githubToken()) return fail(request, 501, 'not configured');
  const key = new URL(request.url).searchParams.get('key') ?? request.headers.get('authorization')?.replace(/^Bearer /, '');
  if (!key) return tick(request);
  if (!secret) return fail(request, 501, 'not configured');
  if (key !== secret) return fail(request, 401, 'unauthorized');
  return check(request);
}

export const OPTIONS = preflight;
export const GET = handle;
export const POST = handle;
