// When each word is said, for every voice (PLAN.md P1-D): the word lit on the story page and in the listen bar's caption.
// - A clip (the cloud voice, a connected service, the on-device voice, an offline-saved clip): its sound is decoded and
//   src/lib/align.ts finds the words in it, once per clip (kept in memory by its address).
// - The device's own voice (speechSynthesis) has no clip: its `boundary` events say where it is where the browser fires
//   them; otherwise the words are estimated by length at this voice's pace, restarted at each paragraph.
import { align, words as split, type Span } from '../lib/align';

export type Clock =
  /** A clip: `text` (a paragraph, or one sentence of it for the on-device voice) starts at `offset` in the line. */
  | { kind: 'clip'; src: string; text: string; offset: number; t: number }
  /** The device's voice: the last boundary it reported (or none), and how long it has been speaking the line. */
  | { kind: 'device'; text: string; boundary: number | null; elapsed: number; rate: number };

/** A word of a line: where it is in the line's text. */
export type Word = { from: number; to: number };

const spans = new Map<string, Span[] | null>();
const pending = new Map<string, Promise<void>>();

/** Where each word of `text` starts and ends in the line, by character. */
export function wordOffsets(text: string, offset = 0): Word[] {
  const out: Word[] = [];
  for (const m of text.matchAll(/\S+/g)) out.push({ from: offset + m.index!, to: offset + m.index! + m[0].length });
  return out;
}

async function decode(src: string, text: string): Promise<void> {
  try {
    const res = await fetch(src);
    if (!res.ok) throw new Error(String(res.status));
    const buf = await res.arrayBuffer();
    const ctx = new OfflineAudioContext(1, 1, 44100);
    const audio = await ctx.decodeAudioData(buf);
    // Mono: the first channel is enough to hear where words start and stop.
    spans.set(src, align(audio.getChannelData(0), audio.sampleRate, split(text)));
  } catch {
    spans.set(src, null); // no timings for this clip: the paragraph stays lit, not a word
  }
}

/** Starts working out a clip's word timings (from its address: the same file the audio element plays). */
export function prepare(src: string, text: string) {
  if (spans.has(src) || pending.has(src) || typeof OfflineAudioContext === 'undefined') return;
  pending.set(src, decode(src, text).finally(() => pending.delete(src)));
}

// The device's voice: Persian letters per second at rate 1, learned as paragraphs finish (a guess until then).
let pace = 13;
export function learnPace(text: string, seconds: number, rate: number) {
  if (seconds > 1.5) pace = pace * 0.6 + (text.replace(/\s+/g, '').length / seconds / rate) * 0.4;
}

/** The word being said now, as a character range of the line, or null while it can't tell. `lead` (seconds) lights a
 *  word just before it is heard, which feels in step. */
export function wordAt(c: Clock, lead = 0.06): Word | null {
  if (c.kind === 'clip') {
    const s = spans.get(c.src);
    if (!s) {
      prepare(c.src, c.text);
      return null;
    }
    const ws = wordOffsets(c.text, c.offset);
    const t = c.t + lead;
    // Binary search: the last word that has started.
    let lo = 0;
    let hi = s.length - 1;
    if (!s.length || t < s[0].from) return ws[0] ?? null;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (s[mid].from <= t) lo = mid;
      else hi = mid - 1;
    }
    return ws[lo] ?? null;
  }
  const ws = wordOffsets(c.text);
  if (c.boundary != null) return ws.find((w) => c.boundary! >= w.from && c.boundary! < w.to + 1) ?? null;
  // No boundary events: by length, at the learned pace.
  let chars = (c.elapsed + lead) * pace * c.rate;
  for (const w of ws) {
    chars -= c.text.slice(w.from, w.to).length + 1;
    if (chars < 0) return w;
  }
  return ws[ws.length - 1] ?? null;
}

/** The time (seconds into the clip) a character of the line is said at, for tap-to-jump; null when unknown. */
export function timeOf(c: Extract<Clock, { kind: 'clip' }>, char: number): number | null {
  const s = spans.get(c.src);
  if (!s) return null;
  const ws = wordOffsets(c.text, c.offset);
  const k = ws.findIndex((w) => char < w.to);
  return k >= 0 && s[k] ? s[k].from : null;
}
