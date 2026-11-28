// The built site in a real browser (Chrome through Playwright): every kind of page opens without a script error, and
// the features that only exist in a browser work end to end — the story's tools, the voice sheet, a whole news video
// made and played back, making it in the background, an episode's teaser. Run after `npm run build`:
//   node tests/e2e/smoke.mjs            (starts scripts/serve.mjs on a free port itself)
// CHROME_PATH picks the browser (default: Playwright's `chrome` channel — the Chrome GitHub's runners and Macs have).
// Not part of `npm test` (it takes a minute): the site workflow runs it on code pushes.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const PORT = 4400 + Math.floor(Math.random() * 400);
const ORIGIN = `http://localhost:${PORT}`;
const server = spawn(process.execPath, ['scripts/serve.mjs'], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((resolve, reject) => {
  server.stdout.on('data', (b) => String(b).includes('http://') && resolve());
  server.on('exit', (c) => reject(new Error(`server exited ${c}`)));
  setTimeout(() => reject(new Error('server did not start')), 15000);
});

const launch = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' };
const browser = await chromium.launch(launch);
const failures = [];
const check = async (name, fn) => {
  const t = Date.now();
  try {
    await fn();
    console.log(`✔ ${name} (${Date.now() - t} ms)`);
  } catch (e) {
    failures.push(name);
    console.log(`✖ ${name}: ${e.message.split('\n')[0]}`);
  }
};
/** A phone-sized page that collects script errors (not failed requests: the test server has no keys for the API). */
async function page(path) {
  const p = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(`${ORIGIN}${path}`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(700);
  return { p, errors };
}

const build = JSON.parse(fs.readFileSync('dist/build.json', 'utf8'));
const videos = fs.existsSync('dist/videos') ? fs.readdirSync('dist/videos').filter((d) => /^[\w-]{11}$/.test(d)) : [];
const who = fs.existsSync('dist/who') ? fs.readdirSync('dist/who').filter((d) => fs.existsSync(`dist/who/${d}/index.html`)) : [];
const story = `/p/${build.latest}/`;

const PAGES = ['/', '/page/2/', story, '/today/', '/cinema/', '/podcast/', '/videos/', videos[0] && `/videos/${videos[0]}/`, '/tags/', '/who/', who[0] && `/who/${who[0]}/`, '/saved/', '/search/', '/week/', '/glossary/', '/feeds/', '/about/', '/me/', '/stats/', '/offline/', '/investigate/?q=OpenAI', '/archive/', '/en/', '/en/page/2/', fs.existsSync(`dist/en/p/${build.latest}`) && `/en/p/${build.latest}/`, '/en/topics/', '/en/investigate/?q=NVIDIA&vs=AMD', '/en/archive/', '/en/videos/', videos[0] && `/en/videos/${videos[0]}/`, '/en/about/', '/en/feeds/', '/en/calendar/', '/calendar/', '/en/models/', '/models/', '/en/who/', '/en/today/', '/en/week/', '/en/stats/', '/en/saved/', '/en/offline/'].filter(Boolean);
for (const path of PAGES) {
  await check(`page ${path} opens without a script error`, async () => {
    const { p, errors } = await page(path);
    assert.ok((await p.title()).length > 0, 'a title');
    assert.deepEqual(errors, []);
    await p.close();
  });
}

await check('home: the timeline, the stories circle, a story card links to its page', async () => {
  const { p } = await page('/');
  assert.ok((await p.locator('.tl-item').count()) > 10, 'timeline items');
  const href = await p.locator('.tl-item a[href*="/p/"]').first().getAttribute('href');
  assert.match(href ?? '', /\/p\/\d+\//);
  await p.close();
});

await check('English edition: lang, twin links, the explorer draws', async () => {
  const { p, errors } = await page('/en/');
  assert.equal(await p.getAttribute('html', 'lang'), 'en');
  assert.equal(await p.getAttribute('html', 'dir'), 'ltr');
  assert.equal(await p.locator('link[rel="alternate"][hreflang="fa"]').count(), 1);
  assert.ok((await p.locator('.tl-item a[href*="/en/p/"]').count()) > 5, 'English story cards');
  await p.goto(`${ORIGIN}/investigate/?q=OpenAI`, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.iv-chart rect', { timeout: 8000 });
  assert.deepEqual(errors, []);
  await p.close();
});

await check('story: reader bar, «گوش دادن» opens the voice sheet with every voice (Cilla Mini included)', async () => {
  const { p, errors } = await page(story);
  await p.click('[data-listen]');
  await p.waitForSelector('dialog[open] li.vo[data-vo="cilla_parisa"]', { timeout: 8000 });
  for (const fam of ['ganji', 'cilla_parisa', 'cilla_voice1', 'cilla_voice2']) assert.equal(await p.locator(`li.vo[data-vo="${fam}"]`).count(), 1, fam);
  assert.equal((await p.request.get(`${ORIGIN}/voices/cilla_parisa.mp3`)).status(), 200, 'the preview clip');
  assert.deepEqual(errors, []);
  await p.close();
});

/** The video module from the build (loaded on the first tap in the site; here straight away). */
const videoChunk = fs.readdirSync('dist/_astro').find((f) => /^video\..*\.js$/.test(f));
async function makeVideo(p, href, shape, mode) {
  await p.evaluate(([c, href, shape, mode]) => import(`/_astro/${c}`).then((m) => void m.makeVideo(href, null, true, { shape, mode })), [videoChunk, href, shape, mode]);
}
await check('video: a story\'s video is made, shown while it is made, and plays', async () => {
  const { p, errors } = await page(story);
  await makeVideo(p, story, 'v', 'short');
  await p.waitForSelector('#video-sheet[open] [data-vs-stage]', { timeout: 10000 });
  // Making it: the stage shows a frame (preview or the encoder's) and the steps move on.
  await p.waitForSelector('#video-sheet [data-vs-stage] canvas.vs-live', { timeout: 30000 });
  await p.waitForSelector('#video-sheet [data-vs-done]:not([hidden])', { timeout: 240000 });
  const v = await p.evaluate(async () => {
    const el = document.querySelector('[data-vs-video]');
    await new Promise((r) => (el.readyState >= 1 ? r() : el.addEventListener('loadedmetadata', r, { once: true })));
    return { w: el.videoWidth, h: el.videoHeight, d: el.duration, src: el.src.slice(0, 5) };
  });
  assert.equal(v.src, 'blob:');
  assert.ok(v.w === 1080 && v.h === 1920, `vertical 1080×1920, got ${v.w}×${v.h}`);
  assert.ok(v.d > 5, `a few seconds at least, got ${v.d}`);
  assert.deepEqual(errors, []);
  await p.close();
});

await check('video: made in the background — the floating frame, then «ready»', async () => {
  const { p, errors } = await page(story);
  await makeVideo(p, story, 'h', 'short');
  await p.waitForSelector('#video-sheet[open] [data-vs-bg]:not([hidden])', { timeout: 10000 });
  await p.click('[data-vs-bg]');
  await p.waitForSelector('[data-vs-pill]:not([hidden])', { timeout: 5000 });
  await p.waitForFunction(() => document.querySelector('[data-vs-pill]')?.dataset.state === 'ready', null, { timeout: 240000 });
  await p.click('[data-vs-pill]');
  await p.waitForSelector('#video-sheet[open] [data-vs-done]:not([hidden])', { timeout: 5000 });
  assert.deepEqual(errors, []);
  await p.close();
});

if (videos[0]) {
  await check('videos: every episode has a teaser button, and a teaser is made', async () => {
    const { p, errors } = await page(`/videos/${videos.at(-1)}/`);
    assert.equal(await p.locator('[data-make-video]').count(), 1);
    await makeVideo(p, `/videos/${videos.at(-1)}/`, 's', 'full');
    await p.waitForSelector('#video-sheet [data-vs-done]:not([hidden])', { timeout: 240000 });
    assert.deepEqual(errors, []);
    await p.close();
  });
}

await check('English edition: the new pages are English, client text included, and the switch lands on the twin', async () => {
  for (const [en, fa] of [['/en/feeds/', '/feeds/'], ['/en/calendar/', '/calendar/'], ['/en/week/', '/week/'], ['/en/stats/', '/stats/'], ['/en/saved/', '/saved/']]) {
    const { p, errors } = await page(en);
    await p.waitForTimeout(800); // the week's and the visits' lists fill from the API (none here: their «not available» line)
    assert.equal(await p.getAttribute('html', 'lang'), 'en');
    assert.equal(new URL(await p.locator('.site-header [data-lang-switch]').getAttribute('href'), ORIGIN).pathname, fa, `${en}: the switch`);
    // What the page's scripts wrote: visible text outside the switch, the header's brand and things marked Persian.
    const persian = await p.evaluate(() => [...document.querySelectorAll('main *')].filter((el) => el.checkVisibility?.() && !el.closest('[lang="fa"]') && [...el.childNodes].some((n) => n.nodeType === 3 && /[\u0600-\u06ff]/.test(n.textContent))).map((el) => el.textContent.slice(0, 60)));
    assert.deepEqual(persian, [], `${en}: no Persian text`);
    assert.deepEqual(errors, []);
    await p.close();
  }
  const { p } = await page('/en/saved/');
  await p.evaluate(() => localStorage.setItem('khabar:saved', JSON.stringify([{ id: 1, title: 'A saved story', href: '/en/', date: new Date().toISOString() }])));
  await p.reload();
  await p.waitForSelector('[data-saved-list] .row-item');
  assert.match(await p.locator('[data-saved-list] .row-item small').first().textContent(), /just now|minute|hour/);
  assert.equal(await p.locator('[data-saved-list] [data-save]').getAttribute('aria-label'), 'Remove from saved');
  await p.close();
});

// «Add to my calendar» the phone's way: webcal:// on iPhone, Google Calendar on Android; one event as .ics on iPhone.
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
for (const [name, ua, want] of [['iPhone', IPHONE, /^webcal:\/\//], ['Android', ANDROID, /^https:\/\/calendar\.google\.com\/calendar\/r\?cid=webcal/]]) {
  await check(`calendar: on ${name} «Add to my calendar» subscribes the phone's way, in both languages`, async () => {
    for (const path of ['/calendar/', '/en/calendar/']) {
      const ctx = await browser.newContext({ userAgent: ua, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
      const p = await ctx.newPage();
      const errors = [];
      p.on('pageerror', (e) => errors.push(e.message));
      await p.goto(`${ORIGIN}${path}`, { waitUntil: 'domcontentloaded' });
      await p.waitForSelector('[data-cal][data-platform]');
      assert.match(await p.locator('[data-cal-sub]').getAttribute('href'), want, `${path}: the primary button`);
      const add = p.locator('[data-cal-add]').first();
      if (await add.count()) {
        if (name === 'iPhone') {
          // One event: a text/calendar data: URL with a valid VEVENT, opened (Safari's «Add to Calendar»; Chrome
          // refuses data: pages, so the link the page opens is caught instead).
          await p.evaluate(() => {
            HTMLAnchorElement.prototype.click = function () {
              document.documentElement.dataset.opened = this.href;
            };
          });
          await add.click();
          const href = await p.getAttribute('html', 'data-opened');
          assert.match(href ?? '', /^data:text\/calendar;charset=utf-8,/);
          const ics = decodeURIComponent(href.split(',').slice(1).join(','));
          assert.match(ics, /^BEGIN:VCALENDAR\r\n[\s\S]*BEGIN:VEVENT\r\nUID:[^\r]+\r\nDTSTAMP:\d{8}T\d{6}Z\r\nDTSTART;VALUE=DATE:\d{8}\r\n/);
        } else {
          assert.match(await add.getAttribute('href'), /^https:\/\/calendar\.google\.com\/calendar\/render\?action=TEMPLATE/);
          await p.locator('[data-cal-more]').first().click();
          assert.equal(await p.locator('.cal-menu:not([hidden]) [data-cal-ics]').count(), 1, 'the .ics under «more»');
        }
      }
      assert.deepEqual(errors, []);
      await ctx.close();
    }
  });
}

await browser.close();
server.kill();
console.log(failures.length ? `\n${failures.length} failed` : '\nall passed');
process.exit(failures.length ? 1 : 0);
