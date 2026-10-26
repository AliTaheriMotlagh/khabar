// A Persian voice that runs on the reader's own device, for devices with no Persian system voice (every iPhone and
// iPad, most desktops) while /api/tts has no key: the sherpa-onnx WebAssembly runtime with one of the Persian models in
// src/lib/voices.ts (which one: the reader's pick in the voice sheet, src/scripts/voice-offer.ts), downloaded on the
// reader's say-so and kept in Cache Storage. The work happens in src/scripts/voice-worker.ts — one worker downloads,
// another speaks — so a new voice downloads while the current one goes on reading; this side keeps the state and turns
// text into audio URLs.
import { store } from './core';
import { DEFAULT_VOICE, VOICES, mirrors, voiceById, type Voice } from '../lib/voices';

/** Cache Storage name: public/sw.js must keep it when it clears old caches. Holds every downloaded voice. */
export const VOICE_CACHE = 'voice-v1';
// Files are stored by SHA-256 (the same runtime serves every voice), each in parts — see the worker.
const KEYS = `${location.origin}/voice-files/`;
const done = (sha: string) => `${KEYS}${sha}?done`;
const part0 = (sha: string) => `${KEYS}${sha}?part=0`;

export type VoiceState = 'none' | 'partial' | 'ready';

/** The browser can run it: WebAssembly in a worker, Cache Storage (secure pages only). */
export const voiceSupported = () => typeof WebAssembly === 'object' && typeof Worker === 'function' && 'caches' in window && isSecureContext;

// ---------- which voices are here, which one speaks ----------
let states = new Map<string, VoiceState>();
/** How many voices use each file: a voice is "partial" by the files only it has, not by the shared runtime. */
const users = new Map<string, number>();
for (const v of VOICES) for (const f of v.files) users.set(f.sha256, (users.get(f.sha256) ?? 0) + 1);

/** The reader's choice: a voice id, or 'system' for the device's (or the server's) own voice. */
export const chosenVoice = () => store.get<string>('voice', '');
/** The downloaded voice that speaks: the chosen one, else the first one here (when the device has none of its own). */
export function activeVoice(): Voice | undefined {
  const chosen = voiceById(chosenVoice());
  if (chosen && states.get(chosen.id) === 'ready') return chosen;
  return VOICES.find((v) => states.get(v.id) === 'ready');
}
/** A downloaded voice is ready to speak. Synchronous: valid once voiceStates() has run. */
export const voiceReady = () => !!activeVoice();
/** The reader picked a downloaded voice over the device's own one. */
export const voicePreferred = () => !!voiceById(chosenVoice()) && voiceReady();

/** Each voice's state, from one look at the cache. */
export async function voiceStates(): Promise<Map<string, VoiceState>> {
  if (!voiceSupported()) return (states = new Map());
  try {
    if (!(await caches.has(VOICE_CACHE))) return (states = new Map());
    const cache = await caches.open(VOICE_CACHE);
    let keys = new Set((await cache.keys()).map((r) => r.url));
    if ([...keys].some((k) => !k.startsWith(KEYS))) keys = await migrate(cache, keys);
    const next = new Map<string, VoiceState>();
    for (const v of VOICES) {
      if (v.files.every((f) => keys.has(done(f.sha256)))) next.set(v.id, 'ready');
      else if (v.files.some((f) => users.get(f.sha256) === 1 && (keys.has(part0(f.sha256)) || keys.has(done(f.sha256))))) next.set(v.id, 'partial');
    }
    states = next;
  } catch {
    states = new Map();
  }
  return states;
}

/** The state of the voice that speaks, or of the chosen one (the settings line). */
export async function voiceState(): Promise<VoiceState> {
  await voiceStates();
  if (voiceReady()) return 'ready';
  return [...states.values()].includes('partial') ? 'partial' : 'none';
}

/** Before the choice of voices there was one, stored under its Hugging Face address and file name: move it to the
 *  shared keys, so a reader who has it doesn't download it again (a half-done download resumes from where it was). */
async function migrate(cache: Cache, keys: Set<string>) {
  const old = voiceById(DEFAULT_VOICE)!;
  const base = mirrors(old.id)[0];
  for (const url of keys) {
    if (url.startsWith(KEYS)) continue;
    const f = url.startsWith(base) && old.files.find((f) => url.slice(base.length).split('?')[0] === f.name);
    const hit = f && (await cache.match(url));
    if (f && hit) await cache.put(`${KEYS}${f.sha256}?${url.split('?')[1]}`, hit);
    await cache.delete(url);
  }
  const now = new Set((await cache.keys()).map((r) => r.url));
  if (!store.get('voice', '') && old.files.every((f) => now.has(done(f.sha256)))) store.set('voice', old.id);
  return now;
}

/** Makes `id` the voice that speaks (or 'system'). The next clip comes from it; one already asked for is made again. */
export function chooseVoice(id: string) {
  store.set('voice', id);
  if (speaker && speaker.id !== activeVoice()?.id) stopSpeaker('dropped');
}

// ---------- the worker that speaks ----------
type Pending = { resolve(url: string): void; reject(e: Error): void; text: string };
let speaker: { worker: Worker; id: string } | null = null;
let seq = 0;
const pending = new Map<number, Pending>();

function failAll(msg: string) {
  for (const [id, p] of pending) {
    clips.delete(p.text);
    p.reject(new Error(msg));
    pending.delete(id);
  }
}

/** Lets go of the model (hundreds of MB). `dropped` makes the reader ask again, which starts the new voice. */
function stopSpeaker(why: string) {
  speaker?.worker.terminate();
  speaker = null;
  // Clips already made are in the old voice.
  for (const c of clips.values()) c.then((url) => setTimeout(() => URL.revokeObjectURL(url), 60_000), () => {});
  clips.clear();
  failAll(why);
}

function getSpeaker() {
  const voice = activeVoice();
  if (!voice) throw new Error('no voice');
  if (speaker?.id === voice.id) return speaker.worker;
  stopSpeaker('dropped');
  const worker = new Worker(new URL('./voice-worker.ts', import.meta.url));
  worker.postMessage({ t: 'init', cache: VOICE_CACHE, keys: KEYS, bases: mirrors(voice.id), files: voice.files, config: voice.config, sid: voice.sid ?? 0 });
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.t === 'audio') {
      const p = pending.get(m.id);
      pending.delete(m.id);
      p?.resolve(URL.createObjectURL(new Blob([m.wav], { type: 'audio/wav' })));
    } else if (m.t === 'dropped' || (m.t === 'fail' && m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (p) clips.delete(p.text);
      p?.reject(new Error(m.t === 'dropped' ? 'dropped' : m.msg));
    } else if (m.t === 'fail' && pending.size) {
      // The model didn't load (out of memory, or the stored files went missing): don't offer it again this visit.
      states.set(voice.id, 'partial');
      failAll(m.msg);
    }
  };
  // A crash (usually memory) takes the whole worker down: start over next time.
  worker.onerror = (e) => {
    e.preventDefault();
    if (speaker?.worker !== worker) return;
    speaker = null;
    states.set(voice.id, 'partial');
    failAll('crashed');
  };
  speaker = { worker, id: voice.id };
  return worker;
}

// ---------- the worker that downloads ----------
let loader: { worker: Worker; id: string; stop(why: string): void } | null = null;
/** The voice being downloaded now, if any (one at a time). */
export const downloading = () => loader?.id ?? null;

// Leaving the page lets go of the model's memory (hundreds of MB): Safari keeps recent pages alive for "back", and the
// next page's voice would not fit beside it on a phone. Coming back starts a new worker when it is needed; a download
// goes on from the next page (src/scripts/voice-offer.ts).
addEventListener('pagehide', () => {
  stopSpeaker('closed');
  loader?.stop('closed');
});

/** Starts loading the model before its first clip is asked for (the reader is about to listen), so the voice starts
 *  a second or more sooner. Only once it's downloaded: loading takes hundreds of MB, so not on every page. */
export function prepareVoice() {
  if (voiceReady()) getSpeaker().postMessage({ t: 'load' });
}

/** Downloads what is missing of a voice (resuming a partial download, skipping files another voice brought), reporting
 *  progress. Rejects with 'cancelled', 'closed', 'corrupt', 'crashed' or a network error. */
export function downloadVoice(id: string, progress: (loaded: number, total: number) => void): Promise<void> {
  const voice = voiceById(id);
  if (!voice) return Promise.reject(new Error('unknown'));
  loader?.stop('cancelled');
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./voice-worker.ts', import.meta.url));
    const stop = (why: string) => {
      worker.terminate();
      if (loader?.worker === worker) loader = null;
      reject(new Error(why));
    };
    loader = { worker, id, stop };
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.t === 'progress') progress(m.loaded, m.total);
      else if (m.t === 'downloaded') {
        worker.terminate();
        loader = null;
        states.set(id, 'ready');
        resolve();
      } else if (m.t === 'fail') stop(m.msg);
    };
    worker.onerror = (e) => {
      e.preventDefault();
      stop('crashed');
    };
    // Ask the browser not to clear it under storage pressure (best effort; Safari may still).
    navigator.storage?.persist?.().catch(() => {});
    worker.postMessage({ t: 'init', cache: VOICE_CACHE, keys: KEYS, bases: mirrors(id), files: voice.files });
    worker.postMessage({ t: 'download' });
  });
}

export const cancelDownload = () => loader?.stop('cancelled');

/** Bytes still to download for a voice: the files another voice already brought don't count. */
export async function missingBytes(voice: Voice): Promise<number> {
  try {
    // caches.match, not caches.open: looking must not create the cache.
    const have = await Promise.all(voice.files.map((f) => caches.match(done(f.sha256), { cacheName: VOICE_CACHE })));
    return voice.files.reduce((s, f, i) => s + (have[i] ? 0 : f.size), 0);
  } catch {
    return voice.files.reduce((s, f) => s + f.size, 0);
  }
}

/** Room for this many bytes on this device (best effort: unknown counts as enough). */
export async function voiceFits(bytes: number): Promise<boolean> {
  try {
    const { quota, usage } = (await navigator.storage?.estimate?.()) ?? {};
    return quota == null || usage == null || quota - usage > bytes * 1.1;
  } catch {
    return true;
  }
}

/** Deletes a voice's files, except those another voice here (complete or not) still uses. */
export async function removeVoice(id: string) {
  if (loader?.id === id) loader.stop('cancelled');
  states.delete(id);
  // Reading with it: another downloaded voice takes over the sentence, if there is one.
  if (speaker?.id === id) stopSpeaker(voiceReady() ? 'dropped' : 'removed');
  try {
    const keep = new Set(VOICES.filter((v) => v.id !== id && states.has(v.id)).flatMap((v) => v.files.map((f) => f.sha256)));
    if (!keep.size) return void (await caches.delete(VOICE_CACHE));
    const cache = await caches.open(VOICE_CACHE);
    const drop = new Set(voiceById(id)!.files.map((f) => f.sha256).filter((s) => !keep.has(s)));
    for (const r of await cache.keys()) if (drop.has(r.url.slice(KEYS.length).split('?')[0])) await cache.delete(r);
  } catch {}
}

/** Bytes the downloaded voices take (shared files once). */
export function storedBytes() {
  const seen = new Map<string, number>();
  for (const v of VOICES) if (states.get(v.id) === 'ready') for (const f of v.files) seen.set(f.sha256, f.size);
  return [...seen.values()].reduce((s, n) => s + n, 0);
}

// ---------- text → audio ----------
// Recent clips by text, so a paragraph asked for ahead of time (or replayed) is ready at once.
const clips = new Map<string, Promise<string>>();
const CLIPS_MAX = 16;

/** An object URL with the spoken text. `urgent`: the reader is waiting for it, so it goes before read-ahead work. */
export function voiceClip(text: string, urgent = false): Promise<string> {
  if (!voiceReady()) return Promise.reject(new Error('no voice'));
  const worker = getSpeaker();
  const known = clips.get(text);
  if (known) {
    const id = [...pending].find(([, p]) => p.text === text)?.[0];
    if (urgent && id) worker.postMessage({ t: 'bump', id });
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
  worker.postMessage({ t: 'say', id, text, urgent });
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
