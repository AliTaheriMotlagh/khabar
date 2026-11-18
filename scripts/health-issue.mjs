// The site tests' verdict on a data run (.github/workflows/site.yml), kept in one GitHub issue instead of failed runs:
// a crawl brings data from outside, and a check it trips (a new kind of post, a test too strict for real data) should
// hold the Pages mirror back and say so once, not turn every 20-minute run red and email each time. Vercel serves the
// data whatever the tests say; code pushes still fail on them.
//   node scripts/health-issue.mjs <success|failure> [log file]
// Failure: opens the issue (label `site-health`) or updates its body with the latest failing tests and run. Success:
// closes it with a note. Needs GITHUB_TOKEN (issues: write), GITHUB_REPOSITORY, GITHUB_SERVER_URL, GITHUB_RUN_ID.
// Never fails the run itself.
import fs from 'node:fs';

const [outcome, logFile] = process.argv.slice(2);
const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repo, GITHUB_SERVER_URL: server = 'https://github.com', GITHUB_RUN_ID: run } = process.env;
const LABEL = 'site-health';
const TITLE = 'Site tests are failing on the crawled data (Pages mirror held back)';

/** The failing tests' names and first assertion lines from node --test's output, short enough for an issue. */
export function summary(log) {
  const lines = log.split('\n');
  const failing = [...new Set(lines.filter((l) => /^✖ /.test(l.trim())).map((l) => l.trim().replace(/\s*\(\d[\d.]*m?s\)$/, '')))].filter((l) => l !== '✖ failing tests:');
  const why = lines.filter((l) => /AssertionError|Error:/.test(l)).map((l) => l.trim()).slice(0, 8);
  return [...failing, '', ...why].join('\n').trim().slice(0, 3000);
}

async function gh(path, init = {}) {
  const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', ...init.headers },
  });
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function main() {
  if (!token || !repo) return console.log('no GITHUB_TOKEN/GITHUB_REPOSITORY: skipped');
  const open = (await gh(`/issues?state=open&labels=${LABEL}&per_page=5`)).filter((i) => !i.pull_request);
  const link = `${server}/${repo}/actions/runs/${run}`;
  if (outcome === 'success') {
    for (const i of open) {
      await gh(`/issues/${i.number}/comments`, { method: 'POST', body: JSON.stringify({ body: `Passing again in ${link}; the mirror is deployed.` }) });
      await gh(`/issues/${i.number}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed', state_reason: 'completed' }) });
      console.log(`closed #${i.number}`);
    }
    return;
  }
  const log = logFile && fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
  const body = [
    'The crawl committed its data (Vercel serves it), but `tests/site.test.mjs` failed on the build, so the GitHub Pages mirror keeps its last good build. This issue closes itself when they pass again.',
    '',
    `Latest failing run: ${link} (${new Date().toISOString()})`,
    '',
    '```',
    summary(log) || '(no test output)',
    '```',
    '',
    'Usually new data the tests didn\'t expect: fix the page or relax the test, then push (a code push runs every test).',
  ].join('\n');
  if (open.length) {
    // The body follows the latest run: no comment per run, so no email per run.
    await gh(`/issues/${open[0].number}`, { method: 'PATCH', body: JSON.stringify({ body }) });
    console.log(`updated #${open[0].number}`);
  } else {
    await gh('/labels', { method: 'POST', body: JSON.stringify({ name: LABEL, color: 'd73a4a', description: 'site tests failing on crawled data' }) }).catch(() => {});
    const i = await gh('/issues', { method: 'POST', body: JSON.stringify({ title: TITLE, body, labels: [LABEL] }) });
    console.log(`opened #${i.number}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => console.log(`::warning::health issue: ${e.message}`));
