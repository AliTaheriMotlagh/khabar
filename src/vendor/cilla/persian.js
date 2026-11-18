// From Cilla Mini's demo (https://huggingface.co/spaces/mehdi-hf/cilla-mini-demo, web/persian.js at commit
// 4e521dd7adb9538dfdfeee989b002dc769441510), by mehdi-hf, CC BY-NC 4.0: the model's own Persian front end (normalizing,
// numbers in words, cutting into pieces by the model's tokens, trimming silence). Unchanged; used by src/scripts/cilla.ts.
// @ts-nocheck
// The Persian front-end of Cilla Mini in JavaScript: a port of normalize_fa.py and of the text and audio helpers of speak_fa.py
// (normalise, one piece per sentence, trim the silence, mute the first 70 ms). Tested against the Python code on real texts
// (test_persian.mjs). Works in a browser and in node.
import {
  PERSIAN_LETTERS, KEPT_PUNCT, CHAR_MAP, DIGIT_MAP, PUNCT_MAP, ONES, TEENS, TENS, HUNDREDS, SCALES, FRACTION_UNITS, JOIN, MAX_NUMBER_DIGITS,
} from "./persian_tables.js";

export const ZWNJ = "‌";
const ALLOWED = new Set([...PERSIAN_LETTERS, ZWNJ, ...KEPT_PUNCT, " "]);
const DIACRITICS = /[ً-ٰٕۖ-ۭٖ-ٟ]/g;
const INVISIBLES = /[​‍‎‏‪-‮⁦-⁩﻿­]/g;
const escapeClass = (s) => s.replace(/[\\\]\[^-]/g, "\\$&");
const PUNCT_CLASS = escapeClass(KEPT_PUNCT);

const mapChars = (text, map) => [...text].map((c) => (c in map ? map[c] : c)).join("");

// ---- numbers ----
function underThousand(n) {
  const parts = [];
  if (n >= 100) { parts.push(HUNDREDS[Math.floor(n / 100)]); n %= 100; }
  if (n >= 20) { parts.push(TENS[Math.floor(n / 10)]); n %= 10; }
  if (n >= 10 && n < 20) { parts.push(TEENS[n - 10]); n = 0; }
  if (n > 0) parts.push(ONES[n]);
  return parts.join(JOIN);
}

export function numberToWords(n) {
  if (n === 0) return "صفر"; // صفر
  const parts = [];
  for (const [value, name] of SCALES) {
    if (n >= value) {
      const count = Math.floor(n / value);
      n %= value;
      const head = count === 1 && value === 1000 ? "" : underThousand(count) + " ";
      parts.push(`${head}${name}`.trim());
    }
  }
  if (n > 0) parts.push(underThousand(n));
  return parts.join(JOIN);
}

const digitsOneByOne = (digits) => [...digits].map((d) => (d === "0" ? "صفر" : ONES[Number(d)])).join(" ");

function numberTokenToWords(whole, frac) {
  if (whole.length > MAX_NUMBER_DIGITS || (whole.startsWith("0") && whole.length > 1)) {
    return " " + digitsOneByOne(whole) + (frac ? " " + digitsOneByOne(frac) : "") + " ";
  }
  whole = whole.replace(/^0+/, "") || "0";
  let words = numberToWords(Number(whole));
  if (frac) {
    frac = frac.replace(/0+$/, "");
    if (!frac) return " " + words + " ";
    const unit = FRACTION_UNITS[frac.length];
    words += unit ? " ممیز " + numberToWords(Number(frac)) + " " + unit : " ممیز " + digitsOneByOne(frac);
  }
  return " " + words + " ";
}

export function numbersToWords(text) {
  // 1,234,567 -> 1234567 (Python's \b is Unicode-aware: a letter after the digits is not a boundary)
  text = text.replace(/(?<=[0-9]),(?=[0-9]{3}(?![\p{L}\p{N}\p{M}_]))/gu, "");
  return text.replace(/([0-9]+)(?:[.]([0-9]+))?/g, (_, whole, frac) => numberTokenToWords(whole, frac));
}

// ---- normalisation ----
export function normalize(text, spellNumbers = true) {
  text = text.normalize("NFC");
  text = text.replace(INVISIBLES, "").replace(DIACRITICS, "");
  text = mapChars(text, CHAR_MAP);
  text = mapChars(text, DIGIT_MAP);
  text = text.replaceAll("٬", "").replaceAll("٫", ".");
  text = text.replace(/[٪%]/g, " درصد ");
  if (spellNumbers) text = numbersToWords(text);
  text = mapChars(text, PUNCT_MAP);
  text = [...text].map((c) => (ALLOWED.has(c) ? c : " ")).join("");
  text = text.replace(new RegExp(`${ZWNJ}+`, "g"), ZWNJ);
  text = text.replace(new RegExp(`\\s*${ZWNJ}\\s*`, "g"), (m) => (m.includes(" ") ? " " : ZWNJ));
  const L = PERSIAN_LETTERS;
  text = text.replace(new RegExp(`(?<![${L}])${ZWNJ}|${ZWNJ}(?![${L}])`, "g"), "");
  text = text.replace(new RegExp(`\\s+([${PUNCT_CLASS}])`, "g"), "$1");
  text = text.replace(new RegExp(`([${PUNCT_CLASS}])\\1+`, "g"), "$1");
  text = text.replace(/\s+/g, " ").trim();
  let i = 0;
  while (i < text.length && (KEPT_PUNCT.includes(text[i]) || text[i] === " ")) i++;
  return text.slice(i);
}

export function withEnd(text) {
  text = text.trim();
  return text === "" || ".؟!".includes(text.slice(-1)) ? text : text + ".";
}

// ---- token counting: the model's own BPE (tokenizer.json), only to size the pieces ----
export function makeTokenCounter(tokenizerJson) {
  const { vocab, merges } = tokenizerJson.model;
  const rank = new Map();
  merges.forEach((m, i) => { const [a, b] = Array.isArray(m) ? m : m.split(" "); rank.set(a + "\u0001" + b, i); });
  const cache = new Map();
  const wordTokens = (word) => {
    if (cache.has(word)) return cache.get(word);
    let parts = [...word];
    for (;;) {
      let best = -1, bestRank = Infinity;
      for (let i = 0; i + 1 < parts.length; i++) {
        const r = rank.get(parts[i] + "\u0001" + parts[i + 1]);
        if (r !== undefined && r < bestRank) { bestRank = r; best = i; }
      }
      if (best < 0) break;
      parts = [...parts.slice(0, best), parts[best] + parts[best + 1], ...parts.slice(best + 2)];
    }
    let n = 0, prevUnknown = false;
    for (const p of parts) {
      const unknown = !(p in vocab);
      if (!(unknown && prevUnknown)) n++; // consecutive unknown pieces fuse into one
      prevUnknown = unknown;
    }
    cache.set(word, n);
    return n;
  };
  // the tokenizer's normaliser turns a zero-width non-joiner into a space; text here is already normalised
  return (text) => text.replaceAll(ZWNJ, " ").split(" ").filter(Boolean).reduce((s, w) => s + wordTokens("▁" + w), 0);
}

// ---- cutting into pieces (speak_fa.py: split_sentences and split_text) ----
const HARD_BREAK = /(?<=[.!؟])\s+/;
const SOFT_BREAK = /(?<=[،؛:])\s+/;
const BREAK_CHARS = [".", "!", "؟", "،", "؛", ":"];
const endsWithBreak = (s) => BREAK_CHARS.some((c) => s.trimEnd().endsWith(c));
const words = (s) => s.split(/\s+/).filter(Boolean);

function pack(wordList, count, fits, nChunks, target) {
  const out = [];
  let cur = "";
  for (const word of wordList) {
    const trial = `${cur} ${word}`.trim();
    const owed = out.length < nChunks - 1;
    if (cur && (!fits(trial) || (owed && count(trial) > target))) { out.push(cur); cur = word; } else cur = trial;
  }
  if (cur) out.push(cur);
  return out;
}

export function splitText(text, count, maxTokens = 40, minTokens = 8) {
  text = words(text).join(" ");
  if (!text) return [];
  const fits = (s) => count(s) <= maxTokens;
  const splitBy = (pattern, piece) => { const parts = piece.split(pattern).map((p) => p.trim()).filter(Boolean); return parts.length > 1 ? parts : []; };
  const recurse = (piece) => {
    if (fits(piece)) return [piece];
    for (const pattern of [HARD_BREAK, SOFT_BREAK]) {
      const parts = splitBy(pattern, piece);
      if (parts.length) return parts.flatMap(recurse);
    }
    const ws = words(piece);
    const total = count(piece);
    let nChunks = Math.max(1, Math.ceil(total / maxTokens));
    let chunks = [];
    for (let k = 0; k < 4; k++) {
      chunks = pack(ws, count, fits, nChunks, Math.ceil(total / nChunks));
      if (chunks.length <= nChunks) return chunks;
      nChunks = chunks.length;
    }
    return chunks;
  };
  const merged = [];
  for (const chunk of recurse(text)) {
    if (merged.length && fits(`${merged[merged.length - 1]} ${chunk}`)) merged[merged.length - 1] += ` ${chunk}`;
    else merged.push(chunk);
  }
  for (let i = merged.length - 1; i > 0; i--) {
    if (count(merged[i]) >= minTokens) continue;
    if (endsWithBreak(merged[i - 1])) continue;
    while (count(merged[i]) < minTokens) {
      const ws = words(merged[i - 1]);
      if (ws.length < 2 || count(ws.slice(0, -1).join(" ")) < minTokens) break;
      merged[i - 1] = ws.slice(0, -1).join(" ");
      merged[i] = `${ws[ws.length - 1]} ${merged[i]}`;
    }
  }
  return merged;
}

export function splitSentences(text, count, maxTokens = 80, minTokens = 8) {
  const out = [];
  for (const sentence of words(text).join(" ").split(HARD_BREAK).map((s) => s.trim())) {
    if (!sentence) continue;
    const short = count(sentence) < minTokens || (out.length && count(out[out.length - 1]) < minTokens);
    if (out.length && short && count(`${out[out.length - 1]} ${sentence}`) <= maxTokens) out[out.length - 1] += ` ${sentence}`;
    else if (count(sentence) > maxTokens) out.push(...splitText(sentence, count, maxTokens, minTokens));
    else out.push(sentence);
  }
  return out;
}

// ---- audio (Float32Array at `sr`) ----
export function trimSilence(a, sr, keepMs = 120) {
  if (!a.length) return a;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * a[i];
  const rms = Math.sqrt(sum / a.length);
  if (rms <= 0) return a;
  const win = Math.floor(0.02 * sr), thr = 0.04 * rms;
  let first = -1, last = -1;
  for (let i = 0; i < Math.max(a.length - win, 1); i += win) {
    let s = 0;
    const end = Math.min(i + win, a.length);
    for (let j = i; j < end; j++) s += a[j] * a[j];
    if (Math.sqrt(s / (end - i)) > thr) { if (first < 0) first = i; last = i; }
  }
  if (first < 0) return a;
  const margin = Math.floor((keepMs / 1000) * sr);
  return a.slice(Math.max(0, first - margin), Math.min(a.length, last + win + margin));
}

export function cleanStart(a, sr, muteMs = 70, fadeMs = 20) {
  const out = Float32Array.from(a);
  const m = Math.floor((muteMs / 1000) * sr), f = Math.floor((fadeMs / 1000) * sr);
  out.fill(0, 0, Math.min(m, out.length));
  const n = Math.max(0, Math.min(out.length, m + f) - m);
  for (let k = 0; k < n; k++) out[m + k] *= n > 1 ? k / (n - 1) : 0;
  return out;
}

export function joinPieces(pieces, sr, pauseSec = 0.15) {
  const gap = Math.floor(pauseSec * sr);
  const total = pieces.reduce((s, p) => s + p.length, 0) + gap * Math.max(0, pieces.length - 1);
  const out = new Float32Array(total);
  let pos = 0;
  pieces.forEach((p, i) => { out.set(p, pos); pos += p.length + (i < pieces.length - 1 ? gap : 0); });
  return out;
}

// text -> the pieces to speak (normalised, one per sentence)
export function textToPieces(text, count) {
  return splitSentences(normalize(withEnd(text)), count);
}

// ---- word timings for captions ----
// The model does not say when each word is spoken, so the start of every word is estimated: the speech span of the piece is found from
// its energy, shared out in proportion to each word's length (Persian letters, plus a pause after a comma, colon or semicolon), and every
// word boundary is then moved to the nearest dip in the energy. Returns [{ word, start }] in seconds from the start of `pcm`.
const PAUSE_AFTER = { "،": 4, "؛": 5, ":": 4 };
const LETTERS = new Set(PERSIAN_LETTERS);

// The learned word lengths (timing_model.json: weights over the word's features and a bias for frequent words, fitted on 219,000 aligned words
// of our synthetic training speech) replace the plain letter count when a `model` is given.
export function expectedDuration(word, i, n, model) {
  const L = [...word].filter((c) => LETTERS.has(c)).length, V = [...word].filter((c) => "\u0627\u0622\u0648\u06cc\u0626".includes(c)).length;
  const Z = [...word].filter((c) => c === ZWNJ).length, last = word.slice(-1);
  const f = [1, L, V, Z, "\u060c\u061b:".includes(last) ? 1 : 0, ".\u061f!".includes(last) ? 1 : 0, i === 0 ? 1 : 0, i === n - 2 ? 1 : 0, Math.sqrt(L)];
  let d = f.reduce((s, x, k) => s + x * model.weights[k], 0);
  d += model.bias[word.replace(/[\u060c\u061b:.\u061f!]+$/g, "")] || 0;
  return Math.max(0.05, d);
}

export function wordTimings(text, pcm, sr, opts = {}) {
  const { base = 1.5, snapMs = 0, model = null } = opts; // no snapping by default: on real speech it did not help
  const ws = text.split(/\s+/).filter(Boolean);
  if (!ws.length) return [];
  const win = Math.max(1, Math.floor(0.02 * sr)), hop = Math.max(1, Math.floor(0.01 * sr));
  const env = [];
  for (let i = 0; i + win <= pcm.length; i += hop) {
    let s = 0;
    for (let j = i; j < i + win; j++) s += pcm[j] * pcm[j];
    env.push(Math.sqrt(s / win));
  }
  const dur = pcm.length / sr;
  if (env.length < 4) return ws.map((w, i) => ({ word: w, start: (dur * i) / ws.length }));
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i];
  const thr = 0.04 * Math.sqrt(sum / pcm.length);
  let first = env.findIndex((e) => e > thr), last = env.length - 1 - [...env].reverse().findIndex((e) => e > thr);
  if (first < 0) { first = 0; last = env.length - 1; }
  const t0 = (first * hop) / sr, t1 = (last * hop + win) / sr;
  const sm = env.map((_, i) => (env[Math.max(0, i - 1)] + env[i] + env[Math.min(env.length - 1, i + 1)]) / 3);
  // proportional shares: each word, then the pause after it (not after the last word)
  const letters = (w) => [...w].filter((c) => LETTERS.has(c)).length;
  let pos = 0;
  const shares = ws.map((w, i) => {
    const start = pos;
    pos += model ? expectedDuration(w, i, ws.length + 1, model) : letters(w) + base;
    const pause = !model && i < ws.length - 1 ? PAUSE_AFTER[w.slice(-1)] || 0 : 0; // the learned model already includes the pause after a comma
    const wordEnd = pos;
    pos += pause;
    return { start, wordEnd, pause };
  });
  const scale = (t1 - t0) / pos;
  const starts = shares.map((s) => t0 + s.start * scale);
  // move each inner boundary to the energy dip near the estimate (to the end of the silence when a pause is expected)
  const r = Math.round((snapMs / 1000) * sr / hop);
  let prev = t0;
  for (let i = 1; i < ws.length; i++) {
    const gapStart = t0 + shares[i - 1].wordEnd * scale, gapEnd = starts[i];
    const c = Math.round((((gapStart + gapEnd) / 2) * sr) / hop);
    let lo = Math.max(1, c - r), hi = Math.min(sm.length - 2, c + r), m = lo;
    for (let k = lo; k <= hi; k++) if (sm[k] < sm[m]) m = k;
    let k = m;
    if (shares[i - 1].pause > 0) while (k < sm.length - 2 && sm[k] < 2 * thr && k < hi + r) k++; // the onset after the pause
    let b = (k * hop) / sr;
    b = Math.max(b, prev + 0.05);
    b = Math.min(b, t1 - 0.05 * (ws.length - i));
    starts[i] = b; prev = b;
  }
  starts[0] = Math.max(0, t0 - 0.03);
  return ws.map((w, i) => ({ word: w, start: starts[i] }));
}
