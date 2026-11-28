// «پادکست خبر» made into sound (.github/workflows/podcast.yml): the day's dialogue (pipeline/podcast.py →
// data/podcast/<day>.json) spoken on the live site's studio page (src/scripts/studio.ts) in headless Chrome with the
// site's two Cilla voices, mastered by ffmpeg to podcast loudness (−16 LUFS, MP3 96 kbps mono), published to R2
// (functions/media: /media/podcast/<day>.mp3 and its timed lines .json), and written back into the day's file
// (`audio`: seconds, bytes; each line's `at`) for the site's player and /podcast.xml.
//   SITE=https://blog.remixt.app MEDIA_KEY=… node scripts/podcast.mjs [--day 2026-11-27]
// Without MEDIA_KEY it makes the MP3 in .cache/podcast/ and changes nothing.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const arg = (n, d) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d);
const SITE = (process.env.SITE || 'https://blog.remixt.app').replace(/\/$/, '');
const KEY = process.env.MEDIA_KEY || '';
const DIR = path.resolve('data/podcast');
const OUT = path.resolve('.cache/podcast');
const PROFILE = path.resolve(process.env.FILM_PROFILE || '.cache/film-profile');
const CHROME = process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => fs.existsSync(p));
/** The hosts' voices (the voice sheet's families → the catalog's ids). */
const HOSTS = { g: ['cilla_voice2', 'cilla-mini-voice2'], p: ['cilla_parisa', 'cilla-mini-parisa'] };

const day = arg('day', fs.readdirSync(DIR).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().at(-1)?.replace('.json', ''));
if (!day) process.exit(console.log('no episode'));
const file = path.join(DIR, `${day}.json`);
const ep = JSON.parse(fs.readFileSync(file, 'utf8'));
if (ep.audio && !process.argv.includes('--force')) process.exit(console.log(`${day}: already made`));

// How the voices say the Latin names in it (the site's lexicon, as card.json's `lex`).
const lexicon = JSON.parse(fs.readFileSync('data/lexicon.json', 'utf8'));
const low = new Map(Object.entries(lexicon).map(([k, v]) => [k.toLowerCase(), [k, v]]));
const lex = {};
for (const l of ep.lines) for (const m of l.text.matchAll(/\$\d[\d,.]*\s?[KMBT]?\b|[A-Za-z][\w.+&'/-]*/g)) {
  const hit = low.get(m[0].replace(/[.,'/&-]+$/, '').toLowerCase());
  if (hit) lex[hit[0]] = hit[1];
}

fs.mkdirSync(OUT, { recursive: true });
const ctx = await chromium.launchPersistentContext(PROFILE, { executablePath: CHROME, headless: true, viewport: { width: 1200, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('page error:', String(e).slice(0, 300)));
// Both voices, downloaded once into the cached profile (as a reader does: the voice sheet of a story page).
const recent = await (await fetch(`${SITE}/recent.json`)).json();
await page.goto(`${SITE}${recent.posts.find((p) => p.kind === 'story').href}`, { waitUntil: 'load' });
for (const [family, id] of Object.values(HOSTS)) {
  const here = await page.evaluate(async (sha) => !!(await caches.match(`${location.origin}/voice-files/${sha}?done`, { cacheName: 'voice-v1' })), await voiceSha(id));
  if (here) continue;
  console.log(`voice: downloading ${family}…`);
  // The voice sheet, from the settings' «دانلود صدا» («گوش دادن» would start reading once a voice is here).
  if (!(await page.locator(`li.vo[data-vo="${family}"]`).isVisible())) await page.evaluate(() => document.querySelector('[data-voice-open]')?.click());
  await page.waitForSelector(`li.vo[data-vo="${family}"]`, { state: 'visible' });
  if (!(await page.locator(`li.vo[data-vo="${family}"] .vo-body`).isVisible())) await page.click(`li.vo[data-vo="${family}"] .vo-toggle`);
  await page.click(`li.vo[data-vo="${family}"] [data-vo-go]`);
  await page.waitForSelector(`li.vo[data-vo="${family}"] [data-vo-remove]:not([hidden])`, { timeout: 15 * 60_000 });
}
await page.goto(`${SITE}/studio/`, { waitUntil: 'load' });
await page.waitForSelector('[data-studio][data-ready]');
const t0 = Date.now();
const made = await page.evaluate(
  ([lines, lex, voices]) => window.studio.podcast(lines, lex, voices),
  [ep.lines, lex, { g: HOSTS.g[1], p: HOSTS.p[1] }],
);
await ctx.close();
const wav = path.join(OUT, `${day}.wav`);
const mp3 = path.join(OUT, `${day}.mp3`);
fs.writeFileSync(wav, Buffer.from(made.wav, 'base64'));
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', wav, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '96k', '-metadata', `title=${ep.title} · ${day}`, '-metadata', 'artist=فیچر فوکوس · غلام و پریسا', mp3]);
fs.rmSync(wav);
const bytes = fs.statSync(mp3).size;
console.log(`${day}: ${made.seconds} s, ${(bytes / 1e6).toFixed(1)} MB, made in ${Math.round((Date.now() - t0) / 1000)} s`);
if (!KEY) process.exit(console.log('dry run: kept in .cache/podcast'));
for (const [name, body, type] of [
  [`${day}.mp3`, fs.readFileSync(mp3), 'audio/mpeg'],
  [`${day}.json`, JSON.stringify({ day, seconds: made.seconds, lines: made.lines }), 'application/json'],
]) {
  const res = await fetch(`${SITE}/media/podcast/${name}`, { method: 'POST', headers: { 'content-type': type, 'x-media-key': KEY }, body });
  console.log(`${name}: ${res.status}`);
  if (!res.ok) process.exit(1);
}
ep.audio = { seconds: made.seconds, bytes, at: new Date().toISOString() };
ep.lines = made.lines;
fs.writeFileSync(file, JSON.stringify(ep, null, 1) + '\n');

/** A voice's model data file hash, from the catalog the site ships (src/lib/voices.ts). */
async function voiceSha(id) {
  const src = fs.readFileSync('src/lib/voices.ts', 'utf8');
  const block = src.slice(src.indexOf(`id: '${id}'`));
  return block.match(/cilla\('\w+', \d+, '([0-9a-f]{64})'\)/)?.[1] ?? '';
}
