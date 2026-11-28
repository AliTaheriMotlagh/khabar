// The English edition's downloadable voice (EN_VOICE in src/lib/voices.ts: Kitten TTS nano, 42 MB, eight speakers),
// for devices whose own English voice is robotic. The same worker (src/scripts/voice-worker.ts) and store as the
// Persian voices — files kept once by SHA-256, so the 12 MB runtime one of those brought isn't downloaded again; a
// Persian voice's removal keeps what this one uses (voice.ts removeVoice), and this one's removal keeps theirs.
// The reader's choice: `en-voice` = 'kitten' (only once downloaded) | '' (the device's voice), `en-speaker` = sid.
// Read by src/scripts/en-listen.ts (playback) and its settings row (download, speaker, preview, remove).
import { store } from './core';
import { ALL_PACKS, EN_SPEAKERS, EN_VOICE, VOICE_STORE, mirrors, voiceKeys, type VoiceFile } from '../lib/voices';

const KEYS = voiceKeys(location.origin);
const done = (f: VoiceFile) => `${KEYS}${f.sha256}?done`;
const part0 = (f: VoiceFile) => `${KEYS}${f.sha256}?part=0`;
const DATA = EN_VOICE.files[3];

export type EnVoiceState = 'none' | 'partial' | 'ready';
export const enVoiceSupported = () => typeof WebAssembly === 'object' && typeof Worker === 'function' && 'caches' in window && isSecureContext;
export const enVoiceBytes = () => EN_VOICE.files.reduce((s, f) => s + f.size, 0);

let state: EnVoiceState = 'none';
export async function enVoiceState(): Promise<EnVoiceState> {
  if (!enVoiceSupported()) return (state = 'none');
  try {
    // caches.match, not caches.open: looking must not create the cache.
    const have = await Promise.all(EN_VOICE.files.map((f) => caches.match(done(f), { cacheName: VOICE_STORE })));
    if (have.every(Boolean)) return (state = 'ready');
    return (state = have[3] || (await caches.match(part0(DATA), { cacheName: VOICE_STORE })) ? 'partial' : 'none');
  } catch {
    return (state = 'none');
  }
}
/** Bytes still to download: what a Persian voice already brought (the runtime) doesn't count. */
export async function enMissingBytes() {
  try {
    const have = await Promise.all(EN_VOICE.files.map((f) => caches.match(done(f), { cacheName: VOICE_STORE })));
    return EN_VOICE.files.reduce((s, f, i) => s + (have[i] ? 0 : f.size), 0);
  } catch {
    return enVoiceBytes();
  }
}

export const enSpeaker = () => {
  const sid = store.get<number>('en-speaker', -1);
  return EN_SPEAKERS.find((s) => s.sid === sid) ?? EN_SPEAKERS.find((s) => s.recommended) ?? EN_SPEAKERS[0];
};
/** The downloaded voice reads (chosen and here). Synchronous: valid once enVoiceState() has run. */
export const enVoiceOn = () => store.get<string>('en-voice', '') === EN_VOICE.id && state === 'ready';
export function chooseEnVoice(on: boolean, sid?: number) {
  store.set('en-voice', on ? EN_VOICE.id : '');
  if (sid != null && sid !== enSpeaker().sid) {
    store.set('en-speaker', sid);
    stopSpeaker('dropped'); // clips made by the other speaker
  }
}

// ---------- download ----------
let loader: { worker: Worker; stop(why: string): void } | null = null;
export const enDownloading = () => !!loader;
/** Rejects with 'cancelled', 'closed', 'corrupt', 'crashed' or a network error (the worker's words). */
export function downloadEnVoice(progress: (loaded: number, total: number) => void): Promise<void> {
  loader?.stop('cancelled');
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./voice-worker.ts', import.meta.url));
    const stop = (why: string) => {
      worker.terminate();
      if (loader?.worker === worker) loader = null;
      reject(new Error(why));
    };
    loader = { worker, stop };
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.t === 'progress') progress(m.loaded, m.total);
      else if (m.t === 'downloaded') {
        worker.terminate();
        loader = null;
        state = 'ready';
        resolve();
      } else if (m.t === 'fail') stop(m.msg);
    };
    worker.onerror = (e) => {
      e.preventDefault();
      stop('crashed');
    };
    navigator.storage?.persist?.().catch(() => {});
    worker.postMessage({ t: 'init', cache: VOICE_STORE, keys: KEYS, bases: mirrors(EN_VOICE.id), files: EN_VOICE.files });
    worker.postMessage({ t: 'download' });
  });
}
export const cancelEnDownload = () => loader?.stop('cancelled');

/** Deletes this voice's files, except those a Persian voice here (whole or partly downloaded) still uses. */
export async function removeEnVoice() {
  loader?.stop('cancelled');
  stopSpeaker('removed');
  state = 'none';
  store.set('en-voice', '');
  try {
    const cache = await caches.open(VOICE_STORE);
    const urls = new Set((await cache.keys()).map((r) => r.url));
    // A Persian voice is here (whole or in part) when a file of its own — not one it shares with this — is.
    const mine = new Set(EN_VOICE.files.map((f) => f.sha256));
    const keep = new Set<string>();
    for (const v of ALL_PACKS()) {
      if (v === EN_VOICE) continue;
      if (v.files.some((f) => !mine.has(f.sha256) && (urls.has(done(f)) || urls.has(part0(f))))) for (const f of v.files) keep.add(f.sha256);
    }
    const drop = new Set(EN_VOICE.files.map((f) => f.sha256).filter((s) => !keep.has(s)));
    for (const u of urls) if (drop.has(u.slice(KEYS.length).split('?')[0])) await cache.delete(u);
  } catch {}
}

// ---------- text → audio ----------
type Pending = { resolve(url: string): void; reject(e: Error): void; text: string };
let speaker: Worker | null = null;
let seq = 0;
const pending = new Map<number, Pending>();
const clips = new Map<string, Promise<string>>();
const CLIPS_MAX = 12;

function stopSpeaker(why: string) {
  speaker?.terminate();
  speaker = null;
  for (const c of clips.values()) c.then((url) => setTimeout(() => URL.revokeObjectURL(url), 60_000), () => {});
  clips.clear();
  for (const [id, p] of pending) {
    p.reject(new Error(why));
    pending.delete(id);
  }
}
// Leaving the page lets go of the model's memory (Safari keeps recent pages alive for "back").
addEventListener('pagehide', () => {
  stopSpeaker('closed');
  loader?.stop('closed');
});

function getSpeaker() {
  if (speaker) return speaker;
  const worker = new Worker(new URL('./voice-worker.ts', import.meta.url));
  worker.postMessage({ t: 'init', cache: VOICE_STORE, keys: KEYS, bases: mirrors(EN_VOICE.id), files: EN_VOICE.files, config: EN_VOICE.config, sid: enSpeaker().sid, extra: [] });
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
    } else if (m.t === 'fail') {
      // The model didn't load (memory, or the stored files went missing): the device's voice reads this visit.
      state = 'partial';
      stopSpeaker(m.msg);
    }
  };
  worker.onerror = (e) => {
    e.preventDefault();
    if (speaker !== worker) return;
    state = 'partial';
    stopSpeaker('crashed');
  };
  return (speaker = worker);
}

/** Loads the model before the first clip is asked for (the reader opened the page with this voice on). */
export const prepareEnVoice = () => enVoiceOn() && getSpeaker().postMessage({ t: 'load' });

/** An object URL with `text` spoken. `urgent`: the reader is waiting, so it goes before read-ahead work. */
export function enClip(text: string, urgent = false): Promise<string> {
  if (!enVoiceOn()) return Promise.reject(new Error('no voice'));
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

/** English text in pieces of about a sentence (the first one short, so the voice starts sooner): ends of sentences,
 *  not decimals («4.5») nor common abbreviations («U.S.», «Dr.»); a long one cut at a comma. */
export function enSentences(text: string): string[] {
  const out: string[] = [];
  // «Dr.», «Inc.», and one letter then a dot («U.S.», «e.g.», «J. Smith»): not an end.
  const ABBR = /\b(?:Mr|Mrs|Ms|Dr|Prof|Inc|Ltd|Co|Corp|vs|etc|St|Jr|Sr|No|[A-Za-z])\.$/;
  let buf = '';
  const rest = text.replace(/\s+/g, ' ').trim();
  for (const m of rest.matchAll(/[^.!?…]+(?:[.!?…]+["'”’)]*|$)\s*/g)) {
    buf += m[0];
    if (ABBR.test(buf.trim()) || (/\d\.$/.test(buf) && /^\d/.test(rest.slice(m.index! + m[0].length)))) continue;
    push(buf.trim());
    buf = '';
  }
  if (buf.trim()) push(buf.trim());
  function push(t: string) {
    if (!t) return;
    const last = out.length - 1;
    if (last >= 0 && (t.length < 24 || out[last].length < 24) && out[last].length + t.length < 220) return void (out[last] += ` ${t}`);
    if (t.length <= 240) return void out.push(t);
    let piece = '';
    for (const c of t.match(/[^,;]+[,;]?/g) ?? [t]) {
      if (piece && piece.length + c.length > 200) {
        out.push(piece.trim());
        piece = '';
      }
      piece += c;
    }
    if (piece.trim()) out.push(piece.trim());
  }
  // A long first piece is cut at its first comma past 30 characters, so the first clip comes sooner.
  const first = out[0];
  if (first && first.length > 110) {
    const at = first.slice(30, 110).search(/[,;:]\s/);
    if (at >= 0 && first.length - (at + 31) >= 25) out.splice(0, 1, first.slice(0, at + 31).trim(), first.slice(at + 31).trim());
  }
  return out;
}
