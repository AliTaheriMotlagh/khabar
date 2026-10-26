// When each word of a spoken clip is said, from the clip's sound alone: the voices (sherpa-onnx on the device, Azure's
// REST endpoint) give audio, not timings. The words' lengths give a first guess; the pauses the voice makes after
// sentences and commas are found in the sound (quiet stretches) and pin the guess down, and the words in between are
// shared out by length and moved to the nearest dip in loudness. Used by the story's video (src/scripts/video.ts) to
// light each word as it's said. No imports: unit-tested from Node (tests/align.test.mjs).

export type Span = { from: number; to: number };

/** The words of a text, as the video shows them and the voice says them. */
export const words = (text: string) => text.split(/\s+/).filter(Boolean);

/** How long a word takes to say, in Persian letters (fitted on the site's Piper and Matcha voices, 211 words each): a
 *  Latin letter takes about as long, a digit 3.5 times as long (a number is said as words), plus half a letter a word. */
export function weight(w: string): number {
  const fa = (w.match(/[ؠ-يٮ-ۓۺ-ۿ]/g) ?? []).length;
  const la = (w.match(/[A-Za-z]/g) ?? []).length;
  const digits = (w.match(/[0-9۰-۹٠-٩]/g) ?? []).length;
  return Math.max(1.5, 0.5 + fa + la * 0.95 + digits * 3.5);
}

/** The pause a voice makes after a word: 2 after a sentence, 1 after a comma, 0 inside a phrase. */
export const pauseAfter = (w: string) => (/[.!?؟…]["»)\]]*$/.test(w) ? 2 : /[،,:;؛]["»)\]]*$/.test(w) ? 1 : 0);
/** A pause's length in the first guess, in weight units (≈ 0.11 s each: 0.2 s after a comma, 0.36 s after a sentence). */
const PAUSE_UNITS = [0, 1.8, 3.2];

const FRAME = 0.01; // seconds: the loudness is measured in 10 ms steps
const MIN_GAP = 4; // frames: a quieter stretch this long counts as a pause
// frames: a boundary between pins moves to the nearest near-silence this close, farther the farther it is from a pin
// (the guess drifts as it goes); with none, it stays where the weights put it (a dip inside a word is no boundary)
const SNAP = 5;
const SNAP_MAX = 18;

/** When each word is said in `pcm` (mono samples at `rate`), in seconds from the clip's start. */
export function align(pcm: Float32Array, rate: number, ws: string[]): Span[] {
  const n = ws.length;
  if (!n) return [];
  const hop = Math.max(1, Math.round(rate * FRAME));
  const frames = Math.max(1, Math.floor(pcm.length / hop));
  const env = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let i = f * hop, end = Math.min(pcm.length, i + hop); i < end; i++) sum += pcm[i] * pcm[i];
    env[f] = Math.sqrt(sum / hop);
  }
  const sorted = Float32Array.from(env).sort();
  const peak = sorted[Math.floor((frames - 1) * 0.98)];
  // A clip is mostly speech: its quietest frames are the floor, and a pause is well below the loud ones whatever it is.
  const floor = sorted[Math.floor((frames - 1) * 0.02)];
  const thr = Math.min(peak * 0.15, Math.max(floor * 2.5, peak * 0.06, 1e-4));
  let first = env.findIndex((v) => v > thr);
  let last = frames - 1;
  while (last > 0 && env[last] <= thr) last--;
  if (first < 0 || last <= first) {
    first = 0;
    last = frames - 1;
  }

  // The first guess: each word's share of the speech by weight, with room for the pauses.
  const w = ws.map(weight);
  const p = ws.map((x, i) => (i < n - 1 ? pauseAfter(x) : 0));
  const starts: number[] = [];
  let units = 0;
  for (let i = 0; i < n; i++) {
    starts.push(units);
    units += w[i] + PAUSE_UNITS[p[i]];
  }
  const scale = (last + 1 - first) / units;
  /** Guessed frame of the boundary after word i (the middle of its pause). */
  const guess = (i: number) => first + (starts[i] + w[i] + PAUSE_UNITS[p[i]] / 2) * scale;

  // Quiet stretches inside the speech.
  const gaps: { a: number; b: number }[] = [];
  for (let f = first; f <= last; f++) {
    if (env[f] > thr) continue;
    const a = f;
    while (f <= last && env[f] <= thr) f++;
    if (f - a >= MIN_GAP) gaps.push({ a, b: f });
  }

  // Sentence and comma boundaries to pauses, in order (one each at most), the best total: a sentence's pause is worth
  // more than a comma's, a longer pause more than a short one, and less the farther it is from the guess. A boundary
  // between two words is never pinned: real voices go quiet inside words too (before a «ک», a «ت»), and pinning those
  // tripled the error measured on the site's voices.
  const win = Math.max(40, (last - first) * 0.18);
  const value = [0, 2, 3];
  const score = (j: number, g: number) => {
    const gap = gaps[g];
    const d = Math.abs((gap.a + gap.b) / 2 - guess(j)) / win;
    return d >= 1 ? 0 : value[p[j]] * Math.min(1, (gap.b - gap.a) / 15) * (1 - d * d);
  };
  const B = n - 1;
  const G = gaps.length;
  const best = Array.from({ length: B + 1 }, () => new Float64Array(G + 1));
  for (let j = 1; j <= B; j++)
    for (let g = 1; g <= G; g++) best[j][g] = Math.max(best[j - 1][g], best[j][g - 1], best[j - 1][g - 1] + score(j - 1, g - 1));
  const pinned = new Map<number, { a: number; b: number }>();
  for (let j = B, g = G; j > 0 && g > 0; ) {
    const s = score(j - 1, g - 1);
    if (s > 0 && best[j][g] === best[j - 1][g - 1] + s) {
      pinned.set(j - 1, gaps[g - 1]);
      j--;
      g--;
    } else if (best[j][g] === best[j - 1][g]) j--;
    else g--;
  }

  // Between pins, the words share the stretch by weight; a boundary with a near-silence close by moves to it.
  const from = new Array<number>(n);
  const to = new Array<number>(n);
  from[0] = first;
  to[n - 1] = last + 1;
  let i0 = 0;
  for (let j = 0; j <= B; j++) {
    const pin = j < B ? pinned.get(j) : undefined;
    if (j < B && !pin) continue;
    // Words i0..j fill from[i0] .. (pin ? pin.a : end).
    const end = pin ? pin.a : last + 1;
    let total = 0;
    for (let i = i0; i <= j; i++) total += w[i] + (i < j ? PAUSE_UNITS[p[i]] * 0.3 : 0);
    let at = from[i0];
    const per = (end - at) / total;
    for (let i = i0; i < j; i++) {
      at += (w[i] + PAUSE_UNITS[p[i]] * 0.3) * per;
      let cut = Math.min(end - 1, Math.max(from[i] + 1, Math.round(at)));
      const reach = Math.round(Math.min(SNAP_MAX, SNAP + Math.min(cut - from[i0], end - cut) * 0.06));
      for (let d = 0; d <= reach; d++) {
        const f = [cut - d, cut + d].find((f) => f > from[i] && f < end && env[f] <= thr * 1.5);
        if (f !== undefined) {
          cut = f;
          break;
        }
      }
      to[i] = cut;
      from[i + 1] = cut;
    }
    to[j] = end;
    if (pin) from[j + 1] = pin.b;
    i0 = j + 1;
  }
  return from.map((f, i) => ({ from: f * FRAME, to: Math.max(f + 1, to[i]) * FRAME }));
}
