// The films on YouTube (@Remixt-app), every morning (.github/workflows/youtube.yml): yesterday's most important stories'
// vertical films as Shorts, and one landscape «بخش خبری» — the day's films one after another (the openings and closings
// between them trimmed). Uploads cost 1,600 of the free 10,000 daily API units, so at most SHORTS + 1 a day. What went
// up is kept in data/youtube.json (story → video id), so nothing is uploaded twice and the site can link to it.
//
//   node scripts/youtube.mjs auth                       once, on your computer: prints the refresh token for the secret
//   node scripts/youtube.mjs daily [--day YYYY-MM-DD] [--dry]
//
// Secrets: YT_CLIENT_ID, YT_CLIENT_SECRET (a Google Cloud "Desktop app" OAuth client with the YouTube Data API v3 on),
// YT_REFRESH_TOKEN (from `auth`). Films come from the live site (functions/media); ffmpeg joins them.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';

const SITE = (process.env.SITE || 'https://blog.remixt.app').replace(/\/$/, '');
const { YT_CLIENT_ID: ID = '', YT_CLIENT_SECRET: SECRET = '', YT_REFRESH_TOKEN: REFRESH = '' } = process.env;
const SHORTS = Number(process.env.YT_SHORTS || 4);
const LOG = path.resolve('data/youtube.json');
const OUT = path.resolve('.cache/youtube');
const arg = (n, d) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d);
const DRY = process.argv.includes('--dry');

// ---------- sign-in, once ----------
async function auth() {
  if (!ID || !SECRET) throw new Error('set YT_CLIENT_ID and YT_CLIENT_SECRET (Google Cloud → Credentials → OAuth client ID → Desktop app)');
  const port = 8765;
  const redirect = `http://127.0.0.1:${port}`;
  const url = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ client_id: ID, redirect_uri: redirect, response_type: 'code', access_type: 'offline', prompt: 'consent', scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube' })}`;
  console.log(`Open this in your browser and pick the @Remixt-app channel:\n\n${url}\n`);
  const code = await new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const c = new URL(req.url, redirect).searchParams.get('code');
      res.end(c ? 'Done: you can close this tab.' : 'No code.');
      if (c) server.close(() => resolve(c));
    }).listen(port, '127.0.0.1');
  });
  const tok = await (await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ code, client_id: ID, client_secret: SECRET, redirect_uri: redirect, grant_type: 'authorization_code' }) })).json();
  if (!tok.refresh_token) throw new Error(JSON.stringify(tok));
  console.log(`\nRefresh token (keep it secret):\n\n${tok.refresh_token}\n\nThen: gh secret set YT_REFRESH_TOKEN  (paste it)`);
}

async function token() {
  const t = await (await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ client_id: ID, client_secret: SECRET, refresh_token: REFRESH, grant_type: 'refresh_token' }) })).json();
  if (!t.access_token) throw new Error(`YouTube sign-in failed: ${JSON.stringify(t).slice(0, 200)}`);
  return t.access_token;
}

/** A resumable upload: the metadata, then the file in one PUT. Returns the video id. */
async function upload(access, file, meta) {
  const size = fs.statSync(file).size;
  const start = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json; charset=UTF-8', 'x-upload-content-length': String(size), 'x-upload-content-type': 'video/mp4' },
    body: JSON.stringify({
      snippet: { title: meta.title.slice(0, 100), description: meta.description.slice(0, 4900), tags: meta.tags, categoryId: '28', defaultLanguage: 'fa', defaultAudioLanguage: 'fa' },
      status: { privacyStatus: 'public', selfDeclaredMadeForKids: false, containsSyntheticMedia: true },
    }),
  });
  if (!start.ok) throw new Error(`upload start ${start.status}: ${(await start.text()).slice(0, 300)}`);
  const put = await fetch(start.headers.get('location'), { method: 'PUT', headers: { 'content-type': 'video/mp4', 'content-length': String(size) }, body: fs.readFileSync(file) });
  const v = await put.json();
  if (!v.id) throw new Error(`upload ${put.status}: ${JSON.stringify(v).slice(0, 300)}`);
  return v.id;
}

async function film(id, shape) {
  const file = path.join(OUT, `${id}-${shape}.mp4`);
  if (fs.existsSync(file)) return file;
  const res = await fetch(`${SITE}/media/films/${id}-${shape}.mp4`);
  if (!res.ok) return null;
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}
const seconds = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString());

/** The day's films as one: the first keeps its opening, the last its closing; in between both are trimmed. */
function bulletin(files, out) {
  const OPEN = 2.7;
  const CLOSE = 4;
  const parts = files.map((f, i) => {
    const d = seconds(f);
    const from = i === 0 ? 0 : OPEN;
    const to = i === files.length - 1 ? d : d - CLOSE;
    return { f, from, len: Math.max(1, to - from) };
  });
  const inputs = parts.flatMap((p) => ['-ss', String(p.from), '-t', String(p.len), '-i', p.f]);
  const chain = parts.map((_, i) => `[${i}:v]scale=1280:720,fps=30,setsar=1[v${i}];[${i}:a]aresample=48000,aformat=channel_layouts=mono[a${i}]`).join(';');
  const cat = parts.map((_, i) => `[v${i}][a${i}]`).join('') + `concat=n=${parts.length}:v=1:a=1[v][a]`;
  execFileSync('ffmpeg', ['-v', 'error', '-y', ...inputs, '-filter_complex', `${chain};${cat}`, '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out]);
  return parts;
}

async function daily() {
  const day = arg('day', new Date(Date.now() - 864e5).toLocaleDateString('en-CA', { timeZone: 'Asia/Tehran' }));
  const log = fs.existsSync(LOG) ? JSON.parse(fs.readFileSync(LOG, 'utf8')) : { shorts: {}, bulletins: {} };
  // Yesterday's stories, the most important first (the site's own order for /cinema/).
  const recent = await (await fetch(`${SITE}/recent.json`)).json();
  const day0 = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Tehran' });
  const stories = recent.posts.filter((p) => p.kind === 'story' && day0(p.date) === day);
  if (!stories.length) return console.log(`${day}: no stories`);
  const cards = await Promise.all(stories.map((p) => fetch(`${SITE}${p.href}card.json`).then((r) => r.json())));
  const ranked = stories.map((p, i) => ({ p, c: cards[i] })).sort((a, b) => (b.c.importance ?? 0) - (a.c.importance ?? 0) || b.p.id - a.p.id);
  fs.mkdirSync(OUT, { recursive: true });
  const access = DRY ? '' : await token();
  const link = (id) => `${SITE}/p/${id}/`;
  const tags = ['هوش مصنوعی', 'خبر', 'AI', 'تکنولوژی', 'فیچر فوکوس'];
  // Shorts: the vertical films of the day's most important stories.
  let n = 0;
  for (const { p, c } of ranked) {
    if (n >= SHORTS) break;
    if (log.shorts[p.id]) continue;
    const f = await film(p.id, 'v');
    if (!f || seconds(f) > 180) continue;
    const meta = { title: `${c.short || c.title} #Shorts`, description: `${c.share || c.title}\n\nمتن کامل و منبع: ${link(p.id)}\n\nروایت و مجری با هوش مصنوعی؛ متن خبر از کانال مهرزاد صمدی (داش غلام).`, tags };
    if (DRY) console.log(`would upload Short ${p.id}: ${meta.title}`);
    else {
      log.shorts[p.id] = await upload(access, f, meta);
      console.log(`Short ${p.id}: https://youtube.com/shorts/${log.shorts[p.id]}`);
    }
    n++;
  }
  // The day's bulletin: landscape films, in order of importance.
  if (!log.bulletins[day]) {
    const items = [];
    for (const r of ranked.slice(0, 10)) {
      const f = await film(r.p.id, 'h');
      if (f) items.push({ ...r, f });
    }
    if (items.length >= 2) {
      const out = path.join(OUT, `bulletin-${day}.mp4`);
      const parts = bulletin(items.map((i) => i.f), out);
      let at = 0;
      const chapters = items.map((it, i) => {
        const line = `${new Date(at * 1000).toISOString().slice(14, 19)} ${it.c.short || it.c.title}`;
        at += parts[i].len;
        return line;
      });
      const date = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${day}T12:00:00Z`));
      const meta = { title: `بخش خبری هوش مصنوعی · ${date}`, description: `${items.length} خبر مهم هوش مصنوعی، هر کدام در یک فیلم کوتاه:\n\n${chapters.join('\n')}\n\nمتن کامل و منبع هر خبر: ${SITE}/cinema/\n\nروایت و مجری با هوش مصنوعی؛ متن خبرها از کانال مهرزاد صمدی (داش غلام).`, tags };
      if (DRY) console.log(`would upload the bulletin (${items.length} films, ${Math.round(at)} s): ${meta.title}\n${chapters.join('\n')}`);
      else {
        log.bulletins[day] = await upload(access, out, meta);
        console.log(`bulletin ${day}: https://youtu.be/${log.bulletins[day]}`);
      }
    } else console.log(`${day}: fewer than 2 landscape films, no bulletin`);
  }
  if (!DRY) fs.writeFileSync(LOG, JSON.stringify(log, null, 1) + '\n');
}

const cmd = process.argv[2];
if (cmd === 'auth') await auth();
else if (cmd === 'daily') await daily();
else console.log('usage: node scripts/youtube.mjs auth | daily [--day YYYY-MM-DD] [--dry]');
