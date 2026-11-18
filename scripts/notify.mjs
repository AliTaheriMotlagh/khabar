// Announces new stories once the live site serves them, from the site workflow after a crawl brought news:
// - to readers with notifications on (server/push.js; needs PUSH_SECRET, else skipped);
// - to search engines through IndexNow (Bing, Yandex, Seznam, Naver… share submissions), so a story can be found
//   minutes after it's posted instead of whenever a crawler passes by. Free, no account: the key is the file
//   /<INDEXNOW_KEY>.txt on the site (public/, src/site.ts).
// Waits until the live site lists LATEST in its recent.json, so a tap (or a crawler) never lands on a page that isn't
// there yet; gives up quietly after 10 minutes — the next run announces them then. The push server announces each post
// once, and IndexNow takes a URL again without harm, so a re-run does no damage.
// Env: PUSH_SECRET, SITE (the primary site), LATEST, INDEXNOW=0 to skip the engines.
const SITE = (process.env.SITE || 'https://khabar-ai.vercel.app').replace(/\/$/, '');
const SECRET = process.env.PUSH_SECRET?.trim();
const LATEST = Number(process.env.LATEST) || 0;
export const INDEXNOW_KEY = 'a2e8b0f25f1440184512d4968ba8125c'; // = SITE.indexNowKey in src/site.ts
const WINDOW = 6 * 3600_000; // only posts from the last hours are news
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The URLs to tell search engines about: the new stories, and the pages that list them. */
export function indexNowBody(site, posts) {
  const host = new URL(site).host;
  const urls = [...new Set([...posts.map((p) => `${site}${p.href}`), `${site}/`, `${site}/today/`])];
  return { host, key: INDEXNOW_KEY, keyLocation: `${site}/${INDEXNOW_KEY}.txt`, urlList: urls.slice(0, 10000) };
}

async function main() {
  const deadline = Date.now() + 10 * 60_000;
  let recent = null;
  for (;;) {
    recent = await fetch(`${SITE}/recent.json?t=${Date.now()}`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null), () => null);
    if (recent && recent.latest >= LATEST) break;
    if (Date.now() > deadline) {
      console.log(`The site doesn't list post ${LATEST} yet; the next run will announce it.`);
      return 0;
    }
    await sleep(20_000);
  }
  const since = Date.now() - WINDOW;
  const fresh = recent.posts.filter((p) => Date.parse(p.date) >= since);
  if (!fresh.length) {
    console.log('Nothing new to announce.');
    return 0;
  }
  let code = 0;

  if (process.env.INDEXNOW !== '0') {
    const res = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(indexNowBody(SITE, fresh)),
    }).catch((e) => ({ status: 0, ok: false, text: async () => e.message }));
    // 200/202: taken. 403: the key file isn't live yet (first deploy). Never fails the run.
    console.log(`indexnow ${res.status}: ${res.ok ? `${fresh.length} stories` : await res.text()}`);
  }

  if (!SECRET) console.log('PUSH_SECRET is not set: notifications are off.');
  else {
    const posts = fresh.map(({ id, title, short, tags, kind, video }) => ({ id, title, short, tags, kind: video ? 'video' : kind }));
    const res = await fetch(`${SITE}/api/push/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SECRET}` },
      body: JSON.stringify({ action: 'send', posts }),
    });
    console.log(`push ${res.status}: ${await res.text()}`);
    // 501: the site has no VAPID keys yet — not a failure of this run.
    if (!res.ok && res.status !== 501) code = 1;
  }
  return code;
}

/** The weekly recap's notification id: posts' ids are small, so 90000000 + the Friday as YYMMDD never meets one. */
export const weeklyId = (week) => 90000000 + Number(week.slice(2).replace(/-/g, ''));

/** --weekly: once the site serves this week's recap (/weekly.json), tell "all" and "daily" readers (server/push.js). */
async function weekly() {
  const WEEK = process.env.WEEK;
  if (!SECRET || !WEEK) return console.log('PUSH_SECRET or WEEK missing: no weekly notification.'), 0;
  const deadline = Date.now() + 10 * 60_000;
  for (;;) {
    const w = await fetch(`${SITE}/weekly.json?t=${Date.now()}`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null), () => null);
    if (w?.week === WEEK) {
      const res = await fetch(`${SITE}/api/push/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SECRET}` },
        body: JSON.stringify({ action: 'send', posts: [{ id: weeklyId(WEEK), title: w.title, kind: 'weekly', tags: [] }] }),
      });
      console.log(`push ${res.status}: ${await res.text()}`);
      return 0;
    }
    if (Date.now() > deadline) return console.log(`The site doesn't serve the recap of ${WEEK} yet.`), 0;
    await sleep(20_000);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(await (process.argv.includes('--weekly') ? weekly() : main()));
