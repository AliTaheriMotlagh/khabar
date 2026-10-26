// Tooling for the Persian voices a reader can download (src/lib/voices.ts). Not part of the site.
//   node scripts/voices.mjs entry <package>...  the files (size + SHA-256) of sherpa-onnx WASM packages at the pinned
//                                               revision, for a new catalog entry (<package> = the folder without "wasm-")
//   node scripts/voices.mjs bench [id...]       downloads each voice into .cache/voices/ (checked against the catalog),
//                                               speaks a test paragraph in Node (one thread, like the browser worker),
//                                               prints its speed and pitch, and writes the picker's preview clip to
//                                               public/voices/<family>.mp3 (ffmpeg)
// Adding a voice: `entry` → a new object in VOICES (name, about, config from the package's demo page) → `bench` → fill
// in `rtf` and `gender` from its output → `npm test`.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync, spawnSync } from 'node:child_process';
import { REPO, REVISION, VOICES, mirrors } from '../src/lib/voices.ts';

const CACHE = path.resolve('.cache/voices');
const ORDER = ['sherpa-onnx-wasm-main-tts.js', 'sherpa-onnx-tts.js', 'sherpa-onnx-wasm-main-tts.wasm', 'sherpa-onnx-wasm-main-tts.data'];
// What the preview says: the site's own register (Gholam's colloquial Persian), with an English name in it, as in the news.
const SAMPLE = 'سلام رفیق! من خبرهای هوش مصنوعی رو برات می‌خونم؛ مثلاً اینکه استارتاپ Tali AI چطور کاغذبازی پزشکا رو کم می‌کنه.';
const BENCH = [
  'حسام دادآفرین توی این گفتگو سیر تا پیاز داستان استارتاپش رو به زبون مادری باز کرده.',
  'ابزاری که اومده تا با هوش مصنوعی بار سنگین کاغذبازی و پرونده‌نویسی رو از دوش پزشکا برداره.',
  'این دستیار صوتی هوشمند مکالمات ویزیت رو تحلیل می‌کنه و مدارک بالینی رو تحویل میده.',
  'خلاصه یه تجربه دست‌اول و واقعی از کاربرد درست هوش مصنوعی تو دنیای پزشکیه.',
];
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const cached = (f) => path.join(CACHE, f.sha256);

async function entry(pkgs) {
  for (const pkg of pkgs) {
    const res = await fetch(`https://huggingface.co/api/${REPO}/tree/${REVISION}/wasm-${pkg}`);
    if (!res.ok) throw new Error(`${pkg}: HTTP ${res.status}`);
    const tree = await res.json();
    const files = [];
    for (const name of ORDER) {
      const e = tree.find((t) => t.path.endsWith(`/${name}`));
      if (!e) throw new Error(`${pkg}: no ${name}`);
      // Large files are in LFS, whose id is the SHA-256; the small scripts are hashed here.
      const hash = e.lfs?.oid ?? sha256(Buffer.from(await (await fetch(mirrors(pkg)[0] + name)).arrayBuffer()));
      files.push({ name, size: e.lfs?.size ?? e.size, sha256: hash });
    }
    console.log(`// ${pkg}\nfiles: ${JSON.stringify(files, null, 2)},`);
  }
}

async function ensure(voice) {
  fs.mkdirSync(CACHE, { recursive: true });
  for (const f of voice.files) {
    if (fs.existsSync(cached(f))) continue;
    process.stdout.write(`  ${voice.id}: ${f.name} (${Math.round(f.size / 1e6)} MB)… `);
    const b = Buffer.from(await (await fetch(mirrors(voice.id)[0] + f.name)).arrayBuffer());
    if (sha256(b) !== f.sha256) throw new Error(`${voice.id}/${f.name}: SHA-256 differs from the catalog`);
    fs.writeFileSync(cached(f), b);
    console.log('ok');
  }
}

/** Median pitch of the voiced 40 ms frames (autocorrelation, 60–400 Hz): low for most men's voices, high for women's. */
function pitch(x, rate) {
  const n = Math.round(rate * 0.04);
  const f0 = [];
  for (let s = 0; s + 2 * n < x.length; s += n) {
    let energy = 0;
    for (let i = 0; i < n; i++) energy += x[s + i] ** 2;
    if (energy / n < 1e-3) continue;
    let best = 0;
    let lag = 0;
    for (let l = Math.floor(rate / 400); l <= Math.ceil(rate / 60); l++) {
      let c = 0;
      let e2 = 0;
      for (let i = 0; i < n; i++) {
        c += x[s + i] * x[s + i + l];
        e2 += x[s + i + l] ** 2;
      }
      const r = c / Math.sqrt(energy * e2 || 1);
      if (r > best) [best, lag] = [r, l];
    }
    if (best > 0.6) f0.push(rate / lag);
  }
  f0.sort((a, b) => a - b);
  return Math.round(f0[f0.length >> 1] ?? 0);
}

function wav(samples, rate) {
  const b = Buffer.alloc(44 + samples.length * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + samples.length * 2, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((v, i) => b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), 44 + i * 2));
  return b;
}

/** In a child process (one model's memory at a time): loads the voice the way the worker does and speaks. */
async function speak(id, out) {
  const voice = VOICES.find((v) => v.id === id);
  const [main, glue, wasm, data] = voice.files.map((f) => fs.readFileSync(cached(f)));
  const t0 = performance.now();
  await new Promise((resolve, reject) => {
    Object.assign(globalThis, { require: createRequire(import.meta.url), __dirname: CACHE, module: { exports: {} } });
    globalThis.Module = {
      wasmBinary: wasm,
      getPreloadedPackage: () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
      locateFile: (p) => p,
      print() {},
      printErr() {},
      onRuntimeInitialized: resolve,
      onAbort: (what) => reject(new Error(String(what))),
    };
    vm.runInThisContext(main.toString());
  });
  vm.runInThisContext(glue.toString());
  const tts = globalThis.createOfflineTts(globalThis.Module, structuredClone(voice.config));
  const load = (performance.now() - t0) / 1000;
  const say = (text) => tts.generate({ text, sid: voice.sid ?? 0, speed: 1 });
  let work = 0;
  let audio = 0;
  let f0 = 0;
  for (const text of BENCH) {
    const t = performance.now();
    const a = say(text);
    work += (performance.now() - t) / 1000;
    audio += a.samples.length / a.sampleRate;
    f0 += pitch(a.samples, a.sampleRate) / BENCH.length;
  }
  const sample = say(SAMPLE);
  fs.writeFileSync(path.join(out, `${id}.wav`), wav(sample.samples, sample.sampleRate));
  console.log(JSON.stringify({ load: +load.toFixed(1), rtf: +(work / audio).toFixed(2), f0: Math.round(f0), rate: tts.sampleRate }));
}

async function bench(ids) {
  const list = ids.length ? VOICES.filter((v) => ids.includes(v.id)) : VOICES;
  const out = path.join(CACHE, 'out');
  fs.mkdirSync(out, { recursive: true });
  fs.mkdirSync('public/voices', { recursive: true });
  for (const v of list) {
    await ensure(v);
    const run = spawnSync(process.execPath, [path.resolve('scripts/voices.mjs'), 'speak', v.id, out], { encoding: 'utf8' });
    if (run.status) {
      console.log(`${v.id}: failed\n${run.stderr.slice(-2000)}`);
      continue;
    }
    const r = JSON.parse(run.stdout.trim().split('\n').pop());
    console.log(`${v.id.padEnd(48)} load ${r.load}s · rtf ${r.rtf} (catalog ${v.rtf}) · pitch ${r.f0} Hz · ${r.rate} Hz`);
    // One preview per family: the full build (int8 sounds the same, just made more slowly).
    if (!v.light) execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', path.join(out, `${v.id}.wav`), '-ac', '1', '-ar', '22050', '-b:a', '40k', `public/voices/${v.family}.mp3`]);
  }
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === 'entry') await entry(args);
else if (cmd === 'bench') await bench(args);
else if (cmd === 'speak') await speak(args[0], args[1]);
else console.log('usage: node scripts/voices.mjs entry <package>... | bench [id...]');
