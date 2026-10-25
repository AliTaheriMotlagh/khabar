// GET  /api/sync/ → { running, last }: is a crawl queued or running, and when the last one finished.
// POST /api/sync/ { guest } → { queued, running, last }: a reader asks for a crawl now instead of waiting for the schedule.
// It starts the site workflow (.github/workflows/site.yml) through GitHub's API: needs GITHUB_DISPATCH_TOKEN, a
// fine-grained token with *Actions: Read and write* on this repo only. Without it the site hides the button (501).
// GitHub's own run list is the state, so a request while a crawl is queued or running, or right after one, starts nothing.
import { configured, fail, guestId, hash, json, limited, preflight, readBody, redis } from './_lib.js';

const TOKEN = process.env.GITHUB_DISPATCH_TOKEN;
const REPO =
  process.env.GITHUB_REPO ||
  (process.env.VERCEL_GIT_REPO_OWNER && process.env.VERCEL_GIT_REPO_SLUG
    ? `${process.env.VERCEL_GIT_REPO_OWNER}/${process.env.VERCEL_GIT_REPO_SLUG}`
    : 'AliTaheriMotlagh/khabar');
const WORKFLOW = process.env.SYNC_WORKFLOW || 'site.yml';
const BRANCH = process.env.SYNC_BRANCH || 'main';
// A crawl that finished this recently already has the channel's news: another one would find nothing.
const COOLDOWN = Number(process.env.SYNC_COOLDOWN || 180);

const github = (path, init = {}) =>
  fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'khabar',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });

async function status() {
  const res = await github('/runs?per_page=5');
  if (!res.ok) throw new Error(`github ${res.status}`);
  const runs = (await res.json()).workflow_runs ?? [];
  const done = runs.find((r) => r.status === 'completed' && r.conclusion === 'success');
  return { running: runs.some((r) => r.status !== 'completed'), last: done?.updated_at ?? null };
}

export const OPTIONS = preflight;

export async function GET(request) {
  if (!TOKEN) return fail(request, 501, 'not configured');
  try {
    // Every open page may ask while it waits for news: the CDN answers most of them.
    return json(request, await status(), { cache: 15, stale: 30 });
  } catch (e) {
    return fail(request, 502, e.message);
  }
}

export async function POST(request) {
  if (!TOKEN) return fail(request, 501, 'not configured');
  if (!configured()) return fail(request, 503, 'not configured');
  const guest = guestId((await readBody(request))?.guest);
  if (!guest) return fail(request, 400, 'bad request');
  if (await limited(request, ['sync', 6, 3600, hash(guest)], ['sync-ip', 40, 3600])) return fail(request, 429, 'slow down');

  try {
    const st = await status();
    if (st.running || (st.last && Date.now() - Date.parse(st.last) < COOLDOWN * 1000)) return json(request, { queued: false, ...st });
    // A run shows up in the list a few seconds after it is started: two readers tapping at once start one crawl.
    const lock = `sync:lock:${Math.floor(Date.now() / 60_000)}`;
    const [n] = await redis(['INCR', lock], ['EXPIRE', lock, '120']);
    if (n > 1) return json(request, { queued: false, ...st, running: true });

    const res = await github('/dispatches', { method: 'POST', body: JSON.stringify({ ref: BRANCH }) });
    if (!res.ok) return fail(request, 502, `github ${res.status}`);
    return json(request, { queued: true, running: true, last: st.last });
  } catch (e) {
    return fail(request, 502, e.message);
  }
}
