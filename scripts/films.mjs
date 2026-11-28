// The runner's film studio (.github/workflows/films.yml): makes the short film of each recent story that has none yet,
// exactly as a reader's device does — the live site's own page, its «ویدیو» → «فیلم», in headless Chrome — and
// publishes it (functions/media, R2) for everyone, in landscape and vertical. The voice is the site's most natural
// one, downloaded once into a Chrome profile the workflow caches. Chrome on Linux makes the sound as Opus when it has no
// AAC encoder: ffmpeg turns it into AAC (every phone plays that), the picture is copied untouched.
//   SITE=https://blog.remixt.app MEDIA_KEY=… node scripts/films.mjs [--limit 6] [--hours 48] [--shapes h,v] [--ids 6768,6770]
// Without MEDIA_KEY it makes the films and keeps them in .cache/films/ (a dry run), uploading nothing.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const SITE = (process.env.SITE || 'https://blog.remixt.app').replace(/\/$/, '');
const KEY = process.env.MEDIA_KEY || '';
const LIMIT = Number(arg('limit', 6));
const HOURS = Number(arg('hours', 48));
const SHAPES = arg('shapes', 'h,v').split(',');
const IDS = arg('ids', '');
/** The voice sheet's family: «سینا» (Cilla Mini), the most natural Persian voice the site has. */
const VOICE = process.env.FILM_VOICE || 'cilla_voice2';
const PROFILE = path.resolve(process.env.FILM_PROFILE || '.cache/film-profile');
const OUT = path.resolve('.cache/films');
const BUDGET_MS = Number(process.env.FILM_BUDGET_MIN || 40) * 60_000;
const CHROME = process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => fs.existsSync(p));

const t0 = Date.now();
fs.mkdirSync(OUT, { recursive: true });

async function todo() {
  let ids;
  if (IDS) ids = IDS.split(',').map(Number);
  else {
    const recent = await (await fetch(`${SITE}/recent.json`)).json();
    const since = Date.now() - HOURS * 3600_000;
    ids = recent.posts.filter((p) => p.kind === 'story' && Date.parse(p.date) >= since).map((p) => p.id);
  }
  const have = ids.length ? await (await fetch(`${SITE}/media/films/?ids=${ids.join(',')}`)).json().catch(() => ({})) : {};
  const jobs = [];
  for (const id of ids) for (const s of SHAPES) if (!have[id]?.includes(s)) jobs.push({ id, shape: s });
  return jobs.slice(0, LIMIT);
}

async function ensureVoice(page) {
  if (await page.evaluate(() => caches.has('voice-v1'))) return;
  console.log(`voice: downloading ${VOICE}…`);
  await page.evaluate(() => document.querySelector('[data-voice-open]')?.click());
  await page.waitForSelector(`li.vo[data-vo="${VOICE}"]`, { state: 'visible', timeout: 20000 });
  // The recommended voice's card is open already: a tap would close it.
  if (!(await page.locator(`li.vo[data-vo="${VOICE}"] .vo-body`).isVisible())) await page.click(`li.vo[data-vo="${VOICE}"] .vo-toggle`);
  await page.click(`li.vo[data-vo="${VOICE}"] [data-vo-go]`);
  await page.waitForSelector(`li.vo[data-vo="${VOICE}"] [data-vo-remove]:not([hidden])`, { timeout: 15 * 60_000 });
  await page.keyboard.press('Escape');
  console.log('voice: ready');
}

async function make(ctx, { id, shape }) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  try {
    // The sheet opens in the shape and mode asked for (its remembered choice).
    await page.addInitScript(([s]) => localStorage.setItem('khabar:video-pref', JSON.stringify({ shape: s, mode: 'film' })), [shape]);
    await page.goto(`${SITE}/p/${id}/`, { waitUntil: 'load' });
    await ensureVoice(page);
    await page.reload({ waitUntil: 'load' });
    const btn = page.locator('.reader-bar [data-make-video]');
    if (!(await btn.count()) || !(await btn.isVisible())) throw new Error('no video button');
    const started = Date.now();
    await btn.click();
    // A published film opens instead of a new one: then there's nothing to make.
    await page.waitForSelector('#video-sheet [data-vs-done]:not([hidden])', { timeout: 20 * 60_000 });
    const meta = await page.locator('[data-vs-meta]').textContent();
    if (/^ساخته شده/.test(meta ?? '')) return console.log(`${id}-${shape}: already published`);
    const b64 = await page.evaluate(async () => {
      const el = document.querySelector('[data-vs-video]');
      const u = new Uint8Array(await (await fetch(el.src)).arrayBuffer());
      let s = '';
      for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode(...u.subarray(i, i + 32768));
      return btoa(s);
    });
    const raw = path.join(OUT, `${id}-${shape}.raw.mp4`);
    const file = path.join(OUT, `${id}-${shape}.mp4`);
    fs.writeFileSync(raw, Buffer.from(b64, 'base64'));
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', raw, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', file]);
    fs.rmSync(raw);
    const size = fs.statSync(file).size;
    console.log(`${id}-${shape}: made in ${Math.round((Date.now() - started) / 1000)} s, ${(size / 1e6).toFixed(1)} MB${errors.length ? ` (page errors: ${errors.join(' | ').slice(0, 300)})` : ''}`);
    if (!KEY) return;
    const res = await fetch(`${SITE}/media/films/${id}-${shape}.mp4`, {
      method: 'POST',
      headers: { 'content-type': 'video/mp4', 'x-media-key': KEY, 'x-made-by': 'runner' },
      body: fs.readFileSync(file),
    });
    console.log(`${id}-${shape}: published ${res.status}`);
    if (!res.ok) process.exitCode = 1;
  } finally {
    await page.close();
  }
}

const jobs = await todo();
console.log(`${jobs.length} films to make (${SHAPES.join(', ')}; ${HOURS} h; voice ${VOICE}; ${KEY ? 'publishing' : 'dry run: kept in .cache/films'})`);
if (jobs.length) {
  const ctx = await chromium.launchPersistentContext(PROFILE, { executablePath: CHROME, headless: true, viewport: { width: 1280, height: 900 }, args: ['--autoplay-policy=no-user-gesture-required'] });
  for (const job of jobs) {
    if (Date.now() - t0 > BUDGET_MS) {
      console.log('::notice::time budget used; the rest next run');
      break;
    }
    try {
      await make(ctx, job);
    } catch (e) {
      console.log(`::warning::${job.id}-${job.shape}: ${e.message}`);
    }
  }
  await ctx.close();
}
