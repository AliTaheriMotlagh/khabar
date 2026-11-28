// The studio (src/pages/studio/, not listed, noindex): where the runner's headless Chrome turns a podcast's dialogue
// (pipeline/podcast.py → data/podcast/<day>.json) into sound with the site's own voices — Gholam as «سینا», Parisa as
// «پریسا» (Cilla Mini, one model, two speakers: src/scripts/voice.ts voiceClipFor) — exactly as a reader's device
// would make it. A short theme at the start and the end, a soft bed under the talk (ducked while someone speaks), a
// beat between turns. Returns a WAV and each line's time, for scripts/podcast.mjs (MP3, R2, the feed).
import { sentences, voiceClipFor, voiceStates } from './voice';
import { sayLine } from '../../server/_say.js';

const RATE = 44100;
type Line = { who: 'g' | 'p'; text: string; id?: number };
type Timed = Line & { at: number; end: number };

async function podcast(lines: Line[], lex: Record<string, string>, voices: Record<string, string>) {
  await voiceStates();
  const decoder = new OfflineAudioContext(1, 1, RATE);
  const clips: { at: number; pcm: Float32Array }[] = [];
  const timed: Timed[] = [];
  const INTRO = 4.2;
  let t = INTRO;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const { say } = sayLine(l.text, lex, true);
    const at = t;
    for (const piece of sentences(say)) {
      const url = await voiceClipFor(voices[l.who], piece);
      const pcm = (await decoder.decodeAudioData(await (await fetch(url)).arrayBuffer())).getChannelData(0);
      clips.push({ at: t, pcm });
      t += pcm.length / RATE + 0.08;
    }
    timed.push({ ...l, at: +at.toFixed(2), end: +t.toFixed(2) });
    const next = lines[i + 1];
    // A breath between one host's sentences, a little more when the other answers, more before a new story.
    t += !next ? 0 : next.id !== l.id ? 0.9 : next.who !== l.who ? 0.42 : 0.25;
  }
  const total = t + 5;
  const out = new Float32Array(Math.ceil(total * RATE));
  // The voice level, for ducking the bed (50 ms windows).
  const loud = new Float32Array(Math.ceil(total * 20));
  for (const c of clips) {
    const o = Math.round(c.at * RATE);
    out.set(c.pcm.subarray(0, out.length - o), o);
    for (let i = 0; i < c.pcm.length; i += 2205) {
      let s = 0;
      for (let j = i; j < Math.min(c.pcm.length, i + 2205); j++) s += c.pcm[j] * c.pcm[j];
      const k = Math.floor((c.at + i / RATE) * 20);
      if (k < loud.length) loud[k] = Math.max(loud[k], Math.sqrt(s / 2205));
    }
  }
  theme(out, 0.2, 3.8);
  bed(out, loud, INTRO - 0.6, t + 0.6);
  theme(out, t + 0.4, 4.4);
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  const gain = peak > 0.97 ? 0.97 / peak : 1;
  return { wav: wav(out, gain), lines: timed, seconds: +total.toFixed(1) };
}

/** The show's theme: four bright notes over a warm chord, swelling and fading. */
function theme(out: Float32Array, at: number, len: number) {
  const chord = [196, 246.94, 293.66, 392];
  const notes = [
    [0.0, 783.99],
    [0.28, 987.77],
    [0.56, 1174.66],
    [0.84, 1567.98],
  ];
  const o = Math.round(at * RATE);
  const n = Math.min(Math.round(len * RATE), out.length - o);
  for (let i = 0; i < n; i++) {
    const s = i / RATE;
    const env = Math.min(1, s / 0.8) * Math.min(1, (len - s) / 1.6);
    let v = 0;
    for (const f of chord) v += Math.sin(2 * Math.PI * f * s) + 0.4 * Math.sin(2 * Math.PI * f * 1.004 * s);
    v *= 0.022 * env;
    for (const [start, f] of notes) {
      const x = s - start;
      if (x > 0) v += 0.08 * Math.min(1, x * 160) * Math.exp(-x * 3.4) * (Math.sin(2 * Math.PI * f * x) + 0.3 * Math.sin(4 * Math.PI * f * x));
    }
    out[o + i] += v;
  }
}

/** A soft pad under the talk, down to a whisper while a host speaks. */
function bed(out: Float32Array, loud: Float32Array, from: number, to: number) {
  const chords = [
    [130.81, 196, 261.63],
    [110, 164.81, 220],
    [123.47, 185, 246.94],
    [98, 146.83, 196],
  ];
  let duck = 1;
  for (let i = Math.round(from * RATE); i < Math.min(out.length, to * RATE); i++) {
    const t = i / RATE;
    const c = chords[Math.floor(t / 6) % chords.length];
    const env = Math.min(1, (t - from) / 2) * Math.min(1, (to - t) / 2);
    const target = loud[Math.floor(t * 20)] > 0.02 ? 0.18 : 1;
    duck += (target - duck) * (target < duck ? 0.002 : 0.0002);
    let v = 0;
    for (const f of c) v += Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(2 * Math.PI * f * 1.003 * t);
    out[i] += 0.01 * env * duck * v;
  }
}

function wav(samples: Float32Array, gain: number): string {
  const b = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const str = (o: number, s: string) => [...s].forEach((c, i) => b.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  b.setUint32(4, 36 + samples.length * 2, true);
  str(8, 'WAVEfmt ');
  b.setUint32(16, 16, true);
  b.setUint16(20, 1, true);
  b.setUint16(22, 1, true);
  b.setUint32(24, RATE, true);
  b.setUint32(28, RATE * 2, true);
  b.setUint16(32, 2, true);
  b.setUint16(34, 16, true);
  str(36, 'data');
  b.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) b.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, samples[i] * gain)) * 32767), true);
  // As base64, for the runner (page.evaluate returns strings).
  const u = new Uint8Array(b.buffer);
  let s = '';
  for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode(...u.subarray(i, i + 32768));
  return btoa(s);
}

(window as unknown as { studio: unknown }).studio = { podcast };
