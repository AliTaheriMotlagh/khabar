// Announces new stories to readers with notifications on (server/push.js), from the site workflow after a crawl brought
// news. Waits until the live site serves the new build (its recent.json lists LATEST), so a tap on the notification
// never lands on a page that isn't there yet; gives up quietly after 10 minutes — the next run announces them then.
// The server announces each post once, so sending a post twice (or from a re-run) does no harm.
// Env: PUSH_SECRET (without it notifications are off and this does nothing), SITE (the primary site), LATEST.
const SITE = (process.env.SITE || 'https://khabar-ai.vercel.app').replace(/\/$/, '');
const SECRET = process.env.PUSH_SECRET?.trim();
const LATEST = Number(process.env.LATEST) || 0;
const WINDOW = 6 * 3600_000; // only posts from the last hours are news
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!SECRET) {
  console.log('PUSH_SECRET is not set: notifications are off.');
  process.exit(0);
}
const deadline = Date.now() + 10 * 60_000;
let recent = null;
for (;;) {
  recent = await fetch(`${SITE}/recent.json?t=${Date.now()}`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null), () => null);
  if (recent && recent.latest >= LATEST) break;
  if (Date.now() > deadline) {
    console.log(`The site doesn't list post ${LATEST} yet; the next run will announce it.`);
    process.exit(0);
  }
  await sleep(20_000);
}
const since = Date.now() - WINDOW;
const posts = recent.posts.filter((p) => Date.parse(p.date) >= since).map(({ id, title, tags, kind }) => ({ id, title, tags, kind }));
if (!posts.length) {
  console.log('Nothing new to announce.');
  process.exit(0);
}
const res = await fetch(`${SITE}/api/push/`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SECRET}` },
  body: JSON.stringify({ action: 'send', posts }),
});
const out = await res.text();
console.log(`push ${res.status}: ${out}`);
// 501: the site has no VAPID keys yet — not a failure of this run.
if (!res.ok && res.status !== 501) process.exit(1);
