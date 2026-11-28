// A story — or the 24-hour summary — as a news video, made on the reader's own device: 1280×720, 30 fps, MP4.
// A branded opening (the logo draws itself, with a short chime), the headline, then chapters: the story's text with
// each word lit as the voice says it, its pictures beside it, a number popping up large when it's said and English
// names collected as tags; «چرا مهمه؟» as its own chapter; the summary one chapter per item, with the picture of the
// story the item points to. A closing card with the story's address. The plan (which lines, which pictures) is the
// story's card.json `video` (src/lib/posts.ts, videoPlan); the words are timed from the voice's own sound
// (src/lib/align.ts). The voice is one whose sound the page can keep (src/scripts/speech.ts, recordableVoice): the
// downloaded one or the cloud one — a reader with neither is offered the download first, as «گوش دادن» does.
// Made faster than real time with the browser's own encoders (WebCodecs, packed into MP4 by mediabunny; this module
// is only loaded on the first tap of «ویدیو», src/scripts/app.ts); where those can't make the sound (iOS before 26 has
// no AudioEncoder) the canvas is recorded as it plays (MediaRecorder), which takes as long as the video. Pictures go
// through the page's own addresses (/api/img first), fetched, so the canvas stays readable.
import { AudioBufferSource, BufferTarget, CanvasSource, Mp4OutputFormat, Output, canEncodeVideo, getFirstEncodableAudioCodec } from 'mediabunny';
import { $, BASE, fmtNum, store, tapAudio, toast, track } from './core';
import { SITE } from '../site';
import { align, pauseAfter, weight, words } from '../lib/align';
import { lineAudio, persianVoice, recordableVoice, voiceHost, type Line, type Recordable } from './speech';
import { sayLine, toShown } from '../../server/_say.js';
import { activeVoice, chosenVoice, voiceSupported } from './voice';
import { openVoice } from './voice-offer';
import type { FilmClipJson, FilmMeta, FilmOpts, FilmScene, FilmShotJson, FilmSrc, FilmVideo } from './film';
import type { Footage } from './footage';

const FPS = 30;
const RATE = 48000;
/** Seconds: the opening, the closing card, a scene's way in before its voice starts, the pause between paragraphs,
 *  and a headline that isn't read aloud (its first paragraph says it). A short video has no opening: its hook is on
 *  screen from the first frame (the logo is in the corner all along). */
const FULL_INTRO = 2.8;
let INTRO = FULL_INTRO;
const OUTRO = 3.6;
const LEAD = 0.7;
const GAP = 0.35;
const TITLE_SILENT = 3.4;
export const FONT = '"Vazirmatn Variable", system-ui, sans-serif';
const PIC_WAIT = 9000;

// ---------- the frame: three shapes (PLAN.md P1-C) ----------
// Landscape (YouTube, a computer), vertical (Instagram stories and reels, Telegram and WhatsApp status: where people in
// Iran share) and square. Landscape puts the picture beside the text; the others stack the picture over it.
// k scales the frame's small type (logo, date, link, tags) to the shape.
export type Shape = 'v' | 'h' | 's';
type Geo = {
  W: number; H: number; M: number; k: number;
  panel: { x: number; y: number; w: number; h: number };
  col: { right: number; w: number };
  body: { size: number; lh: number; bottom: number };
  /** The headline's sizes, largest first: the first that fits `titleRoom` is used; its block is centered on `titleMid`. */
  titleSizes: number[]; titleRoom: number; titleMid: number;
  /** A headline with no picture beside it. */
  wide: number;
  /** The header's baseline; a chapter's heading; where the text starts, under a heading or not. */
  top: number; headY: number; textTop: { head: number; plain: number };
};
const GEO: Record<Shape, Geo> = {
  h: { W: 1280, H: 720, M: 64, k: 1, panel: { x: 64, y: 140, w: 520, h: 390 }, col: { right: 1216, w: 560 }, body: { size: 32, lh: 58, bottom: 620 },
       titleSizes: [64, 56, 50, 44, 38, 34], titleRoom: 440, titleMid: 375, wide: 960, top: 62, headY: 160, textTop: { head: 262, plain: 200 } },
  // Vertical is a reel: Instagram/Telegram draw their buttons over the top ~12% and the bottom ~20%, so the text stays
  // between (body.bottom), the chapters' progress runs along the top like a story's, and the type is larger.
  v: { W: 1080, H: 1920, M: 72, k: 1.45, panel: { x: 72, y: 230, w: 936, h: 700 }, col: { right: 1008, w: 936 }, body: { size: 52, lh: 92, bottom: 1560 },
       titleSizes: [96, 86, 78, 70, 62, 54], titleRoom: 560, titleMid: 1250, wide: 936, top: 128, headY: 975, textTop: { head: 1110, plain: 1030 } },
  s: { W: 1080, H: 1080, M: 64, k: 1.25, panel: { x: 64, y: 140, w: 952, h: 380 }, col: { right: 1016, w: 952 }, body: { size: 38, lh: 66, bottom: 960 },
       titleSizes: [70, 62, 54, 48, 42, 38], titleRoom: 300, titleMid: 790, wide: 952, top: 74, headY: 606, textTop: { head: 712, plain: 640 } },
};
let G = GEO.h;
let W = G.W;
let H = G.H;
let M = G.M;
let PANEL = G.panel;
let COL = G.col;
let BODY = G.body;
let TITLE_SIZES = G.titleSizes;
let TITLE_ROOM = G.titleRoom;
let REEL = false;
/** Sets the frame for the video about to be made (one at a time). */
function useShape(shape: Shape) {
  G = GEO[shape];
  ({ W, H, M } = G);
  PANEL = G.panel;
  COL = G.col;
  BODY = G.body;
  TITLE_SIZES = G.titleSizes;
  TITLE_ROOM = G.titleRoom;
  REEL = shape === 'v';
}
export const YELLOW = '#ffd166';
export const INK = '#141a33';

type Plan = { title: boolean; chapters: { head: string | null; say: number[]; pics: string[][] }[] };
type Card = {
  id: number; kind: string; title: string; href: string; date: string; tag: string | null; body: string[]; why: string | null; video: Plan;
  whyLabel?: string; lex?: Record<string, string>; source?: string; share?: string; short?: string;
  /** The model's 60-second script (pipeline/ai_more.py ai.x.video). */
  clip?: { hook: string; points: string[]; why: string };
  /** An episode teaser's YouTube address, shown on the closing card instead of the story's (/videos/<id>/card.json). */
  link?: string; vid?: string;
  /** The short film's shots (src/lib/posts.ts filmPlan, drawn by src/scripts/film.ts), the source's own video, and
   *  what a newscast shows around the story (status, ticker…). */
  film?: { src?: FilmSrc; clip?: FilmClipJson; meta?: FilmMeta; shots: FilmShotJson[] };
  cover?: string | null; coverAlt?: string | null;
  importance?: number;
};
/** A word as shown and said: when it's said, and whether it starts a paragraph. Hidden: said but not shown (the
 *  «۳ —» before a summary item, which its chapter's number shows). */
export type Word = { text: string; from: number; to: number; br: boolean; hidden: boolean };
/** silent: a headline that isn't read aloud, shown word by word without the mark that follows the voice. */
type Scene = { kind: 'title' | 'chapter'; head: string | null; words: Word[]; pics: ImageBitmap[]; from: number; to: number; silent: boolean };
type Clip = { at: number; pcm: Float32Array };
type Video = { card: Card; scenes: Scene[]; clips: Clip[]; outro: number; total: number; sound: AudioBuffer | null };

// ---------- what goes in ----------
async function picture(addresses: string[]): Promise<ImageBitmap | null> {
  for (const url of addresses) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(PIC_WAIT), referrerPolicy: 'no-referrer' });
      if (res.ok) return await trimmed(await createImageBitmap(await res.blob()));
    } catch {}
  }
  return null;
}

/** The picture without black bars above and below (YouTube's thumbnails are 4:3 with the 16:9 frame letterboxed). */
async function trimmed(img: ImageBitmap): Promise<ImageBitmap> {
  try {
    const w = 32;
    const h = Math.max(8, Math.round((img.height / img.width) * w));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const x = c.getContext('2d', { willReadFrequently: true })!;
    x.drawImage(img, 0, 0, w, h);
    const px = x.getImageData(0, 0, w, h).data;
    const dark = (row: number) => {
      let sum = 0;
      for (let i = 0; i < w; i++) sum += px[(row * w + i) * 4] + px[(row * w + i) * 4 + 1] + px[(row * w + i) * 4 + 2];
      return sum / (w * 3) < 14;
    };
    let top = 0;
    while (top < h / 3 && dark(top)) top++;
    let bottom = 0;
    while (bottom < h / 3 && dark(h - 1 - bottom)) bottom++;
    if (top < 2 || bottom < 2) return img;
    // A row of the small copy is several of the picture's: keep one more row each side inside the bars.
    const sy = Math.ceil(((top + 0.5) / h) * img.height);
    const sh = Math.floor(((h - bottom - 0.5) / h) * img.height) - sy;
    return sh > img.height / 3 ? await createImageBitmap(img, 0, sy, img.width, sh) : img;
  } catch {
    return img;
  }
}

/** Words at a reading pace, for a headline that isn't read aloud (it appears word by word) or a browser with no
 *  voice to keep. */
function paced(text: string, at: number, seconds?: number): Word[] {
  const ws = words(text);
  const units = ws.reduce((n, w, i) => n + weight(w) + (i < ws.length - 1 ? [0, 1.8, 3.2][pauseAfter(w)] : 0), 0);
  const per = seconds ? seconds / units : 0.11;
  return ws.map((w, i) => {
    const from = at;
    at += weight(w) * per;
    const word = { text: w, from, to: at, br: false, hidden: false };
    at += (i < ws.length - 1 ? [0, 1.8, 3.2][pauseAfter(w)] : 0) * per;
    return word;
  });
}

/** The scenes on a timeline, with the voice's clips placed on it and every word timed. */
async function build(card: Card, pics: Map<string, ImageBitmap | null>, engine: Recordable | null, step: (p: number) => void, lineOf: (i: number) => Line) {
  const lines = spokenLines(card).map((_, i) => lineOf(i).text);
  const plan = card.video;
  const bitmaps = (list: string[][]) => list.map((a) => pics.get(a[0])).filter((b): b is ImageBitmap => !!b);
  const digest = card.kind === 'digest';
  const specs = [
    { kind: 'title' as const, head: null, say: plan.title ? [0] : [], pics: digest ? plan.chapters.flatMap((c) => c.pics.slice(0, 1)).slice(0, 4) : (plan.chapters[0]?.pics.slice(0, 1) ?? []) },
    ...plan.chapters.map((c) => ({ kind: 'chapter' as const, ...c })),
  ];
  const decoder = new OfflineAudioContext(1, 1, RATE);
  const clips: Clip[] = [];
  const scenes: Scene[] = [];
  const todo = specs.reduce((n, s) => n + s.say.length, 0) || 1;
  let done = 0;
  let t = INTRO;
  for (const spec of specs) {
    const scene: Scene = { kind: spec.kind, head: spec.head, words: [], pics: bitmaps(spec.pics), from: t, to: t, silent: !spec.say.length };
    t += LEAD;
    if (!spec.say.length) {
      scene.words = paced(card.title, t, 1.6);
      t += TITLE_SILENT;
    }
    for (const i of spec.say) {
      const text = lines[i] ?? '';
      const first = scene.words.length;
      if (!engine) {
        const ws = paced(text, t);
        scene.words.push(...ws);
        t = (ws.at(-1)?.to ?? t) + GAP;
      } else {
        const said: Word[] = [];
        for (const piece of await lineAudio(lineOf(i), engine)) {
          const pcm = (await decoder.decodeAudioData(piece.data)).getChannelData(0);
          const ws = words(piece.texts.join(' '));
          align(pcm, RATE, ws).forEach((s, k) => said.push({ text: ws[k], from: t + s.from, to: t + s.to, br: false, hidden: false }));
          clips.push({ at: t, pcm });
          t += pcm.length / RATE;
        }
        scene.words.push(...shownWords(lineOf(i), said));
        t += GAP;
      }
      if (scene.words[first]) scene.words[first].br = first > 0;
      // A summary item starts «۳ —»: said, but its chapter's number shows it.
      if (digest && spec.kind === 'chapter' && first === 0) for (const w of scene.words.slice(0, 2)) if (/^([0-9۰-۹]+|[—–-])$/.test(w.text)) w.hidden = true;
      step(++done / todo);
    }
    scene.to = t;
    scenes.push(scene);
  }
  return { scenes, clips, outro: t, total: t + OUTRO };
}

/** The line's words as shown, timed from the words as said: a Latin name said in Persian letters («دی ممیز سه یلتر»)
 *  is shown as written («d1.3-ultra»), lit from its first spoken word to its last (server/_say.js `map`). */
function shownWords(l: Line, said: Word[]): Word[] {
  const shown = words(l.text);
  if (!l.map?.length || !said.length) return said.length === shown.length ? said : spread(shown, said);
  const say = l.say ?? l.text;
  // Each word as said → where it starts in the spoken line → the shown word at that place.
  const starts: number[] = [];
  let at = 0;
  shown.forEach((w) => {
    const i = l.text.indexOf(w, at);
    starts.push(i < 0 ? at : i);
    at = (i < 0 ? at : i) + w.length;
  });
  const out: (Word | null)[] = shown.map(() => null);
  let cur = 0;
  for (const w of said) {
    const i = say.indexOf(w.text, cur);
    if (i < 0) continue;
    cur = i + w.text.length;
    const pos = toShown(l.map, i);
    let k = starts.length - 1;
    while (k > 0 && starts[k] > pos) k--;
    const o = out[k];
    out[k] = o ? { ...o, to: Math.max(o.to, w.to) } : { text: shown[k], from: w.from, to: w.to, br: false, hidden: false };
  }
  // A shown word no spoken word landed on (rare): between its neighbours.
  return out.map((w, k) => w ?? { text: shown[k], from: out[k - 1]?.to ?? said[0].from, to: out[k - 1]?.to ?? said[0].from, br: false, hidden: false });
}
/** Shown words over the said ones' time, in proportion (when the two lists don't line up). */
function spread(shown: string[], said: Word[]): Word[] {
  const from = said[0]?.from ?? 0;
  const to = said.at(-1)?.to ?? from;
  const per = (to - from) / Math.max(1, shown.length);
  return shown.map((text, k) => ({ text, from: from + k * per, to: from + (k + 1) * per, br: false, hidden: false }));
}

// ---------- the short film (src/scripts/film.ts) ----------
/** The film's lines as a card the voices read: its first line the title, every other line in order the body, so
 *  /api/tts's `k=film&n=` and lineMaker number them alike. */
function filmCard(card: Card): Card {
  const all = card.film!.shots.flatMap((s) => s.say);
  return { ...card, title: all[0] ?? card.title, body: all.slice(1), why: null };
}
/** Each shot's first line's number among all the film's lines: kept when the reader leaves shots out. */
const numbered = (shots: FilmShotJson[]) => {
  let n = 0;
  return shots.map((s) => {
    const out = { ...s, line: n };
    n += s.say.length;
    return out;
  });
};
/** The film's shots on a timeline: each line said in turn (after its pause), every word timed from the voice. */
async function buildFilm(card: Card, pics: Map<string, ImageBitmap | null>, engine: Recordable | null, step: (p: number) => void, lineOf: (i: number) => Line, intro: number, outroFor: number) {
  const shots = card.film!.shots;
  const decoder = new OfflineAudioContext(1, 1, RATE);
  const clips: Clip[] = [];
  const scenes: FilmScene[] = [];
  const todo = shots.reduce((n, s) => n + s.say.length, 0) || 1;
  let line = 0;
  let done = 0;
  let t = intro;
  for (const shot of shots) {
    const scene: FilmScene = {
      shot: shot.shot,
      head: shot.head ?? null,
      words: [],
      pics: shot.pics.map((a) => pics.get(a[0])).filter((b): b is ImageBitmap => !!b),
      from: t,
      to: t,
      lineAt: [],
      data: shot.shot === 'points' ? { ...shot.data, items: shot.say } : shot.data,
      vid: !!shot.vid,
      clipAt: null,
    };
    if (shot.line != null) line = shot.line;
    t += shot.shot === 'hook' ? 0.3 : 0.6;
    for (let j = 0; j < shot.say.length; j++) {
      t += shot.pause?.[j] ?? 0;
      scene.lineAt.push(t);
      const first = scene.words.length;
      const l = lineOf(line++);
      if (!engine) {
        const ws = paced(l.text, t);
        scene.words.push(...ws);
        t = (ws.at(-1)?.to ?? t) + GAP;
      } else {
        const said: Word[] = [];
        for (const piece of await lineAudio(l, engine)) {
          const pcm = (await decoder.decodeAudioData(piece.data)).getChannelData(0);
          const ws = words(piece.texts.join(' '));
          align(pcm, RATE, ws).forEach((s, k) => said.push({ text: ws[k], from: t + s.from, to: t + s.to, br: false, hidden: false }));
          clips.push({ at: t, pcm });
          t += pcm.length / RATE;
        }
        scene.words.push(...shownWords(l, said));
        t += GAP;
      }
      if (scene.words[first]) scene.words[first].br = first > 0;
      step(++done / todo);
    }
    // A beat after each shot (longer after the quiz's answer and the anchor's lines): room to take it in.
    t += shot.shot === 'quiz' ? 1.6 : ['explain', 'term', 'why', 'numbers', 'context'].includes(shot.shot) ? 0.7 : 0.35;
    scene.to = t;
    scenes.push(scene);
  }
  return { scenes, clips, outro: t, total: t + outroFor };
}

// ---------- which lines, in which plan: the full story, or the short one (PLAN.md P1-C) ----------
export type Mode = 'short' | 'full' | 'film';
/** The lines a video says, as /api/tts reads them: the story's [title, ...body, why] (by index), or the 60-second
 *  script [hook, 3 points, why] (`?id=&k=clip&n=`), or an episode teaser's lines (`?vid=&i=`). */
function spokenLines(card: Card): string[] {
  return [card.title, ...card.body, card.why].filter((l): l is string => !!l);
}
function lineMaker(card: Card, src: (i: number) => string | undefined) {
  const list = spokenLines(card);
  return (i: number): Line => {
    const text = list[i] ?? '';
    const { say, map } = sayLine(text, card.lex, true);
    return { text, post: card.id, i, ...(say !== text && { say, map }), ...(src(i) && { src: src(i) }) };
  };
}
/** The short version of a story: the model's hook as the headline scene (from the first frame), its three points as
 *  chapters with the story's pictures shared out, and «چرا مهمه؟». The 24-hour summary's: its first five items. */
function shortCard(card: Card): { card: Card; src: (i: number) => string | undefined } | null {
  if (card.kind === 'digest') {
    // Its first five items (the lines keep their indices: /api/tts reads them by index).
    return { card: { ...card, video: { title: card.video.title, chapters: card.video.chapters.slice(0, 5) } }, src: () => undefined };
  }
  const c = card.clip;
  if (!c || c.points.length < 3) return null;
  const pics = card.video.chapters.flatMap((ch) => ch.pics);
  const share = (k: number) => (pics.length ? [pics[(k + 1) % pics.length]] : []);
  const plan: Plan = {
    title: true,
    chapters: [
      ...c.points.map((_, k) => ({ head: fmtNum(k + 1), say: [k + 1], pics: share(k) })),
      { head: card.whyLabel ?? 'چرا مهمه؟', say: [c.points.length + 1], pics: [] },
    ],
  };
  const short: Card = { ...card, title: c.hook, body: c.points, why: c.why, video: { ...plan, chapters: plan.chapters } };
  // The title scene's picture: the story's first.
  short.video.chapters[0] = { ...short.video.chapters[0], pics: pics.slice(0, 1).concat(share(0)).slice(0, 2) };
  return { card: short, src: (i) => `id=${card.id}&k=clip&n=${i}` };
}

// ---------- the sound: the voice, a chime at the start and the end, a soft whoosh between chapters ----------
function chime(out: Float32Array, at: number) {
  const notes = [
    [0, 659.25],
    [0.12, 830.61],
    [0.24, 987.77],
    [0.4, 1318.51],
  ];
  for (const [start, f] of notes) {
    const o = Math.round((at + start) * RATE);
    const len = Math.min(Math.round(1.4 * RATE), out.length - o);
    for (let i = 0; i < len; i++) {
      const s = i / RATE;
      const env = Math.min(1, s * 200) * Math.exp(-s * 3.2);
      out[o + i] += 0.07 * env * (Math.sin(2 * Math.PI * f * s) + 0.25 * Math.sin(4 * Math.PI * f * s) + 0.08 * Math.sin(6 * Math.PI * f * s));
    }
  }
}
function whoosh(out: Float32Array, at: number) {
  const o = Math.round(at * RATE);
  const len = Math.min(Math.round(0.45 * RATE), out.length - o);
  let lp = 0;
  for (let i = 0; i < len; i++) {
    const x = i / len;
    lp += (0.02 + 0.25 * (1 - x)) * (Math.random() * 2 - 1 - lp);
    out[o + i] += 0.08 * Math.sin(Math.PI * x) ** 2 * lp;
  }
}
function mix(v: Omit<Video, 'sound' | 'card'>, voiced: boolean): AudioBuffer | null {
  if (!voiced) return null;
  const sound = new AudioBuffer({ numberOfChannels: 1, sampleRate: RATE, length: Math.ceil(v.total * RATE) });
  const out = sound.getChannelData(0);
  for (const c of v.clips) out.set(c.pcm.subarray(0, out.length - Math.round(c.at * RATE)), Math.round(c.at * RATE));
  chime(out, 0.15);
  v.scenes.slice(1).forEach((s) => whoosh(out, s.from));
  chime(out, v.outro + 0.1);
  for (let i = 0; i < out.length; i++) out[i] = Math.max(-1, Math.min(1, out[i]));
  return sound;
}

// ---------- drawing ----------
export const ease = (x: number) => 1 - (1 - Math.min(1, Math.max(0, x))) ** 3;
export const back = (x: number) => {
  x = Math.min(1, Math.max(0, x));
  return 1 + 2.7 * (x - 1) ** 3 + 1.7 * (x - 1) ** 2;
};
export const day = (iso: string) => new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: SITE.timeZone, day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));
export const isLatin = (s: string) => /[A-Za-z]/.test(s) && !/[؀-ۿ]/.test(s);
export const trim = (s: string) => s.replace(/^[«"(\[]+|[»")\],.،؛:!?؟…]+$/g, '');

export function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}
/** Anything drawn as a picture: a fetched one, or a frame of the source's video (src/scripts/footage.ts). */
export type Img = ImageBitmap | HTMLCanvasElement | OffscreenCanvas;
export function cover(ctx: CanvasRenderingContext2D, img: Img, x: number, y: number, w: number, h: number, zoom: number, pan: number) {
  const s = Math.max(w / img.width, h / img.height) * zoom;
  const dw = img.width * s;
  const dh = img.height * s;
  ctx.drawImage(img, x + (w - dw) / 2 + pan * (dw - w) * 0.5, y + (h - dh) / 2, dw, dh);
}
export function logo(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, ring = 1, dot = 1) {
  const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  g.addColorStop(0, '#2f4fd8');
  g.addColorStop(1, '#6d4ff0');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = r * 0.2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.44, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ring);
  ctx.stroke();
  if (dot <= 0) return;
  ctx.fillStyle = YELLOW;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.17 * dot, 0, Math.PI * 2);
  ctx.fill();
}

/** Lines of words fitting `width`, each word placed (x from the column's left edge). Right to left, with runs of
 *  English words (and the numbers between them, «Gemini 4 Argon») kept left to right, as the browser would show them. */
export type Placed = { k: number; x: number; w: number; ltr: boolean };
export function layout(ctx: CanvasRenderingContext2D, ws: Word[], width: number): Placed[][] {
  const space = ctx.measureText(' ').width;
  const rows: number[][] = [];
  let row: number[] = [];
  let used = 0;
  ws.forEach((w, k) => {
    if (w.hidden) return;
    const len = ctx.measureText(w.text).width;
    if (row.length && (w.br || used + space + len > width)) {
      rows.push(row);
      row = [];
      used = 0;
    }
    used += (row.length ? space : 0) + len;
    row.push(k);
  });
  if (row.length) rows.push(row);
  return rows.map((r) => {
    const dir = r.map((k) => (isLatin(ws[k].text) ? 'l' : /^[0-9.,%+-]+$/.test(ws[k].text) ? '?' : 'r'));
    dir.forEach((d, i) => d === '?' && (dir[i] = dir[i - 1] === 'l' && dir.slice(i + 1).find((x) => x !== '?') === 'l' ? 'l' : 'r'));
    const out: Placed[] = [];
    let cursor = width;
    for (let i = 0; i < r.length; ) {
      let j = i;
      while (j + 1 < r.length && dir[j + 1] === dir[i]) j++;
      const run = r.slice(i, j + 1).map((k) => ({ k, w: ctx.measureText(ws[k].text).width }));
      const rw = run.reduce((s, x) => s + x.w, 0) + space * (run.length - 1);
      let x = dir[i] === 'l' ? cursor - rw : cursor;
      for (const it of run) {
        if (dir[i] === 'l') {
          out.push({ ...it, x, ltr: true });
          x += it.w + space;
        } else {
          x -= it.w;
          out.push({ ...it, x, ltr: false });
          x -= space;
        }
      }
      cursor -= rw + space;
      i = j + 1;
    }
    return out;
  });
}

/** What a scene shows besides its words: numbers as they're said, English names as tags. */
export function extras(ws: Word[]) {
  const callouts: { text: string; from: number; to: number }[] = [];
  ws.forEach((w, k) => {
    if (w.hidden || !/[0-9۰-۹]/.test(w.text)) return;
    // A version after a name («Mistral Large 4», «GPT 5») isn't a figure, nor is a name with a digit in it («d1.3-ultra»).
    if (isLatin(w.text) || (k > 0 && isLatin(ws[k - 1].text) && /^[0-9.]+$/.test(trim(w.text)))) return;
    const next = ws[k + 1];
    const unit = next && !pauseAfter(w.text) && !/[0-9۰-۹]/.test(next.text) && trim(next.text).length <= 14 ? ` ${trim(next.text)}` : '';
    callouts.push({ text: trim(w.text) + unit, from: w.from, to: w.from + 3.2 });
  });
  callouts.forEach((c, i) => callouts[i + 1] && (c.to = Math.min(c.to, callouts[i + 1].from)));
  const tags: { text: string; from: number }[] = [];
  for (let k = 0; k < ws.length; k++) {
    if (!isLatin(ws[k].text)) continue;
    let j = k;
    while (j + 1 < ws.length && j - k < 3 && !pauseAfter(ws[j].text) && (isLatin(ws[j + 1].text) || /^[0-9.]+$/.test(ws[j + 1].text))) j++;
    const text = trim(ws.slice(k, j + 1).map((w) => w.text).join(' '));
    if (text.length > 1 && !tags.some((t) => t.text.toLowerCase() === text.toLowerCase())) tags.push({ text, from: ws[k].from });
    k = j;
  }
  return { callouts, tags };
}

function painter(ctx: CanvasRenderingContext2D, v: Video) {
  const { card, scenes, outro, total } = v;
  const digest = card.kind === 'digest';
  const chapters = scenes.length - 1;
  const link = card.link ?? `${SITE.url.replace(/^https:\/\//, '')}/p/${card.id}`;
  const kicker = digest ? 'خلاصه‌ی ۲۴ ساعت' : card.tag || 'خبر';
  // Where it comes from, on the first scene and the closing card: «منبع: techcrunch.com · ۲۶ آبان».
  const credit = [card.source && `منبع: ${card.source}`, day(card.date)].filter(Boolean).join(' · ');
  const k = G.k;
  // A faint dot grid, drawn once.
  const grid = document.createElement('canvas');
  grid.width = W;
  grid.height = H;
  const gx = grid.getContext('2d')!;
  gx.fillStyle = 'rgb(255 255 255 / .05)';
  for (let x = 16; x < W; x += 32) for (let y = 16; y < H; y += 32) gx.fillRect(x, y, 2, 2);

  // Each scene laid out once.
  const laid = scenes.map((s, n) => {
    const title = s.kind === 'title';
    const pics = s.pics.length > 0 || !title;
    const width = pics ? COL.w : G.wide;
    // A long headline gets smaller until it fits; at the smallest it goes in pages like the text.
    let size = BODY.size;
    let rows: Placed[][] = [];
    const top = title ? 0 : s.head ? G.textTop.head : G.textTop.plain;
    // The text's room, from its first baseline to the last one's.
    const room = BODY.bottom - top;
    const ratio = BODY.lh / BODY.size;
    // A chapter's text takes the largest size (up to 1.7×) at which it fits on one page, so a short chapter fills its
    // room instead of leaving it empty; a long one keeps the body size and goes in pages.
    const sizes = title ? TITLE_SIZES : [1.7, 1.5, 1.32, 1.16, 1].map((f) => Math.round(BODY.size * f));
    for (size of sizes) {
      ctx.font = `${title ? 800 : 500} ${size}px ${FONT}`;
      rows = layout(ctx, s.words, width);
      if (title ? rows.length * Math.round(size * 1.6) <= TITLE_ROOM : (rows.length - 1) * Math.round(size * ratio) <= room) break;
    }
    const lh = title ? Math.round(size * 1.6) : Math.round(size * ratio);
    const per = title ? Math.floor(TITLE_ROOM / lh) : Math.max(1, Math.floor(room / lh) + 1);
    const pages = Array.from({ length: Math.ceil(rows.length / per) }, (_, p) => rows.slice(p * per, p * per + per));
    const pageOf = new Map<number, number>();
    pages.forEach((pg, p) => pg.flat().forEach((it) => pageOf.set(it.k, p)));
    // One page: its block sits a little above the middle of the room (closer to the heading than to the bottom).
    const shift = !title && pages.length === 1 ? Math.max(0, (room - (rows.length - 1) * lh) * 0.4) : 0;
    return { title, pics, width, size, lh, pages, pageOf, top, shift, n, ...extras(s.words) };
  });

  // The picture on screen, blurred and dark, fills the frame behind everything: made once per picture by drawing it
  // tiny and scaling it up twice (a blur every browser does fast; canvas `filter` isn't everywhere).
  const soft = new Map<ImageBitmap, HTMLCanvasElement>();
  function blurred(img: ImageBitmap) {
    let c = soft.get(img);
    if (c) return c;
    const step = (src: CanvasImageSource, sw: number, sh: number, w: number, h: number, crop: boolean) => {
      const out = document.createElement('canvas');
      out.width = w;
      out.height = h;
      const x = out.getContext('2d')!;
      x.imageSmoothingQuality = 'high';
      if (crop) {
        const s = Math.max(w / sw, h / sh);
        x.drawImage(src, (w - sw * s) / 2, (h - sh * s) / 2, sw * s, sh * s);
      } else x.drawImage(src, 0, 0, w, h);
      return out;
    };
    const tiny = step(img, img.width, img.height, Math.round(W / 40), Math.round(H / 40), true);
    c = step(step(tiny, tiny.width, tiny.height, Math.round(W / 6), Math.round(H / 6), false), 0, 0, W / 2, H / 2, false);
    soft.set(img, c);
    return c;
  }
  /** The picture on screen at `t` (the scene's, shared out over its length, as in the panel), the one before it, and how
   *  far the change between them is. */
  function shownPic(t: number): { img: ImageBitmap | null; prev: ImageBitmap | null; a: number; local: number } {
    let k = 0;
    while (k + 1 < scenes.length && scenes[k + 1].from <= t) k++;
    const s = scenes[k];
    const last = (n: number) => {
      for (let j = n; j >= 0; j--) if (scenes[j].pics.length) return scenes[j].pics[scenes[j].pics.length - 1];
      return null;
    };
    if (!s.pics.length) return { img: null, prev: last(k - 1), a: ease((t - s.from) / 0.6), local: 0 };
    const share = (s.to - s.from) / s.pics.length;
    const i = laid[k].title && digest ? 0 : Math.max(0, Math.min(s.pics.length - 1, Math.floor((t - s.from) / share)));
    const start = s.from + i * share;
    return { img: s.pics[i], prev: i ? s.pics[i - 1] : last(k - 1), a: k || i ? ease((t - start) / 0.6) : 1, local: (t - start) / Math.max(1, share) };
  }
  // The panel's shadow, drawn once: a blurred shadow every frame would cost more than the rest of the frame.
  const shadow = document.createElement('canvas');
  shadow.width = W;
  shadow.height = H;
  {
    const sx = shadow.getContext('2d')!;
    sx.shadowColor = 'rgb(0 0 0 / .55)';
    sx.shadowBlur = 60;
    sx.shadowOffsetY = 24;
    sx.fillStyle = '#000';
    rounded(sx, PANEL.x, PANEL.y, PANEL.w, PANEL.h, 26);
    sx.fill();
  }

  function background(t: number) {
    ctx.fillStyle = '#0a0f1f';
    ctx.fillRect(0, 0, W, H);
    const { img, prev, a } = shownPic(t);
    const backdrop = (b: ImageBitmap, alpha: number) => {
      // Still: a backdrop that moves changes every pixel of every frame, and the file would be several times larger.
      const z = 1.12;
      ctx.globalAlpha = alpha;
      ctx.drawImage(blurred(b), (W - W * z) / 2, (H - H * z) / 2, W * z, H * z);
      ctx.globalAlpha = 1;
    };
    if (prev && a < 1) backdrop(prev, 1);
    if (img) backdrop(img, prev ? a : 1);
    else if (prev) backdrop(prev, 1 - a);
    // Dark enough for white text on any picture; a little darker at the bottom, where the text is.
    const dim = ctx.createLinearGradient(0, 0, 0, H);
    dim.addColorStop(0, 'rgb(6 9 22 / .62)');
    dim.addColorStop(0.45, 'rgb(6 9 22 / .7)');
    dim.addColorStop(1, 'rgb(6 9 22 / .9)');
    ctx.fillStyle = dim;
    ctx.fillRect(0, 0, W, H);
    const glow = (x: number, y: number, r: number, c: string) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, c);
      g.addColorStop(1, 'rgb(10 15 31 / 0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    };
    glow(W * 0.22 + Math.sin(t * 0.13) * 120, H * 0.3 + Math.cos(t * 0.11) * 80, 560, 'rgb(47 79 216 / .34)');
    glow(W * 0.82 + Math.cos(t * 0.09) * 140, H * 0.78 + Math.sin(t * 0.12) * 90, 520, 'rgb(109 79 240 / .26)');
    ctx.drawImage(grid, 0, 0);
  }

  function chrome(t: number) {
    ctx.direction = 'rtl';
    ctx.textAlign = 'right';
    logo(ctx, W - M - 20 * k, G.top, 20 * k);
    ctx.fillStyle = '#fff';
    ctx.font = `800 ${26 * k}px ${FONT}`;
    ctx.fillText(SITE.name, W - M - 54 * k, G.top + 9 * k);
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgb(255 255 255 / .65)';
    ctx.font = `500 ${20 * k}px ${FONT}`;
    ctx.fillText(day(card.date), M, G.top + 8 * k);
    ctx.direction = 'ltr';
    ctx.fillStyle = 'rgb(255 255 255 / .5)';
    ctx.font = `500 ${17 * k}px ${FONT}`;
    ctx.fillText(link, M, H - 44 * k);
    // A reel's lower band: where it comes from, under the names said.
    if (REEL && card.source) {
      ctx.direction = 'rtl';
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgb(255 255 255 / .55)';
      ctx.font = `600 ${19 * k}px ${FONT}`;
      ctx.fillText(`منبع: ${card.source}`, W - M, H - 150, W - 2 * M);
    }
    // Progress by chapter, right to left: under everything, or along the top in a reel (as a story's).
    const py = REEL ? 54 : H - 30 * k;
    const span = outro - INTRO;
    let x = W - M;
    const full = W - 2 * M - 6 * (scenes.length - 1);
    scenes.forEach((s) => {
      const w = (full * (s.to - s.from)) / span;
      const p = Math.min(1, Math.max(0, (t - s.from) / (s.to - s.from)));
      ctx.fillStyle = 'rgb(255 255 255 / .18)';
      rounded(ctx, x - w, py, w, 5 * k, 2.5 * k);
      ctx.fill();
      if (p > 0) {
        ctx.fillStyle = YELLOW;
        rounded(ctx, x - w * p, py, w * p, 5 * k, 2.5 * k);
        ctx.fill();
      }
      x -= w + 6;
    });
  }

  /** The words: said ones white, the one being said on a yellow mark, the rest dim (a silent headline: each word fades
   *  in, no mark). */
  function text(s: Scene, l: (typeof laid)[number], t: number, top: number, alpha: number) {
    const { size, lh } = l;
    const ws = s.words;
    let cur = -1;
    for (let k = 0; k < ws.length; k++) if (ws[k].from <= t) cur = k;
    const page = cur >= 0 ? (l.pageOf.get(cur) ?? 0) : 0;
    const rows = l.pages[page] ?? [];
    const pageStart = ws[rows[0]?.[0]?.k ?? 0]?.from ?? 0;
    const fade = page ? ease((t - pageStart) / 0.3) : 1;
    const x0 = l.pics ? COL.right - l.width : (W - l.width) / 2;
    ctx.font = `${l.title ? 800 : 500} ${size}px ${FONT}`;
    ctx.textAlign = 'left';
    rows.forEach((row, r) => {
      const y = top + r * lh + (1 - fade) * 18;
      for (const it of row) {
        const w = ws[it.k];
        const x = x0 + it.x;
        const said = cur > it.k;
        const now = cur === it.k;
        ctx.globalAlpha = alpha * fade * (s.silent ? ease((t - w.from) / 0.25) : 1);
        // The word being said pops (a little larger, then settles) on its yellow mark; a silent headline's words rise in.
        const pop = now && !s.silent ? 1 + 0.09 * (1 - back((t - w.from) / 0.22)) + 0.06 * (1 - ease((t - w.from) / 0.22)) : 1;
        const rise = s.silent ? (1 - ease((t - w.from) / 0.3)) * size * 0.35 : 0;
        if (pop !== 1) {
          ctx.save();
          ctx.translate(x + it.w / 2, y - size * 0.3);
          ctx.scale(pop, pop);
          ctx.translate(-(x + it.w / 2), -(y - size * 0.3));
        }
        if (now && !s.silent) {
          ctx.globalAlpha = alpha * fade * ease((t - w.from) / 0.08);
          ctx.fillStyle = YELLOW;
          rounded(ctx, x - 9, y - size * 1.05, it.w + 18, size * 1.55, 12);
          ctx.fill();
          ctx.globalAlpha = alpha * fade;
        }
        // Said words white; the ones to come dim, brightening as they're reached.
        const ahead = 0.34 + 0.2 * ease(1 - (w.from - t) / 0.4);
        ctx.fillStyle = s.silent || said ? '#fff' : now ? INK : `rgb(255 255 255 / ${ahead.toFixed(3)})`;
        ctx.direction = it.ltr ? 'ltr' : 'rtl';
        ctx.fillText(w.text, x, y + rise);
        if (pop !== 1) ctx.restore();
      }
    });
    ctx.globalAlpha = alpha;
  }

  function panel(s: Scene, l: (typeof laid)[number], t: number) {
    const { x, y, w, h } = PANEL;
    ctx.drawImage(shadow, 0, 0);
    ctx.save();
    rounded(ctx, x, y, w, h, 26);
    ctx.clip();
    const pics = s.pics;
    if (l.title && digest && pics.length > 1) {
      // The summary's title: its items' pictures, two by two.
      const cw = (w - 6) / 2;
      const ch = (h - 6) / 2;
      for (let i = 0; i < 4; i++) {
        const cx = x + (i % 2 ? 0 : cw + 6);
        const cy = y + (i < 2 ? 0 : ch + 6);
        if (pics[i]) cover(ctx, pics[i], cx, cy, cw, ch, 1 + 0.05 * ((t - s.from) / (s.to - s.from)), 0);
        else brand(cx, cy, cw, ch, '');
      }
    } else if (pics.length) {
      const share = (s.to - s.from) / pics.length;
      const k = Math.max(0, Math.min(pics.length - 1, Math.floor((t - s.from) / share)));
      const ga = ctx.globalAlpha;
      const draw = (i: number, a: number) => {
        const local = Math.max(0, (t - s.from - i * share) / share);
        ctx.globalAlpha = ga * a;
        const img = pics[i];
        // A picture much wider or taller than the panel (a chart, a screenshot, a slide with text) is shown whole over
        // its own blur, rather than cropped mid-word; one close to the panel's shape fills it.
        const off = Math.abs(Math.log(img.width / img.height / (w / h)));
        if (off > 0.18) {
          ctx.drawImage(blurred(img), x - w * 0.1, y - h * 0.1, w * 1.2, h * 1.2);
          ctx.fillStyle = 'rgb(6 9 22 / .35)';
          ctx.fillRect(x, y, w, h);
          const z = 1 + 0.05 * local;
          const sc = Math.min(w / img.width, h / img.height) * z;
          ctx.drawImage(img, x + (w - img.width * sc) / 2, y + (h - img.height * sc) / 2, img.width * sc, img.height * sc);
        } else cover(ctx, img, x, y, w, h, 1 + 0.1 * local, (i % 2 ? 1 : -1) * 0.15 * local);
        ctx.globalAlpha = ga;
      };
      if (k > 0) draw(k - 1, 1);
      draw(k, k ? ease((t - s.from - k * share) / 0.6) : 1);
    } else brand(x, y, w, h, s.head ?? '');
    // Shade at the bottom for the number.
    const g = ctx.createLinearGradient(0, y + h - 150, 0, y + h);
    g.addColorStop(0, 'rgb(8 10 22 / 0)');
    g.addColorStop(1, 'rgb(8 10 22 / .7)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y + h - 150, w, 150);
    ctx.restore();
    ctx.strokeStyle = 'rgb(255 255 255 / .12)';
    ctx.lineWidth = 2;
    rounded(ctx, x, y, w, h, 26);
    ctx.stroke();

    // A number, large, while it's said.
    const c = l.callouts.find((c) => t >= c.from && t < c.to);
    if (c) {
      const a = Math.min(ease((t - c.from) / 0.15), ease((c.to - t) / 0.2));
      const sc = 0.85 + 0.15 * back((t - c.from) / 0.35);
      ctx.save();
      ctx.globalAlpha *= a;
      ctx.translate(x + w / 2, y + h - 64 * k);
      ctx.scale(sc * k, sc * k);
      ctx.font = `900 58px ${FONT}`;
      ctx.direction = 'rtl';
      ctx.textAlign = 'center';
      const tw = Math.min(w - 40, ctx.measureText(c.text).width + 56);
      ctx.fillStyle = 'rgb(10 14 30 / .82)';
      rounded(ctx, -tw / 2, -50, tw, 88, 22);
      ctx.fill();
      ctx.strokeStyle = YELLOW;
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.fillStyle = YELLOW;
      ctx.fillText(c.text, 0, 18, w - 72);
      ctx.restore();
    }

    // English names, as tags under the panel (the newest three).
    const shown = l.tags.filter((tg) => tg.from <= t).slice(-3);
    // In a reel they sit in the band under the text instead (the text has the space under the picture).
    const ty = REEL ? BODY.bottom + 60 - (y + h + 22 * k) : 0;
    ctx.font = `600 ${22 * k}px ${FONT}`;
    ctx.direction = 'ltr';
    ctx.textAlign = 'left';
    let cx = x + w;
    const ga = ctx.globalAlpha;
    for (const tg of shown.reverse()) {
      const tw = Math.min(ctx.measureText(tg.text).width + 32 * k, 300 * k);
      if (cx - tw < x) break;
      const a = ease((t - tg.from) / 0.25);
      ctx.globalAlpha = ga * a;
      ctx.fillStyle = 'rgb(255 255 255 / .08)';
      rounded(ctx, cx - tw, ty + y + h + 22 * k + (1 - a) * 10, tw, 44 * k, 22 * k);
      ctx.fill();
      ctx.strokeStyle = 'rgb(128 152 255 / .6)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = '#dfe5ff';
      ctx.fillText(tg.text, cx - tw + 16 * k, ty + y + h + 52 * k + (1 - a) * 10, tw - 32 * k);
      ctx.globalAlpha = ga;
      cx -= tw + 10 * k;
    }
  }

  /** A panel with no picture: the brand's colors and the chapter's mark. */
  function brand(x: number, y: number, w: number, h: number, mark: string) {
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, '#22348f');
    g.addColorStop(1, '#4a2f9e');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    if (!mark) return logo(ctx, x + w / 2, y + h / 2, Math.min(w, h) * 0.22);
    ctx.fillStyle = 'rgb(255 255 255 / .9)';
    ctx.font = `900 ${mark.length > 3 ? 64 : 150}px ${FONT}`;
    ctx.direction = 'rtl';
    ctx.textAlign = 'center';
    ctx.fillText(mark === 'چرا مهمه؟' ? '؟' : mark, x + w / 2, y + h / 2 + (mark.length > 3 ? 22 : 52));
  }

  function scene(s: Scene, t: number, alpha: number, shift: number) {
    const l = laid[scenes.indexOf(s)];
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(shift, 0);
    if (l.title) {
      if (l.pics) panel(s, l, t);
      // The kicker, then the headline, its block centered in the frame's height.
      const rows = l.pages[0]?.length ?? 1;
      // With no picture the headline has the whole frame: in its middle.
      const blockTop = (l.pics ? G.titleMid : H / 2) - (rows * l.lh + 60 * k) / 2;
      ctx.font = `700 ${24 * k}px ${FONT}`;
      ctx.direction = 'rtl';
      ctx.textAlign = 'right';
      const kw = ctx.measureText(kicker).width + 36 * k;
      const right = l.pics ? COL.right : (W + l.width) / 2;
      ctx.fillStyle = '#2f4fd8';
      rounded(ctx, right - kw, blockTop - 6 * k, kw, 44 * k, 22 * k);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(kicker, right - 18 * k, blockTop + 24 * k);
      // The source and the day beside the kicker: who says so, and when.
      ctx.fillStyle = 'rgb(255 255 255 / .7)';
      ctx.font = `500 ${20 * k}px ${FONT}`;
      ctx.fillText(credit, right - kw - 16 * k, blockTop + 23 * k, Math.max(80, l.width - kw - 20 * k));
      text(s, l, t, blockTop + 60 * k + l.size + 12, alpha);
    } else {
      panel(s, l, t);
      if (s.head) {
        ctx.direction = 'rtl';
        ctx.textAlign = 'right';
        if (digest) {
          // «۳» in a circle, «از ۱۲» beside it.
          const cy = G.headY + 26 * k;
          ctx.fillStyle = '#2f4fd8';
          ctx.beginPath();
          ctx.arc(COL.right - 34 * k, cy, 34 * k, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.font = `900 ${36 * k}px ${FONT}`;
          ctx.textAlign = 'center';
          ctx.fillText(s.head, COL.right - 34 * k, cy + 13 * k);
          ctx.textAlign = 'right';
          ctx.fillStyle = 'rgb(255 255 255 / .6)';
          ctx.font = `600 ${22 * k}px ${FONT}`;
          ctx.fillText(`از ${fmtNum(chapters)}`, COL.right - 82 * k, cy + 9 * k);
        } else {
          ctx.fillStyle = YELLOW;
          rounded(ctx, COL.right - 8 * k, G.headY, 8 * k, 44 * k, 4 * k);
          ctx.fill();
          ctx.font = `800 ${32 * k}px ${FONT}`;
          ctx.fillText(s.head, COL.right - 24 * k, G.headY + 34 * k);
        }
      }
      text(s, l, t, l.top + l.shift + l.size, alpha);
    }
    ctx.restore();
  }

  function intro(t: number, alpha: number) {
    ctx.save();
    ctx.globalAlpha = alpha;
    const zoom = 1 + 0.06 * ease((t - (INTRO - 0.5)) / 0.5);
    ctx.translate(W / 2, H / 2);
    ctx.scale(zoom * k, zoom * k);
    // From here, the landscape frame's coordinates around the middle (360 = its half height).
    ctx.translate(-W / 2, -360);
    const grow = back(t / 0.45);
    if (grow > 0) logo(ctx, W / 2, 290, 58 * grow, ease((t - 0.2) / 0.6), back((t - 0.75) / 0.35));
    ctx.textAlign = 'center';
    ctx.direction = 'rtl';
    const a1 = ease((t - 0.9) / 0.45);
    ctx.globalAlpha = alpha * a1;
    ctx.fillStyle = '#fff';
    ctx.font = `900 64px ${FONT}`;
    ctx.fillText(SITE.name, W / 2, 430 + (1 - a1) * 20);
    const a2 = ease((t - 1.25) / 0.45);
    ctx.globalAlpha = alpha * a2;
    ctx.fillStyle = 'rgb(255 255 255 / .75)';
    ctx.font = `500 28px ${FONT}`;
    ctx.fillText(`${kicker} · ${day(card.date)}`, W / 2, 488 + (1 - a2) * 16);
    ctx.restore();
  }

  function closing(t: number) {
    const a = ease((t - outro) / 0.5);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgb(9 12 26 / .96)';
    ctx.fillRect(0, 0, W, H);
    // The landscape frame's card, scaled to the shape around its middle.
    ctx.translate(W / 2, H / 2);
    ctx.scale(k, k);
    ctx.translate(-W / 2, -360);
    logo(ctx, W / 2, 230, 52, ease((t - outro - 0.1) / 0.6), back((t - outro - 0.5) / 0.35));
    ctx.textAlign = 'center';
    ctx.direction = 'rtl';
    ctx.fillStyle = '#fff';
    ctx.font = `900 56px ${FONT}`;
    ctx.fillText(SITE.name, W / 2, 352);
    ctx.fillStyle = 'rgb(255 255 255 / .75)';
    ctx.font = `500 28px ${FONT}`;
    ctx.fillText(card.link ? 'ویدیوی کامل در یوتیوب:' : digest ? 'همه‌ی خبرها با منبع:' : 'متن کامل و منبع این خبر:', W / 2, 428);
    ctx.direction = 'ltr';
    ctx.fillStyle = YELLOW;
    ctx.font = `700 32px ${FONT}`;
    ctx.fillText(link, W / 2, 482);
    ctx.fillStyle = 'rgb(255 255 255 / .6)';
    ctx.font = `500 24px ${FONT}`;
    ctx.fillText(`t.me/${SITE.channel}`, W / 2, 540);
    if (card.source) {
      ctx.direction = 'rtl';
      ctx.fillStyle = 'rgb(255 255 255 / .45)';
      ctx.font = `500 20px ${FONT}`;
      ctx.fillText(credit, W / 2, 590);
    }
    ctx.restore();
  }

  return (t: number) => {
    ctx.globalAlpha = 1;
    background(t);
    if (t < INTRO) {
      intro(t, 1 - ease((t - (INTRO - 0.4)) / 0.4));
      if (t > INTRO - 0.4) scene(scenes[0], t, ease((t - (INTRO - 0.4)) / 0.4), 0);
      return;
    }
    let k = 0;
    while (k + 1 < scenes.length && scenes[k + 1].from <= t) k++;
    const s = scenes[k];
    const into = (t - s.from) / 0.5;
    // Chapters slide in from the left (the way a right-to-left page turns), over the one before.
    if (k > 0 && into < 1) {
      scene(scenes[k - 1], t, 1 - ease(into), ease(into) * 60);
      scene(s, t, ease(into), -(1 - ease(into)) * 60);
    } else scene(s, t, 1, 0);
    chrome(t);
    if (t >= outro) closing(t);
  };
}

// ---------- making the file ----------
/** Sharp enough for a reel at 1080p (moving pictures, small type), small enough to send over a slow connection: the
 *  frames are mostly still, so the encoder rarely needs all of it. */
const BITRATE = (seconds: number) =>
  // A long video (the whole 24-hour summary) gets less a second, to stay near 25 MB: still sharp, the frames barely move.
  // A whole number: WebCodecs refuses a fractional bitrate (25 MB / 97.3 s), and the video failed to start.
  Math.round(Math.max(650_000, Math.min(W * H > 1.5e6 ? 2_200_000 : W * H > 1e6 ? 1_900_000 : 1_400_000, (25e6 * 8) / (seconds || 1))));
/** With the browser's encoders, frame by frame, faster than real time. Null when they can't make this video. */
async function encode(v: Video, canvas: HTMLCanvasElement, draw: (t: number) => void, step: (p: number) => void, stop: AbortSignal, before?: (t: number) => Promise<void>): Promise<Blob | null> {
  if (typeof VideoEncoder !== 'function') return null;
  if (!(await canEncodeVideo('avc', { width: W, height: H }))) return null;
  const codec = v.sound ? await getFirstEncodableAudioCodec(['aac', 'opus'], { numberOfChannels: 1, sampleRate: RATE }) : null;
  if (v.sound && !codec) return null;
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const video = new CanvasSource(canvas, { codec: 'avc', bitrate: BITRATE(v.total), keyFrameInterval: 2 });
  output.addVideoTrack(video, { frameRate: FPS });
  const audio = codec ? new AudioBufferSource({ codec, bitrate: 128_000 }) : null;
  if (audio) output.addAudioTrack(audio);
  await output.start();
  const frames = Math.ceil(v.total * FPS);
  const sound = audio && v.sound ? audio.add(v.sound).then(() => audio.close()) : null;
  for (let f = 0; f < frames; f++) {
    if (stop.aborted) {
      await output.cancel();
      throw new DOMException('cancelled', 'AbortError');
    }
    if (before) await before(f / FPS);
    draw(f / FPS);
    await video.add(f / FPS, 1 / FPS);
    if (f % 10 === 0) step(f / frames);
  }
  video.close();
  await sound;
  await output.finalize();
  return new Blob([output.target.buffer!], { type: 'video/mp4' });
}

/** Recording the canvas as it plays, with the sound playing into the recording: as long as the video takes. */
async function record(v: Video, canvas: HTMLCanvasElement, draw: (t: number) => void, step: (p: number) => void, stop: AbortSignal, ac: AudioContext | null, before?: (t: number) => Promise<void>): Promise<Blob> {
  const type = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
  draw(0);
  const stream = canvas.captureStream(FPS);
  let src: AudioBufferSourceNode | null = null;
  if (v.sound && ac) {
    await ac.resume().catch(() => {});
    const dest = ac.createMediaStreamDestination();
    src = ac.createBufferSource();
    src.buffer = v.sound;
    src.connect(dest);
    stream.addTrack(dest.stream.getAudioTracks()[0]);
  }
  const rec = new MediaRecorder(stream, { mimeType: type || undefined, videoBitsPerSecond: BITRATE(v.total) });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise<void>((r) => (rec.onstop = () => r()));
  rec.start(1000);
  src?.start();
  const t0 = performance.now();
  await new Promise<void>((resolve) => {
    const frame = () => {
      const t = (performance.now() - t0) / 1000;
      if (stop.aborted || t >= v.total) return resolve();
      // Real time: the newest footage frame ready, never waited for.
      void before?.(t);
      draw(t);
      step(t / v.total);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  src?.stop();
  rec.stop();
  await done;
  stream.getTracks().forEach((t) => t.stop());
  if (stop.aborted) throw new DOMException('cancelled', 'AbortError');
  return new Blob(chunks, { type: rec.mimeType || type || 'video/webm' });
}

// ---------- the sheet (src/components/VideoSheet.astro) ----------
// While a video is made the sheet shows it: a silent preview of the video itself (the text paced, no voice yet), then
// the real frames as they're encoded, with the four steps, a ring and the time left. The reader needn't wait:
// «ادامه در پس‌زمینه», ✕, Escape or a tap beside the sheet put it in a small floating frame (`[data-vs-pill]`) and they
// go on reading or listening; it says when the video is ready, and a tap brings the sheet back. Only «لغو» stops it.
const d = $<HTMLDialogElement>('#video-sheet')!;
const pill = $<HTMLButtonElement>('[data-vs-pill]')!;
const mini = $<HTMLCanvasElement>('[data-vs-mini]')!;
const stage = $('[data-vs-stage]', d)!;
let run: AbortController | null = null;
let url = '';
/** The last video made, shown again when «ویدیو» is tapped for the same story with the same voice. */
let made: { key: string; show: () => void } | null = null;
/** What's being made now (its story's address), and the canvas on show — the preview's, then the encoder's. */
let making: string | null = null;
let showing: HTMLCanvasElement | null = null;
let previewing = 0;
const busy = () => d.hasAttribute('data-busy');
const close = () => d.close();
$('[data-close]', d)!.addEventListener('click', close);
$('[data-vs-cancel]', d)!.addEventListener('click', () => {
  if (busy()) {
    run?.abort();
    d.removeAttribute('data-busy');
    making = null;
  }
  close();
});
$('[data-vs-bg]', d)!.addEventListener('click', close);
// Closing while it's made keeps it going, in the floating frame.
d.addEventListener('close', () => {
  if (d.open) return;
  $<HTMLVideoElement>('[data-vs-video]', d)!.pause();
  if (busy()) {
    pillState('making');
    toast('ویدیو در پس‌زمینه ساخته می‌شود؛ هر وقت آماده شد خبر می‌دهیم');
  }
});
pill.addEventListener('click', () => {
  pill.hidden = true;
  if (!d.open) d.showModal();
  const ready = !$('[data-vs-done]', d)!.hidden;
  if (ready) $<HTMLVideoElement>('[data-vs-video]', d)!.play().catch(() => {});
  if (!busy()) pill.dataset.state = 'off';
});
function pillState(state: 'making' | 'ready' | 'failed' | 'off') {
  pill.hidden = state === 'off' || d.open;
  pill.dataset.state = state;
  if (state === 'ready') $('[data-vs-pill-title]', pill)!.textContent = 'ویدیو آماده است';
  if (state === 'failed') $('[data-vs-pill-title]', pill)!.textContent = 'ساخت ویدیو ممکن نشد';
  if (state === 'making') $('[data-vs-pill-title]', pill)!.textContent = 'ساخت ویدیو';
  if (state !== 'making') $('[data-vs-pill-sub]', pill)!.textContent = state === 'ready' ? 'برای دیدن بزنید' : 'دوباره امتحان کنید';
}
/** The frame on show, cropped square into the floating frame. */
function miniFrame() {
  if (!showing || pill.hidden) return;
  const x = mini.getContext('2d')!;
  const s = Math.min(showing.width, showing.height);
  x.drawImage(showing, (showing.width - s) / 2, (showing.height - s) / 2, s, s, 0, 0, mini.width, mini.height);
}
function show(canvas: HTMLCanvasElement, phase: 'preview' | 'frames') {
  stage.querySelector('canvas')?.remove();
  canvas.className = 'vs-live';
  stage.append(canvas);
  stage.dataset.phase = phase;
  $('[data-vs-chip]', stage)!.textContent = phase === 'preview' ? 'پیش‌نمایش' : 'در حال ساخت';
  showing = canvas;
}
/** The video, silent and paced, playing in a loop at half size while the voice is made. */
function preview(v: Pick<Video, 'total'>, stop: AbortSignal, make: (ctx: CanvasRenderingContext2D) => (t: number) => void = (ctx) => painter(ctx, v as Video), before?: (t: number) => Promise<void>) {
  const canvas = document.createElement('canvas');
  canvas.width = W / 2;
  canvas.height = H / 2;
  const ctx = canvas.getContext('2d', { alpha: false })!;
  ctx.setTransform(0.5, 0, 0, 0.5, 0, 0);
  const draw = make(ctx);
  show(canvas, 'preview');
  const id = ++previewing;
  const t0 = performance.now();
  let last = 0;
  const frame = (now: number) => {
    if (stop.aborted || id !== previewing) return;
    // ~24 frames a second is plenty for a preview, and leaves the device to the voice.
    if (now - last > 40) {
      last = now;
      if (!document.hidden && (d.open || !pill.hidden)) {
        const t = ((now - t0) / 1000) % v.total;
        void before?.(t);
        draw(t);
      }
    }
    requestAnimationFrame(frame);
  };
  draw(Math.min(v.total, INTRO + 1.2));
  requestAnimationFrame(frame);
}

// Made videos are kept on the device (Cache Storage, public/sw.js keeps it), by story, shape, length and voice: sharing
// the same one again is instant. The newest few only: a video is a few megabytes.
const KEPT = 'video-v1';
const KEEP = 6;
const keptUrl = (key: string) => `${location.origin}${BASE}/__video/${encodeURIComponent(key)}`;
async function kept(key: string): Promise<Blob | null> {
  try {
    const hit = await (await caches.open(KEPT)).match(keptUrl(key));
    return hit ? await hit.blob() : null;
  } catch {
    return null;
  }
}
async function keep(key: string, blob: Blob, seconds: number) {
  try {
    const c = await caches.open(KEPT);
    await c.put(keptUrl(key), new Response(blob, { headers: { 'Content-Type': blob.type, 'X-Seconds': String(seconds) } }));
    const keys = await c.keys();
    for (const k of keys.slice(0, Math.max(0, keys.length - KEEP))) await c.delete(k);
  } catch {}
}
/** What the reader picks before a video is made (the sheet's setup): its shape and kind; for a film, the parts left out
 *  (`off`, so a part a story has for the first time is in) and what's drawn besides. Remembered only from the setup:
 *  a button that asks for a shape or kind of its own (the /videos/ teasers, the brief's «۶۰ ثانیه») never changes it. */
type Choice = { shape?: Shape; mode?: Mode; off?: string[]; look?: Partial<Omit<FilmOpts, 'host'>> };
type Picked = { shape: Shape; mode: Mode; off: string[]; look: Omit<FilmOpts, 'host'> };
const LOOK: Omit<FilmOpts, 'host'> = { anchor: true, music: true, subs: true, ticker: true };
/** The reader's last choices; vertical on a phone, landscape on a computer, the film when the story has one. */
const choice = (o?: Choice): Picked => {
  const pref = store.get<Choice>('video-pref', {});
  return {
    shape: o?.shape ?? pref.shape ?? (matchMedia('(pointer: coarse)').matches ? 'v' : 'h'),
    mode: o?.mode ?? pref.mode ?? 'film',
    off: o?.off ?? pref.off ?? [],
    look: { ...LOOK, ...pref.look, ...o?.look },
  };
};
/** A film made with every part and the whole look: the one that may be published for everyone. */
const standard = (c: Picked) => !c.off.length && Object.values(c.look).every(Boolean);
type Step = 'pics' | 'voice' | 'frames' | 'ready';
const STEPS: Step[] = ['pics', 'voice', 'frames', 'ready'];
const cards = new Map<string, Promise<Card>>();
const cardOf = (href: string) => {
  let c = cards.get(href);
  if (!c) {
    c = fetch(`${href}card.json`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))));
    c.catch(() => cards.delete(href));
    cards.set(href, c);
  }
  return c;
};

/** The sheet's three views: the setup, the making, the video made. */
function view(name: 'setup' | 'making' | 'done') {
  $('[data-vs-setup]', d)!.hidden = name !== 'setup';
  $('[data-vs-making]', d)!.hidden = name !== 'making';
  $('[data-vs-done]', d)!.hidden = name !== 'done';
  $('[data-vs-go]', d)!.hidden = name !== 'setup';
  d.dataset.view = name;
}

// ---------- the setup: what kind of video, which parts, what's drawn ----------
const SHAPE_USE: Record<Shape, string> = { v: 'استوری، ریلز، شورتس', h: 'یوتیوب، تلگرام، سایت', s: 'پست اینستاگرام' };
/** Opens the sheet on its setup for the story at `href` (no sound starts here: «ساختن» is the tap that makes it). A
 *  film someone already published, in the reader's shape, opens to watch at once. */
export async function setupVideo(href: string, opts?: Choice, watchPublished = true) {
  if (busy() && making) {
    pill.hidden = true;
    if (!d.open) d.showModal();
    return;
  }
  const sel = choice(opts);
  view('setup');
  $('[data-vs-title-text]', d)!.textContent = 'ساخت ویدیوی خبر';
  pill.hidden = true;
  if (!d.open) d.showModal();
  const setup = $('[data-vs-setup]', d)!;
  setup.dataset.state = 'loading';
  let card: Card;
  try {
    card = await cardOf(href);
  } catch {
    toast('اتصال اینترنت را بررسی کنید');
    return d.close();
  }
  const F = await import('./film');
  if (watchPublished && card.film?.shots.length && sel.mode === 'film') {
    const pub = await publicFilm(card.id, sel.shape);
    if (pub) {
      made = { key: `${href} pub ${sel.shape}`, show: done.bind(null, card, pub, 0, false, href, sel, true, null) };
      return made.show();
    }
  }
  setup.dataset.state = '';
  // The story, as the film will open on it.
  const pic = $('[data-vs-hero-pic]', setup)!;
  pic.style.backgroundImage = card.cover ? `url("${card.cover}")` : '';
  pic.classList.toggle('has-clip', !!card.film?.clip);
  $('[data-vs-hero-kicker]', setup)!.textContent = [card.film?.meta?.type ?? card.tag, card.source].filter(Boolean).join(' · ');
  $('[data-vs-hero-title]', setup)!.textContent = card.short ?? card.title;
  const has = (m: Mode) => (m === 'film' ? !!card.film?.shots.length : m === 'short' ? !!card.clip || card.kind === 'digest' : true);
  if (!has(sel.mode)) sel.mode = has('film') ? 'film' : 'full';
  // Shapes and kinds.
  const pickShape = (shape: Shape) => {
    sel.shape = shape;
    for (const b of setup.querySelectorAll<HTMLButtonElement>('[data-vs-pick-shape]')) b.setAttribute('aria-checked', String(b.dataset.vsPickShape === shape));
    refresh();
  };
  for (const b of setup.querySelectorAll<HTMLButtonElement>('[data-vs-pick-shape]')) {
    $('small', b)!.textContent = SHAPE_USE[b.dataset.vsPickShape as Shape];
    b.onclick = () => pickShape(b.dataset.vsPickShape as Shape);
  }
  for (const b of setup.querySelectorAll<HTMLButtonElement>('[data-vs-pick-mode]')) {
    b.hidden = !has(b.dataset.vsPickMode as Mode);
    b.onclick = () => {
      sel.mode = b.dataset.vsPickMode as Mode;
      refresh();
    };
  }
  // A film's parts: only those this story has (the lead and the hook are always in).
  const shots = card.film?.shots ?? [];
  const present = F.FILM_PARTS.filter((p) => (p.key === 'footage' ? !!card.film?.clip : shots.some((s, i) => i > 1 && p.shots.includes(s.shot)) || (p.key === 'source' && shots[1]?.shot === 'source')));
  const parts = $('[data-vs-parts]', setup)!;
  parts.innerHTML = '';
  for (const p of present) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'vs-chip-btn';
    b.textContent = p.label;
    b.dataset.part = p.key;
    b.onclick = () => {
      sel.off = sel.off.includes(p.key) ? sel.off.filter((x) => x !== p.key) : [...sel.off, p.key];
      refresh();
    };
    parts.append(b);
  }
  for (const b of setup.querySelectorAll<HTMLButtonElement>('[data-vs-opt]')) {
    b.onclick = () => {
      const k = b.dataset.vsOpt as keyof typeof LOOK;
      sel.look = { ...sel.look, [k]: !sel.look[k] };
      refresh();
    };
  }
  // Who narrates, and so who presents.
  await persianVoice();
  const engine = recordableVoice();
  const voiceName = () => {
    if (engine === 'local') return activeVoice()?.name ?? 'صدای دانلودشده';
    if (engine === 'cloud') return 'صدای ابری';
    if (engine === 'remote') return 'سرویس صدای شما';
    return null;
  };
  const host = voiceHost(engine);
  $('[data-vs-voice-change]', setup)!.onclick = () => {
    d.close();
    openVoice(() => setupVideo(href, sel, false));
  };
  function refresh() {
    for (const b of setup.querySelectorAll<HTMLButtonElement>('[data-vs-pick-shape]')) b.setAttribute('aria-checked', String(b.dataset.vsPickShape === sel.shape));
    for (const b of setup.querySelectorAll<HTMLButtonElement>('[data-vs-pick-mode]')) b.setAttribute('aria-checked', String(b.dataset.vsPickMode === sel.mode));
    const film = sel.mode === 'film';
    $('[data-vs-parts-box]', setup)!.hidden = !film || !present.length;
    $('[data-vs-look-box]', setup)!.hidden = !film;
    for (const b of parts.querySelectorAll<HTMLButtonElement>('[data-part]')) b.setAttribute('aria-pressed', String(!sel.off.includes(b.dataset.part!)));
    for (const b of setup.querySelectorAll<HTMLButtonElement>('[data-vs-opt]')) {
      b.setAttribute('aria-pressed', String(sel.look[b.dataset.vsOpt as keyof typeof LOOK]));
      // A reel has no ticker (its bottom is the app's buttons).
      b.hidden = b.dataset.vsOpt === 'ticker' && (sel.shape === 'v' || !card.film?.meta?.ticker.length);
    }
    $('[data-vs-hero]', setup)!.dataset.shape = sel.shape;
    // About how long: the lines it will say, at the voices' pace (~14 characters a second), plus its opening/closing.
    const said = film ? F.pickShots(shots, new Set(present.map((p) => p.key).filter((k) => !sel.off.includes(k)))).flatMap((s) => s.say).join(' ').length : sel.mode === 'short' && card.clip ? [card.clip.hook, ...card.clip.points, card.clip.why].join(' ').length : [card.title, ...card.body, card.why ?? ''].join(' ').length;
    const secs = Math.round(said / 14 + (film ? 9 : 6));
    const length = secs < 60 ? `حدود ${fmtNum(secs)} ثانیه` : `حدود ${fmtNum(Math.round(secs / 60))} دقیقه`;
    const who = voiceName();
    $('[data-vs-hero-meta]', setup)!.textContent = `${length} · ${SHAPE_FA[sel.shape]}`;
    $('[data-vs-voice-name]', setup)!.textContent = who
      ? `روایت: ${who}${film && sel.look.anchor ? ` · مجری: ${host === 'p' ? 'پریسا' : 'داش غلام'} (هم‌صدا با راوی)` : ''}`
      : 'صدای فارسی‌ای که در فایل بماند روی این دستگاه نیست: ویدیو بی‌صدا ساخته می‌شود، یا یکی دانلود کنید.';
    $('[data-vs-go-text]', d)!.textContent = film ? 'ساختن فیلم' : 'ساختن ویدیو';
  }
  refresh();
  $<HTMLButtonElement>('[data-vs-go]', d)!.onclick = () => {
    // Remembered from here only; the sound may start in this tap (iOS).
    store.set('video-pref', { shape: sel.shape, mode: sel.mode, off: sel.off, look: sel.look });
    void makeVideo(href, tapAudio(), false, { ...sel });
  };
}

/** Makes the video of the story at `href` (its page's address) and offers it to share or save. `ac`: an audio
 *  context started in the tap, for recording the sound where the encoders can't (iOS only lets audio start there).
 *  `asked`: the voice sheet was already offered, so a reader who chose no downloadable voice gets a silent video.
 *  Without a kind asked for (`opts.mode`), the sheet opens on its setup first. */
export async function makeVideo(href: string, ac: AudioContext | null = null, asked = false, opts?: Choice) {
  // One at a time: a tap on «ویدیو» while another is made in the background shows that one.
  if (busy() && making) {
    pill.hidden = true;
    if (!d.open) d.showModal();
    if (making !== href) toast('یک ویدیو در حال ساخت است؛ اول آن آماده شود یا «لغو» را بزنید');
    ac?.close().catch(() => {});
    return;
  }
  if (!opts?.mode) {
    ac?.close().catch(() => {});
    return setupVideo(href, opts);
  }
  run?.abort();
  const mine = (run = new AbortController());
  const stop = mine.signal;
  making = href;
  const status = $('[data-vs-status]', d)!;
  const bar = $('[data-vs-bar]', d)!;
  const ring = $<SVGCircleElement>('[data-vs-ring]', d)!;
  const pct = $('[data-vs-pct]', d)!;
  const eta = $('[data-vs-eta]', d)!;
  const note = $('[data-vs-note]', d)!;
  const shareBtn = $('[data-vs-share]', d)!;
  const save = $<HTMLAnchorElement>('[data-vs-save]', d)!;
  const cancel = $('[data-vs-cancel]', d)!;
  const bgBtn = $('[data-vs-bg]', d)!;
  const miniRing = $<SVGCircleElement>('[data-vs-mini-ring]', pill)!;
  // Time left in the step that takes long (the voice, the frames): from how fast it has gone so far.
  let phaseAt = performance.now();
  let lastMini = 0;
  const step = (name: Step) => {
    phaseAt = performance.now();
    eta.textContent = '';
    const at = STEPS.indexOf(name);
    for (const li of d.querySelectorAll<HTMLElement>('[data-vs-step]')) {
      const k = STEPS.indexOf(li.dataset.vsStep as Step);
      li.dataset.state = k < at || name === 'ready' ? 'done' : k === at ? 'now' : '';
    }
  };
  const say = (msg: string, p: number, part?: number) => {
    status.textContent = msg;
    bar.style.width = `${Math.round(p * 100)}%`;
    ring.style.strokeDashoffset = miniRing.style.strokeDashoffset = String(100 - p * 100);
    pct.textContent = `${fmtNum(Math.round(p * 100))}٪`;
    $('[data-vs-pill-sub]', pill)!.textContent = `${fmtNum(Math.round(p * 100))}٪`;
    const spent = (performance.now() - phaseAt) / 1000;
    if (part && part > 0.06 && spent > 2) {
      const left = Math.max(1, Math.round((spent * (1 - part)) / part));
      eta.textContent = left < 60 ? `حدود ${fmtNum(left)} ثانیه مانده` : `حدود ${fmtNum(Math.round(left / 60))} دقیقه مانده`;
    }
    const now = performance.now();
    if (now - lastMini > 300) {
      lastMini = now;
      miniFrame();
    }
  };
  view('making');
  $('[data-vs-title-text]', d)!.textContent = 'ساخت ویدیوی خبر';
  shareBtn.hidden = save.hidden = true;
  bgBtn.hidden = false;
  cancel.textContent = 'لغو';
  note.textContent = '';
  stage.querySelector('canvas')?.remove();
  showing = null;
  stage.dataset.phase = 'prep';
  $('[data-vs-skel]', stage)!.textContent = '';
  step('pics');
  say('آماده کردن خبر…', 0);
  d.toggleAttribute('data-busy', true);
  pill.hidden = true;
  if (!d.open) d.showModal();
  let handedOn = false; // `ac` goes on to the next try, after the voice sheet
  try {
    await persianVoice();
    const engine = recordableVoice();
    // The video's voice has to be one the page can keep: offer the download, as «گوش دادن» does, and come back.
    if (!engine && voiceSupported() && !asked) {
      handedOn = true;
      d.removeAttribute('data-busy');
      making = null;
      d.close();
      toast('برای روایت ویدیو یک صدای فارسی لازم است');
      return void openVoice(() => makeVideo(href, ac, true, opts));
    }
    const want = choice(opts);
    stage.dataset.shape = want.shape;
    const full = await cardOf(href);
    const filmed = want.mode === 'film' && !!full.film?.shots.length;
    const short = !filmed && want.mode === 'short' ? shortCard(full) : null;
    const mode: Mode = filmed ? 'film' : short ? 'short' : 'full';
    const look: FilmOpts = { host: voiceHost(engine), ...want.look };
    const key = `${href} ${want.shape} ${mode} ${engine} ${chosenVoice()}${mode === 'film' ? ` ${[...want.off].sort().join(',')} ${Object.entries(look).map(([k, v]) => (v === true ? k : v === false ? '' : v)).join('')}` : ''}`;
    if (made?.key === key) return made.show();
    const hit = await kept(key);
    if (hit) {
      made = { key, show: done.bind(null, full, hit, 0, !engine, href, { ...want, mode }, true, null) };
      return made.show();
    }
    let made1: { blob: Blob; total: number; silent: boolean; card: Card; cover: Blob | null };
    if (mode === 'film') {
      const F = await import('./film');
      const all = numbered(full.film!.shots);
      const parts = new Set(F.FILM_PARTS.map((p) => p.key).filter((k) => !want.off.includes(k)));
      const picked = F.pickShots(all, parts);
      const fc = filmCard(full);
      $('[data-vs-skel]', stage)!.textContent = full.title;
      useShape(want.shape);
      await Promise.all([800, 600, 900].map((w) => document.fonts.load(`${w} 40px ${FONT}`))).catch(() => {});
      say('آوردن تصویرها…', 0.03);
      const wanted = new Map(picked.flatMap((c) => c.pics).map((a) => [a[0], a]));
      const avatarAt = full.film!.src?.avatar ?? null;
      const clip = parts.has('footage') && picked.some((s) => s.vid) ? full.film!.clip : undefined;
      let got = 0;
      const [list, avatar, footage] = await Promise.all([
        Promise.all([...wanted.values()].map((a) => picture(a).then((b) => (say('آوردن تصویرها…', 0.03 + (0.05 * ++got) / Math.max(1, wanted.size), got / Math.max(1, wanted.size)), b)))),
        avatarAt ? picture(avatarAt) : Promise.resolve(null),
        clip ? import('./footage').then((m) => m.loadFootage(clip.url, Math.min(1280, Math.max(W, H)), stop)).catch(() => null) : Promise.resolve(null),
      ]);
      if (clip && !footage) note.textContent = 'ویدیوی خود خبر در دسترس نبود؛ فیلم با تصویرهای خبر ساخته می‌شود.';
      const pics = new Map([...wanted.keys()].map((k, i) => [k, list[i]]));
      if (stop.aborted) return;
      const lines = lineMaker(fc, (i) => `id=${full.id}&k=film&n=${i}`);
      const shell = (b: Awaited<ReturnType<typeof buildFilm>>): FilmVideo => {
        const v: FilmVideo = { ...b, nat: [], src: full.film!.src ?? null, avatar, id: full.id, date: full.date, title: full.short ?? full.title, meta: full.film!.meta ?? null, footage, opts: look };
        placeClip(v, footage);
        return v;
      };
      const before = (v: FilmVideo) => (footage ? async (t: number) => {
        const ct = F.clipTimeAt(v, t);
        if (ct != null) await footage.seek(ct);
      } : undefined);
      const draft = shell(await buildFilm({ ...fc, film: { ...full.film!, shots: picked } }, pics, null, () => {}, lines, F.FILM_INTRO, F.FILM_OUTRO));
      preview(draft, stop, (ctx) => F.filmPainter(ctx, W, H, draft), before(draft));
      step('voice');
      say(engine ? 'ساختن روایت…' : 'آماده کردن متن…', 0.08);
      const film = shell(await buildFilm({ ...fc, film: { ...full.film!, shots: picked } }, pics, engine, (p) => say('ساختن روایت با صدای فارسی…', 0.08 + p * 0.37, p), lines, F.FILM_INTRO, F.FILM_OUTRO));
      if (stop.aborted) return;
      // The clip's own sound, under the shots it plays in.
      if (footage) for (const s of film.scenes) if (s.clipAt != null) {
        const pcm = await footage.sound(s.clipAt, Math.min(footage.duration, s.clipAt + (s.to - s.from)), RATE);
        if (pcm) film.nat.push({ at: s.from, pcm });
      }
      const sound = engine ? F.filmSound(film, RATE) : null;
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const draw = F.filmPainter(canvas.getContext('2d', { alpha: false })!, W, H, film);
      previewing++;
      show(canvas, 'frames');
      step('frames');
      const frames = (p: number) => say('ساختن فیلم، فریم به فریم…', 0.45 + p * 0.55, p);
      const v = { total: film.total, sound } as Video;
      let blob = await encode(v, canvas, draw, frames, stop, before(film));
      if (!blob) {
        note.textContent = `این کار ${fmtNum(Math.ceil(film.total))} ثانیه طول می‌کشد؛ این صفحه را باز نگه دارید (خواندن و گوش دادن در همین صفحه آزاد است).`;
        blob = await record(v, canvas, draw, frames, stop, ac, before(film));
      }
      if (stop.aborted) return;
      made1 = { blob, total: film.total, silent: !sound, card: full, cover: await filmCover(F, film) };
    } else {
    const card = short?.card ?? full;
    $('[data-vs-skel]', stage)!.textContent = card.title;
    const src = short?.src ?? ((i: number) => (full.vid ? `vid=${full.vid}&i=${i}` : undefined));
    useShape(want.shape);
    INTRO = mode === 'short' ? 0 : FULL_INTRO;
    await Promise.all([800, 500, 900].map((w) => document.fonts.load(`${w} 40px ${FONT}`))).catch(() => {});
    say('آوردن تصویرها…', 0.03);
    const wanted = new Map(card.video.chapters.flatMap((c) => c.pics).map((a) => [a[0], a]));
    let got = 0;
    const list = await Promise.all(
      [...wanted.values()].map((a) =>
        picture(a).then((b) => {
          say('آوردن تصویرها…', 0.03 + (0.05 * ++got) / wanted.size, got / wanted.size);
          return b;
        }),
      ),
    );
    const pics = new Map([...wanted.keys()].map((k, i) => [k, list[i]]));
    if (stop.aborted) return;
    const lines = lineMaker(card, src);
    // The preview: the same video with the text at a reading pace and no sound, while the voice is made.
    const draft = await build(card, pics, null, () => {}, lines);
    preview({ card, ...draft, sound: null } as Video, stop);
    step('voice');
    say(engine ? 'ساختن روایت…' : 'آماده کردن متن…', 0.08);
    const built = await build(card, pics, engine, (p) => say('ساختن روایت با صدای فارسی…', 0.08 + p * 0.37, p), lines);
    if (stop.aborted) return;
    const video: Video = { card, ...built, sound: mix(built, !!engine) };
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const draw = painter(canvas.getContext('2d', { alpha: false })!, video);
    previewing++;
    show(canvas, 'frames');
    step('frames');
    const frames = (p: number) => say('ساختن ویدیو، فریم به فریم…', 0.45 + p * 0.55, p);
    let blob = await encode(video, canvas, draw, frames, stop);
    if (!blob) {
      note.textContent = `این کار ${fmtNum(Math.ceil(video.total))} ثانیه طول می‌کشد؛ این صفحه را باز نگه دارید (خواندن و گوش دادن در همین صفحه آزاد است).`;
      blob = await record(video, canvas, draw, frames, stop, ac);
    }
    if (stop.aborted) return;
      made1 = { blob, total: video.total, silent: !video.sound, card, cover: null };
    }
    const { blob, total } = made1;
    track(`video-made-${want.shape}`);
    void keep(key, blob, total);
    made = { key, show: done.bind(null, full, blob, total, made1.silent, href, { ...want, mode }, false, made1.cover) };
    made.show();
    step('ready');
    if (!d.open) {
      miniFrame();
      pillState('ready');
      toast('ویدیوی شما آماده است ✓', 'reward');
    }
  } catch (e) {
    if (stop.aborted || (e as Error).name === 'AbortError') return;
    console.error(e);
    say('ساختن ویدیو ممکن نشد — دوباره امتحان کنید.', 0);
    toast('ساختن ویدیو ممکن نشد');
    if (!d.open) pillState('failed');
  } finally {
    previewing++;
    if (run === mine) {
      d.removeAttribute('data-busy');
      making = null;
      bgBtn.hidden = true;
      if (stop.aborted) pillState('off');
    }
    // iOS keeps only a few audio contexts alive: one per video would soon leave none.
    if (!handedOn) ac?.close().catch(() => {});
  }
}

/** Where each of the film's shots starts in the source clip: the shots marked `vid` take it in turn while it lasts. */
function placeClip(v: FilmVideo, footage: Footage | null) {
  let at = 0;
  for (const s of v.scenes) {
    s.clipAt = footage && s.vid && at < footage.duration - 1 ? at : null;
    if (s.clipAt != null) at += s.to - s.from;
  }
}
/** The film's cover: its opening shot with the headline whole, as JPEG (the cinema's poster, R2 `<id>-<shape>.jpg`). */
async function filmCover(F: typeof import('./film'), v: FilmVideo): Promise<Blob | null> {
  try {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    F.filmPainter(c.getContext('2d', { alpha: false })!, W, H, v, { cover: true })(0);
    for (const q of [0.82, 0.7, 0.55]) {
      const b = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', q));
      if (b && b.size <= 600 * 1024) return b;
    }
  } catch {}
  return null;
}

const SHAPE_FA: Record<Shape, string> = { v: 'عمودی', h: 'افقی', s: 'مربع' };

// ---------- films everyone can watch (functions/media/[[path]].js, R2) ----------
/** Where a story's public film is, by shape. */
export const filmUrl = (id: number, shape: Shape) => `${BASE}/media/films/${id}-${shape}.mp4`;
/** The public film of this story in this shape, if one is published (a HEAD; null when there's none or no storage). */
async function publicFilm(id: number, shape: Shape): Promise<Blob | null> {
  try {
    const head = await fetch(filmUrl(id, shape), { method: 'HEAD' });
    if (!head.ok) return null;
    const res = await fetch(filmUrl(id, shape));
    return res.ok ? await res.blob() : null;
  } catch {
    return null;
  }
}
/** A film made here, with a voice, as MP4, of a story with no public film yet: «انتشار برای همه» puts it on the
 *  story's page and in /cinema/ for every reader, with its cover and length. Only the film with every part. */
function publishRow(card: Card, blob: Blob, sel: Picked, silent: boolean, seconds: number, cover: Blob | null) {
  const row = $('[data-vs-public]', d)!;
  const text = $('[data-vs-public-text]', d)!;
  const btn = $<HTMLButtonElement>('[data-vs-publish]', d)!;
  row.hidden = true;
  if (sel.mode !== 'film' || silent || !card.id || !blob.type.includes('mp4')) return;
  const shape = sel.shape;
  void fetch(`${BASE}/media/films/?ids=${card.id}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((have: Record<string, string[]> | null) => {
      if (!have) return;
      const published = have[card.id]?.includes(shape);
      row.hidden = false;
      btn.hidden = !!published || !standard(sel);
      text.textContent = published
        ? 'این فیلم برای همه منتشر شده است: در صفحه‌ی خبر و «سینمای خبر» دیده می‌شود.'
        : standard(sel)
          ? 'هنوز کسی فیلم این خبر را منتشر نکرده: با انتشار، همه آن را می‌بینند.'
          : 'فیلمی که همه‌ی بخش‌ها را دارد منتشر می‌شود؛ این نسخه‌ی شخصی شماست.';
      btn.onclick = async () => {
        btn.disabled = true;
        const res = await fetch(filmUrl(card.id, shape), { method: 'POST', headers: { 'content-type': 'video/mp4', ...(seconds && { 'x-seconds': String(seconds) }) }, body: blob }).catch(() => null);
        if ((res?.status === 201 || res?.status === 409) && cover)
          await fetch(filmUrl(card.id, shape).replace(/\.mp4$/, '.jpg'), { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: cover }).catch(() => null);
        btn.disabled = false;
        if (res?.status === 201 || res?.status === 409) {
          btn.hidden = true;
          text.textContent = 'منتشر شد ✓ حالا همه این فیلم را در صفحه‌ی خبر و «سینمای خبر» می‌بینند.';
          track('film-published');
        } else toast(res?.status === 429 ? 'کمی بعد دوباره امتحان کنید' : 'انتشار ممکن نشد');
      };
    })
    .catch(() => {});
}
let coverUrl = '';
function done(card: Card, blob: Blob, seconds: number, silent: boolean, href: string, sel: Picked, fromCache: boolean, cover: Blob | null) {
  if (url) URL.revokeObjectURL(url);
  if (coverUrl) URL.revokeObjectURL(coverUrl);
  url = URL.createObjectURL(blob);
  coverUrl = cover ? URL.createObjectURL(cover) : '';
  const { shape, mode } = sel;
  const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
  const file = new File([blob], `khabar-${card.id || card.vid}-${shape}.${ext}`, { type: blob.type.split(';')[0] });
  view('done');
  $('[data-vs-title-text]', d)!.textContent = mode === 'film' ? 'فیلم خبر' : 'ویدیوی خبر';
  $('[data-vs-bg]', d)!.hidden = true;
  stage.querySelector('canvas')?.remove();
  showing = null;
  const player = $<HTMLVideoElement>('[data-vs-video]', d)!;
  player.src = url;
  player.dataset.shape = shape;
  if (coverUrl) {
    player.poster = coverUrl;
    player.dataset.cover = coverUrl;
  } else {
    player.removeAttribute('poster');
    delete player.dataset.cover;
  }
  // It plays at once, silent (a browser starts sound only from a tap): the controls turn the sound on.
  player.muted = true;
  if (d.open) player.play().catch(() => {});
  const meta = (secs: number) => {
    const min = Math.floor(secs / 60);
    const sec = Math.round(secs % 60);
    $('[data-vs-meta]', d)!.textContent = `${fromCache ? 'ساخته شده · ' : ''}${SHAPE_FA[shape]} · ${secs ? `${min ? `${fmtNum(min)} دقیقه و ` : ''}${fmtNum(sec)} ثانیه · ` : ''}${fmtNum(Math.max(0.1, Math.round(blob.size / 1e5) / 10))} مگابایت`;
  };
  meta(seconds);
  // A kept video's length comes from the file itself.
  if (!seconds) player.onloadedmetadata = () => Number.isFinite(player.duration) && meta(player.duration);
  $('[data-vs-silent]', d)!.hidden = !silent || !voiceSupported();
  $('[data-vs-voice]', d)!.onclick = () => {
    d.close();
    // Called in the voice sheet's tap: the remade video's sound can be recorded on iOS too.
    openVoice(() => makeVideo(href, tapAudio(), true, { ...sel }));
  };
  // Another shape, kind or set of parts: back to the setup (not the published film again).
  $('[data-vs-again]', d)!.onclick = () => setupVideo(href, sel, false);
  publishRow(card, blob, sel, silent, seconds, cover);
  // Ready to post: the caption (the model's, else the headline and the address) goes with the file, and can be copied.
  const page = card.link ?? `${SITE.url}/p/${card.id}/`;
  const caption = card.share ? `${card.share}\n${page}` : `${card.title}\n${page}`;
  $('[data-vs-caption]', d)!.textContent = caption;
  $('[data-vs-copy]', d)!.onclick = () => navigator.clipboard.writeText(caption).then(() => toast('متن کپی شد'), () => toast('کپی ممکن نشد'));
  const save = $<HTMLAnchorElement>('[data-vs-save]', d)!;
  save.href = url;
  save.download = file.name;
  save.hidden = false;
  const shareBtn = $('[data-vs-share]', d)!;
  shareBtn.hidden = !navigator.canShare?.({ files: [file] });
  shareBtn.onclick = () =>
    navigator.share({ files: [file], title: card.title, text: caption }).then(
      () => track('video-shared'),
      () => {},
    );
  $('[data-vs-cancel]', d)!.textContent = 'بستن';
}
