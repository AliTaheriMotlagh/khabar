// GET|POST /api/watch/?key=<WATCH_SECRET> → { queued, reason }: starts a crawl as soon as the channel has news, instead
// of waiting for the 20-minute schedule. Called every minute by an external cron (e.g. cron-job.org); see README.
// News = a post newer than the newest crawl (once Gholam has commented on it, or GRACE seconds after it appeared: he
// answers within ~30 s and skips the daily digests), or Gholam's comment on a recent post newer than that crawl.
// Stateless: the channel's page and GitHub's run list are the state, so no Redis. Most minutes cost one t.me fetch.
// Needs WATCH_SECRET and GITHUB_DISPATCH_TOKEN (see _lib.js); 501 without them.
import { dispatch, fail, github, githubToken, json, preflight } from './_lib.js';

const CHANNEL = process.env.TG_CHANNEL || 'dlmehr';
// Only posts this recent are looked at: older ones are left to the schedule.
const WINDOW = Number(process.env.WATCH_MINUTES || 60) * 60_000;
const GRACE = Number(process.env.WATCH_GRACE || 180) * 1000;
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

/** When the newest crawl that will have (or had) a look at the channel was started (ms), or 0. A cancelled run was a
 *  queued one replaced by a newer one; a failed one is retried by the schedule. */
async function lastCrawl() {
  const res = await github('/runs?per_page=5');
  if (!res.ok) throw new Error(`github ${res.status}`);
  const run = ((await res.json()).workflow_runs ?? []).find((r) => r.conclusion !== 'cancelled');
  return run ? Date.parse(run.created_at) : 0;
}

/** Why a crawl should start now, or null. */
async function news(now = Date.now()) {
  const recent = parseChannel(await tme(`s/${CHANNEL}`))
    .filter((p) => now - p.at < WINDOW)
    .slice(-5);
  if (!recent.length) return null;
  const since = await lastCrawl();
  // A widget that can't be read counts as "no comment yet": GRACE still lets the post through.
  const gholam = await Promise.all(
    recent.map((p) => tme(`${CHANNEL}/${p.id}?embed=1&discussion=1&comments_limit=30`).then(parseGholam, () => 0)),
  );
  for (const [i, p] of recent.entries()) {
    if (p.at > since && (gholam[i] || now - p.at > GRACE)) return `post ${p.id}`;
    if (p.at <= since && gholam[i] > since) return `gholam ${p.id}`;
  }
  return null;
}

async function handle(request) {
  const secret = process.env.WATCH_SECRET;
  if (!secret || !githubToken()) return fail(request, 501, 'not configured');
  const key = new URL(request.url).searchParams.get('key') ?? request.headers.get('authorization')?.replace(/^Bearer /, '');
  if (key !== secret) return fail(request, 401, 'unauthorized');
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

export const OPTIONS = preflight;
export const GET = handle;
export const POST = handle;
