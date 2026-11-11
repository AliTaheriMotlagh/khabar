// Deletes old Vercel deployments of the site, so Deployment Storage stays small. Every data commit redeploys the whole
// site (~200 MB of pages), many times a day, and the Hobby plan has 10 GB: past it, deploys are blocked. A deleted
// deployment stops counting at once. Kept: the live one (whatever the production domain points to — never deleted,
// even after a rollback), the newest KEEP ready production deployments (to roll back to), anything still building,
// and anything younger than an hour. Everything else (older production, failed and preview deployments) goes. If the
// live deployment can't be found, nothing is deleted.
//
// Runs in the site workflow after a deploy (the `prune` job) when the VERCEL_TOKEN secret is set; locally:
//   node scripts/vercel-prune.mjs            (DRY_RUN=1 to only list what would go)
// Env: VERCEL_TOKEN (vercel.com/account/tokens, scoped to the site's team; locally the Vercel CLI's login is used if
// unset), VERCEL_PROJECT_ID (id or name, default khabar-ai), VERCEL_TEAM_ID (the team's id, team_…; locally
// .vercel/project.json's orgId), SITE (the production domain), KEEP (default 3).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const API = 'https://api.vercel.com';
const HOUR = 3600_000;
const IN_FLIGHT = ['BUILDING', 'QUEUED', 'INITIALIZING'];

/** Which deployments to delete: pure, so it can be tested (tests/prune.test.mjs). */
export function toDelete(deployments, { live, keep = 3, now = Date.now() }) {
  if (!live) return [];
  const ready = deployments.filter((d) => d.target === 'production' && d.state === 'READY').sort((a, b) => b.created - a.created);
  const kept = new Set([live, ...ready.slice(0, keep).map((d) => d.uid)]);
  return deployments.filter((d) => !kept.has(d.uid) && !IN_FLIGHT.includes(d.state) && now - d.created > HOUR && d.state !== 'DELETED');
}

function cliToken() {
  const dirs = [path.join(os.homedir(), 'Library/Application Support/com.vercel.cli'), path.join(os.homedir(), '.local/share/com.vercel.cli'), path.join(os.homedir(), '.vercel')];
  for (const d of dirs) {
    try {
      return JSON.parse(fs.readFileSync(path.join(d, 'auth.json'), 'utf8')).token;
    } catch {}
  }
  return null;
}
function linkedTeam() {
  try {
    return JSON.parse(fs.readFileSync('.vercel/project.json', 'utf8')).orgId;
  } catch {
    return null;
  }
}

async function main() {
  const token = process.env.VERCEL_TOKEN || cliToken();
  if (!token) {
    console.log('No VERCEL_TOKEN (and no Vercel CLI login): nothing pruned.');
    return;
  }
  const project = process.env.VERCEL_PROJECT_ID || 'khabar-ai';
  const team = process.env.VERCEL_TEAM_ID || linkedTeam();
  const site = (process.env.SITE || 'https://khabar-ai.vercel.app').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const keep = Math.max(1, Number(process.env.KEEP) || 3);
  const dry = process.env.DRY_RUN === '1';
  const call = async (p, init = {}) => {
    const u = new URL(p, API);
    if (team) u.searchParams.set('teamId', team);
    const res = await fetch(u, { ...init, headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`${init.method || 'GET'} ${u.pathname}: ${res.status} ${(await res.text()).slice(0, 200)}`);
    return res.json();
  };

  // What the production domain serves right now.
  const live = (await call(`/v13/deployments/${encodeURIComponent(site)}`)).id;
  if (!live) throw new Error(`can't tell which deployment ${site} serves: nothing deleted`);

  const all = [];
  for (let until = null, pages = 0; pages < 50; pages++) {
    const q = new URLSearchParams({ projectId: project, limit: '100', ...(until && { until: String(until) }) });
    const { deployments, pagination } = await call(`/v7/deployments?${q}`);
    all.push(...deployments.map((d) => ({ uid: d.uid, created: d.created, state: d.state ?? d.readyState, target: d.target ?? null, url: d.url })));
    if (!pagination?.next) break;
    until = pagination.next;
  }
  const gone = toDelete(all, { live, keep });
  console.log(`${all.length} deployments; live ${live}; keeping ${all.length - gone.length}; ${dry ? 'would delete' : 'deleting'} ${gone.length}.`);
  let failed = 0;
  for (const d of gone) {
    if (dry) {
      console.log(`  ${d.uid} ${d.state} ${d.target ?? 'preview'} ${new Date(d.created).toISOString()}`);
      continue;
    }
    try {
      await call(`/v13/deployments/${d.uid}`, { method: 'DELETE' });
    } catch (e) {
      failed++;
      console.log(`  ${d.uid}: ${e.message}`);
    }
  }
  if (failed) console.log(`${failed} not deleted (the next run tries again).`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
