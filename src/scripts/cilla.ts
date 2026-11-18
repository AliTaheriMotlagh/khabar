// Cilla Mini, the on-device Persian voice on phonon-tts (src/lib/voices.ts: three speakers, one model). Loaded by
// src/scripts/voice.ts on the first clip a Cilla speaker is asked for. The files come from the voice store (Cache
// Storage, downloaded and checked by src/scripts/voice-worker.ts) as blob URLs, so phonon's own cache is off. Speech as
// the model's demo makes it: the model's Persian front end (src/vendor/cilla/persian.js: normalize, numbers in words,
// one piece per sentence by the model's own tokens), each piece trimmed of silence with its first 70 ms muted, 150 ms
// between pieces, a fixed seed (the same text sounds the same, every time). phonon generates in its own worker, on the
// CPU: one thread, since the site isn't cross-origin isolated (that would block the pictures from other hosts).
// Requests run one at a time, the one the reader waits for first; a queue past QUEUE_MAX drops the oldest read-ahead.
import { PhononTTS, encodeWav } from 'phonon-tts';
import * as P from '../vendor/cilla/persian.js';
import { sayLine } from '../../server/_say.js';
import type { Voice, VoiceFile } from '../lib/voices';

const SR = 24000;
const SEED = 4242;
const QUEUE_MAX = 6;

type Job = { text: string; speaker: string; urgent: boolean; ready: Promise<unknown>; resolve(url: string): void; reject(e: Error): void };
let model: Promise<{ tts: PhononTTS; count: (s: string) => number }> | null = null;
let speakers = new Set<string>();
const adding = new Map<string, Promise<void>>();
function join(tts: PhononTTS, voice: Voice, file: (f: VoiceFile) => Promise<Blob>) {
  speakers.add(voice.speaker!);
  const p = file(voice.files[3]).then((b) => tts.addVoice(voice.speaker!, b));
  adding.set(voice.speaker!, p);
  return p;
}
let urls: string[] = [];
const queue: Job[] = [];
let busy = false;

/** Lets go of the model (its worker and memory). Waiting requests fail with `why`. */
export function stopCilla(why: string) {
  const m = model;
  model = null;
  speakers = new Set();
  adding.clear();
  m?.then(({ tts }) => tts.dispose(), () => {});
  for (const u of urls) URL.revokeObjectURL(u);
  urls = [];
  for (const j of queue.splice(0)) j.reject(new Error(why));
}

async function load(voice: Voice, file: (f: VoiceFile) => Promise<Blob>, others: Voice[]) {
  const url = async (f: VoiceFile) => {
    const u = URL.createObjectURL(await file(f));
    urls.push(u);
    return u;
  };
  const [config, tokenizer, weights] = voice.files;
  const tok = await file(tokenizer);
  const count = P.makeTokenCounter(JSON.parse(await tok.text()));
  // Every Cilla speaker already downloaded: switching between them needs no reload.
  const here = [voice, ...others.filter((v) => v.id !== voice.id)];
  const voices: Record<string, string> = {};
  for (const v of here) voices[v.speaker!] = await url(v.files[3]);
  const tts = await PhononTTS.load({
    lang: 'none',
    quant: 'f32',
    device: 'cpu',
    threads: 1,
    cache: false,
    model: { weights: { f32: await url(weights) }, tokenizer: await url(tokenizer), config: await url(config), voices, defaultVoice: voice.speaker! },
    voices: [voice.speaker!],
  });
  speakers = new Set(Object.keys(voices));
  return { tts, count };
}

async function pump() {
  if (busy || !model) return;
  const job = queue.shift();
  if (!job) return;
  busy = true;
  try {
    const { tts, count } = await model;
    await job.ready;
    // Persian letters only: an English word the line still has is spelled in Persian (server/_latin.js).
    const pieces = P.textToPieces(sayLine(job.text, undefined, true).say, count);
    const out: Float32Array[] = [];
    for (let i = 0; i < pieces.length; i++) {
      const pcm = await tts.synth(pieces[i], { voice: job.speaker, seed: SEED + i });
      out.push(P.cleanStart(P.trimSilence(pcm, SR), SR));
    }
    // Nothing to say (a line of symbols): a moment of silence, so the reading goes on.
    const wav = encodeWav(out.length ? P.joinPieces(out, SR, 0.15) : new Float32Array(SR / 5), SR);
    job.resolve(URL.createObjectURL(wav));
  } catch (e) {
    job.reject(e instanceof Error ? e : new Error(String(e)));
  } finally {
    busy = false;
    void pump();
  }
}

/** The text spoken by `voice` (a Cilla speaker), as an object URL of a WAV. `file` reads a stored file of the voice
 *  store; `others`: the other Cilla speakers downloaded here. */
export function cillaClip(voice: Voice, text: string, urgent: boolean, file: (f: VoiceFile) => Promise<Blob>, others: Voice[]): Promise<string> {
  if (!model) {
    model = load(voice, file, others);
    // A model that fails to load is tried again on the next request, not kept as a failure.
    model.catch(() => (model = null));
  }
  const m = model;
  return new Promise<string>((resolve, reject) => {
    // A speaker downloaded after the model was loaded joins it (once), before its first piece.
    const ready = m.then(({ tts }) => (speakers.has(voice.speaker!) ? adding.get(voice.speaker!) : join(tts, voice, file)));
    const job: Job = { text, speaker: voice.speaker!, urgent, ready, resolve, reject };
    if (urgent) queue.unshift(job);
    else queue.push(job);
    while (queue.length > QUEUE_MAX) {
      const drop = queue.findLastIndex((j) => !j.urgent);
      queue.splice(drop < 0 ? queue.length - 1 : drop, 1)[0].reject(new Error('dropped'));
    }
    void pump();
  });
}

/** Loads the model ahead of the first clip (the reader is about to listen). */
export function prepareCilla(voice: Voice, file: (f: VoiceFile) => Promise<Blob>, others: Voice[]) {
  if (model) return;
  model = load(voice, file, others);
  model.catch(() => (model = null));
}
