// A Persian voice that runs on the reader's own device, for devices with no Persian system voice (every iPhone and
// iPad, most desktops) while /api/tts has no key: the sherpa-onnx WebAssembly runtime with Piper's "Ganji" Persian
// voice (VITS, CC0), about 93 MB, downloaded once on the reader's say-so and kept in Cache Storage. The work happens in
// src/scripts/voice-worker.ts; this side keeps the state and turns text into audio URLs.
// Why this voice: of the Persian packages (Matcha "Khadijah" 158 MB, Piper ganji/amir/reza/ibrahimwalk 93 MB), checked
// on the site's own text — Whisper transcribes all of them, Khadijah best (4–6% characters wrong) but slower than real
// time on a laptop core (a phone would stutter) and twice the download; Ganji is next clearest (7–9%), the fastest
// (about twice real time) and loads in ~3 s. The files are the Sokuji sherpa-onnx packages on Hugging Face.
// The same voice also comes as an int8 package (49 MB instead of 93), but in the browser it makes speech 1.8× slower
// (Chrome, Apple M-series: 0.32 s of work per second of speech against 0.18) — on a phone that is the difference
// between keeping ahead of the playback and stuttering, so the full model it is.

/** Cache Storage name: public/sw.js must keep it when it clears old caches. Change it with the model. */
export const VOICE_CACHE = 'voice-v1';
// Pinned to one revision; the second mirror is for networks where huggingface.co is blocked. Every file is checked
// against its SHA-256 after download, so a mirror can't serve anything else.
const PATH = 'datasets/jiangzhuo9357/sherpa-onnx-tts-models/resolve/c17064a360099d72cf3973cfdaaddc46acf98bfb/wasm-piper-fa-ganji-medium/';
const BASES = [`https://huggingface.co/${PATH}`, `https://hf-mirror.com/${PATH}`];
// Order matters: the worker reads them as [runtime, glue, wasm, data].
const FILES = [
  { name: 'sherpa-onnx-wasm-main-tts.js', size: 119743, sha256: 'ebec9541e999ae99fb267ef40d527ac0f1e436bf5a0b55ec73b10eaae278a14a' },
  { name: 'sherpa-onnx-tts.js', size: 25933, sha256: '51c0523f16a864ec942409aa0fe6e80a581bfb54a492ed94ecbdce491f9e9a79' },
  { name: 'sherpa-onnx-wasm-main-tts.wasm', size: 11903250, sha256: 'cfd3c816c2f02477c234b66f00af11cc500f45904956f7e44d86f81bf4fe41d5' },
  { name: 'sherpa-onnx-wasm-main-tts.data', size: 81142978, sha256: 'e354f66cbd0c167b6e6f502c63628bcf4368f51767f22b5c621fdbdc55559c51' },
];
/** sherpa-onnx's OfflineTts config; paths are inside the package's .data file. */
const CONFIG = {
  offlineTtsModelConfig: {
    offlineTtsVitsModelConfig: { model: './fa_IR-ganji-medium.onnx', lexicon: '', tokens: './tokens.txt', dataDir: './espeak-ng-data', noiseScale: 0.667, noiseScaleW: 0.8, lengthScale: 1 },
    numThreads: 1,
    debug: 0,
    provider: 'cpu',
  },
  ruleFsts: '',
  ruleFars: '',
  maxNumSentences: 1,
};
export const VOICE_BYTES = FILES.reduce((s, f) => s + f.size, 0);
export const VOICE_MB = Math.round(VOICE_BYTES / 1e6);

export type VoiceState = 'none' | 'partial' | 'ready';

/** The browser can run it: WebAssembly in a worker, Cache Storage (secure pages only). */
export const voiceSupported = () => typeof WebAssembly === 'object' && typeof Worker === 'function' && 'caches' in window && isSecureContext;

let ready = false;
/** Downloaded and not known to be broken. Synchronous: valid once voiceState() has run. */
export const voiceReady = () => ready;

export async function voiceState(): Promise<VoiceState> {
  if (!voiceSupported()) return 'none';
  try {
    if (!(await caches.has(VOICE_CACHE))) return 'none';
    const cache = await caches.open(VOICE_CACHE);
    const done = await Promise.all(FILES.map((f) => cache.match(`${BASES[0]}${f.name}?done`)));
    ready = done.every(Boolean);
    if (ready) return 'ready';
    return (await cache.keys()).length ? 'partial' : 'none';
  } catch {
    return 'none';
  }
}

// ---------- the worker ----------
type Pending = { resolve(url: string): void; reject(e: Error): void; text: string };
let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, Pending>();
let onDownload: { progress(loaded: number, total: number): void; done(): void; fail(e: Error): void } | null = null;

function failAll(msg: string) {
  for (const [id, p] of pending) {
    clips.delete(p.text);
    p.reject(new Error(msg));
    pending.delete(id);
  }
}

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./voice-worker.ts', import.meta.url));
  worker.postMessage({ t: 'init', cache: VOICE_CACHE, bases: BASES, files: FILES, config: CONFIG });
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.t === 'progress') onDownload?.progress(m.loaded, m.total);
    else if (m.t === 'downloaded') onDownload?.done();
    else if (m.t === 'audio') {
      const p = pending.get(m.id);
      pending.delete(m.id);
      p?.resolve(URL.createObjectURL(new Blob([m.wav], { type: 'audio/wav' })));
    } else if (m.t === 'dropped' || (m.t === 'fail' && m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (p) clips.delete(p.text);
      p?.reject(new Error(m.t === 'dropped' ? 'dropped' : m.msg));
    } else if (m.t === 'fail') {
      onDownload?.fail(new Error(m.msg));
      if (pending.size) {
        // The model didn't load (out of memory, or the stored files went missing): don't offer it again this visit.
        ready = false;
        failAll(m.msg);
      }
    }
  };
  // A crash (usually memory) takes the whole worker down: start over next time.
  worker.onerror = (e) => {
    e.preventDefault();
    worker = null;
    ready = false;
    onDownload?.fail(new Error('crashed'));
    failAll('crashed');
  };
  return worker;
}

// Leaving the page lets go of the model's memory (hundreds of MB): Safari keeps recent pages alive for "back", and the
// next page's voice would not fit beside it on a phone. Coming back starts a new worker when it is needed.
addEventListener('pagehide', () => {
  worker?.terminate();
  worker = null;
  onDownload?.fail(new Error('closed')); // shown as "connection lost": one tap resumes it
  failAll('closed');
});

/** Starts loading the model before its first clip is asked for (the reader is about to listen), so the voice starts
 *  a second or more sooner. Only once it's downloaded: loading takes hundreds of MB, so not on every page. */
export function prepareVoice() {
  if (ready) getWorker().postMessage({ t: 'load' });
}

/** Downloads what is missing (resuming a partial download), reporting progress. */
export function downloadVoice(progress: (loaded: number, total: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    onDownload = {
      progress,
      done() {
        onDownload = null;
        ready = true;
        resolve();
      },
      fail(e) {
        onDownload = null;
        reject(e);
      },
    };
    // Ask the browser not to clear it under storage pressure (best effort; Safari may still).
    navigator.storage?.persist?.().catch(() => {});
    getWorker().postMessage({ t: 'download' });
  });
}

/** Room for the voice on this device (best effort: unknown counts as enough). */
export async function voiceFits(): Promise<boolean> {
  try {
    const { quota, usage } = (await navigator.storage?.estimate?.()) ?? {};
    return quota == null || usage == null || quota - usage > VOICE_BYTES * 1.1;
  } catch {
    return true;
  }
}

export async function removeVoice() {
  worker?.terminate();
  worker = null;
  ready = false;
  failAll('removed');
  await caches.delete(VOICE_CACHE).catch(() => {});
}

// ---------- text → audio ----------
// Recent clips by text, so a paragraph asked for ahead of time (or replayed) is ready at once.
const clips = new Map<string, Promise<string>>();
const CLIPS_MAX = 16;

/** An object URL with the spoken text. `urgent`: the reader is waiting for it, so it goes before read-ahead work. */
export function voiceClip(text: string, urgent = false): Promise<string> {
  const known = clips.get(text);
  if (known) {
    const id = [...pending].find(([, p]) => p.text === text)?.[0];
    if (urgent && id) getWorker().postMessage({ t: 'bump', id });
    return known;
  }
  const id = ++seq;
  const clip = new Promise<string>((resolve, reject) => pending.set(id, { resolve, reject, text }));
  clip.catch(() => {});
  clips.set(text, clip);
  while (clips.size > CLIPS_MAX) {
    const [oldest, p] = clips.entries().next().value!;
    clips.delete(oldest);
    p.then((url) => setTimeout(() => URL.revokeObjectURL(url), 60_000), () => {});
  }
  getWorker().postMessage({ t: 'say', id, text, urgent });
  return clip;
}

/** Text in pieces of about a sentence: the first one is ready sooner, and the model keeps its pace on short input.
 *  The first piece is what the listener waits for, so a long one is cut at its first natural pause. */
export function sentences(text: string): string[] {
  return quickStart(pieces(text));
}

/** A first piece over FIRST_MAX characters is cut at the last pause (a comma, a colon, or before «که», «اما», «ولی»,
 *  «تا»; not «و», which also joins pairs like «تر و تمیز») that leaves FIRST_MIN to FIRST_MAX characters before it
 *  and a sizeable piece after it. */
const FIRST_MIN = 30;
const FIRST_MAX = 110;
function quickStart(out: string[]): string[] {
  const first = out[0];
  if (!first || first.length <= FIRST_MAX) return out;
  let cut = -1;
  for (const m of first.matchAll(/([،,:؛])\s|\s(?=(?:که|اما|ولی|تا)\s)/g)) {
    const at = m.index! + (m[1] ? 1 : 0);
    if (at > FIRST_MAX) break;
    if (at >= FIRST_MIN && first.length - at >= 25) cut = at;
  }
  return cut < 0 ? out : [first.slice(0, cut).trim(), first.slice(cut).trim(), ...out.slice(1)];
}

function pieces(text: string): string[] {
  const out: string[] = [];
  const add = (t: string) => {
    const last = out.length - 1;
    // A very short piece joins the one before it.
    if (last >= 0 && (t.length < 20 || out[last].length < 20) && out[last].length + t.length < 220) out[last] += ` ${t}`;
    else out.push(t);
  };
  // Ends of sentences: punctuation then a space (so "4.5" stays whole), or a line break.
  for (const s of text.replace(/([.!?؟؛…]+)(\s+|$)|\n+/g, '$1\u0000').split('\u0000')) {
    const t = s.trim();
    if (t.length <= 260) {
      if (t) add(t);
      continue;
    }
    // A very long sentence is cut at its commas.
    let piece = '';
    for (const c of t.match(/[^،,]+[،,]?/g) ?? [t]) {
      if (piece && piece.length + c.length > 200) {
        add(piece.trim());
        piece = '';
      }
      piece += c;
    }
    if (piece.trim()) add(piece.trim());
  }
  return out;
}
