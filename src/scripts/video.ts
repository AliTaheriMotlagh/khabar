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
import { $, fmtNum, tapAudio, toast } from './core';
import { SITE } from '../site';
import { align, pauseAfter, weight, words } from '../lib/align';
import { lineAudio, persianVoice, recordableVoice } from './speech';
import { chosenVoice, voiceSupported } from './voice';
import { openVoice } from './voice-offer';

const W = 1280;
const H = 720;
const FPS = 30;
const RATE = 48000;
/** Seconds: the opening, the closing card, a scene's way in before its voice starts, the pause between paragraphs,
 *  and a headline that isn't read aloud (its first paragraph says it). */
const INTRO = 2.8;
const OUTRO = 3.6;
const LEAD = 0.7;
const GAP = 0.35;
const TITLE_SILENT = 3.4;
const FONT = '"Vazirmatn Variable", system-ui, sans-serif';
const PIC_WAIT = 9000;
const M = 64; // the frame's side margin
const PANEL = { x: M, y: 140, w: 520, h: 390 };
const COL = { right: W - M, w: 560 }; // the text column beside the panel
const BODY = { size: 32, lh: 58, bottom: 620 };
/** The headline's sizes, largest first: the first that fits the frame's height (TITLE_ROOM) is used. */
const TITLE_SIZES = [50, 44, 38, 34];
const TITLE_ROOM = 440;
const YELLOW = '#ffd166';
const INK = '#141a33';

type Plan = { title: boolean; chapters: { head: string | null; say: number[]; pics: string[][] }[] };
type Card = { id: number; kind: string; title: string; href: string; date: string; tag: string | null; body: string[]; why: string | null; video: Plan };
/** A word as shown and said: when it's said, and whether it starts a paragraph. Hidden: said but not shown (the
 *  «۳ —» before a summary item, which its chapter's number shows). */
type Word = { text: string; from: number; to: number; br: boolean; hidden: boolean };
/** silent: a headline that isn't read aloud, shown word by word without the mark that follows the voice. */
type Scene = { kind: 'title' | 'chapter'; head: string | null; words: Word[]; pics: ImageBitmap[]; from: number; to: number; silent: boolean };
type Clip = { at: number; pcm: Float32Array };
type Video = { card: Card; scenes: Scene[]; clips: Clip[]; outro: number; total: number; sound: AudioBuffer | null };

// ---------- what goes in ----------
async function picture(addresses: string[]): Promise<ImageBitmap | null> {
  for (const url of addresses) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(PIC_WAIT), referrerPolicy: 'no-referrer' });
      if (res.ok) return await createImageBitmap(await res.blob());
    } catch {}
  }
  return null;
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
async function build(card: Card, pics: Map<string, ImageBitmap | null>, engine: 'cloud' | 'local' | null, step: (p: number) => void) {
  // The same list /api/tts reads by index.
  const lines = [card.title, ...card.body, card.why].filter((l): l is string => !!l);
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
        for (const piece of await lineAudio({ text, post: card.id, i }, engine)) {
          const pcm = (await decoder.decodeAudioData(piece.data)).getChannelData(0);
          const ws = words(piece.texts.join(' '));
          align(pcm, RATE, ws).forEach((s, k) => scene.words.push({ text: ws[k], from: t + s.from, to: t + s.to, br: false, hidden: false }));
          clips.push({ at: t, pcm });
          t += pcm.length / RATE;
        }
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
const ease = (x: number) => 1 - (1 - Math.min(1, Math.max(0, x))) ** 3;
const back = (x: number) => {
  x = Math.min(1, Math.max(0, x));
  return 1 + 2.7 * (x - 1) ** 3 + 1.7 * (x - 1) ** 2;
};
const day = (iso: string) => new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: SITE.timeZone, day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));
const isLatin = (s: string) => /[A-Za-z]/.test(s) && !/[؀-ۿ]/.test(s);
const trim = (s: string) => s.replace(/^[«"(\[]+|[»")\],.،؛:!?؟…]+$/g, '');

function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}
function cover(ctx: CanvasRenderingContext2D, img: ImageBitmap, x: number, y: number, w: number, h: number, zoom: number, pan: number) {
  const s = Math.max(w / img.width, h / img.height) * zoom;
  const dw = img.width * s;
  const dh = img.height * s;
  ctx.drawImage(img, x + (w - dw) / 2 + pan * (dw - w) * 0.5, y + (h - dh) / 2, dw, dh);
}
function logo(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, ring = 1, dot = 1) {
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
type Placed = { k: number; x: number; w: number; ltr: boolean };
function layout(ctx: CanvasRenderingContext2D, ws: Word[], width: number): Placed[][] {
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
function extras(ws: Word[]) {
  const callouts: { text: string; from: number; to: number }[] = [];
  ws.forEach((w, k) => {
    if (w.hidden || !/[0-9۰-۹]/.test(w.text)) return;
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
  const link = `${SITE.url.replace(/^https:\/\//, '')}/p/${card.id}`;
  const kicker = digest ? 'خلاصه‌ی ۲۴ ساعت' : card.tag || 'خبر';
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
    const width = pics ? COL.w : 960;
    // A long headline gets smaller until it fits; at the smallest it goes in pages like the text.
    let size = BODY.size;
    let rows: Placed[][] = [];
    for (size of title ? TITLE_SIZES : [BODY.size]) {
      ctx.font = `${title ? 800 : 500} ${size}px ${FONT}`;
      rows = layout(ctx, s.words, width);
      if (!title || rows.length * Math.round(size * 1.6) <= TITLE_ROOM) break;
    }
    const lh = title ? Math.round(size * 1.6) : BODY.lh;
    const top = title ? 0 : s.head ? 262 : 200;
    const per = title ? Math.floor(TITLE_ROOM / lh) : Math.max(1, Math.floor((BODY.bottom - top) / BODY.lh) + 1);
    const pages = Array.from({ length: Math.ceil(rows.length / per) }, (_, p) => rows.slice(p * per, p * per + per));
    const pageOf = new Map<number, number>();
    pages.forEach((pg, p) => pg.flat().forEach((it) => pageOf.set(it.k, p)));
    return { title, pics, width, size, lh, pages, pageOf, top, n, ...extras(s.words) };
  });

  function background(t: number) {
    ctx.fillStyle = '#0a0f1f';
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
    logo(ctx, W - M - 20, 62, 20);
    ctx.fillStyle = '#fff';
    ctx.font = `800 26px ${FONT}`;
    ctx.fillText(SITE.name, W - M - 54, 71);
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgb(255 255 255 / .65)';
    ctx.font = `500 20px ${FONT}`;
    ctx.fillText(day(card.date), M, 70);
    ctx.direction = 'ltr';
    ctx.fillStyle = 'rgb(255 255 255 / .5)';
    ctx.font = `500 17px ${FONT}`;
    ctx.fillText(link, M, H - 44);
    // Progress by chapter, right to left.
    const span = outro - INTRO;
    let x = W - M;
    const full = W - 2 * M - 6 * (scenes.length - 1);
    scenes.forEach((s) => {
      const w = (full * (s.to - s.from)) / span;
      const p = Math.min(1, Math.max(0, (t - s.from) / (s.to - s.from)));
      ctx.fillStyle = 'rgb(255 255 255 / .18)';
      rounded(ctx, x - w, H - 30, w, 5, 2.5);
      ctx.fill();
      if (p > 0) {
        ctx.fillStyle = YELLOW;
        rounded(ctx, x - w * p, H - 30, w * p, 5, 2.5);
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
        if (now && !s.silent) {
          ctx.globalAlpha = alpha * fade * ease((t - w.from) / 0.08);
          ctx.fillStyle = YELLOW;
          rounded(ctx, x - 9, y - size * 1.05, it.w + 18, size * 1.55, 12);
          ctx.fill();
          ctx.globalAlpha = alpha * fade;
        }
        ctx.fillStyle = s.silent || said ? '#fff' : now ? INK : 'rgb(255 255 255 / .38)';
        ctx.direction = it.ltr ? 'ltr' : 'rtl';
        ctx.fillText(w.text, x, y);
      }
    });
    ctx.globalAlpha = alpha;
  }

  function panel(s: Scene, l: (typeof laid)[number], t: number) {
    const { x, y, w, h } = PANEL;
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
        cover(ctx, pics[i], x, y, w, h, 1 + 0.1 * local, (i % 2 ? 1 : -1) * 0.15 * local);
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
      ctx.translate(x + w / 2, y + h - 64);
      ctx.scale(sc, sc);
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
    ctx.font = `600 22px ${FONT}`;
    ctx.direction = 'ltr';
    ctx.textAlign = 'left';
    let cx = x + w;
    const ga = ctx.globalAlpha;
    for (const tg of shown.reverse()) {
      const tw = Math.min(ctx.measureText(tg.text).width + 32, 300);
      if (cx - tw < x) break;
      const a = ease((t - tg.from) / 0.25);
      ctx.globalAlpha = ga * a;
      ctx.fillStyle = 'rgb(255 255 255 / .08)';
      rounded(ctx, cx - tw, y + h + 22 + (1 - a) * 10, tw, 44, 22);
      ctx.fill();
      ctx.strokeStyle = 'rgb(128 152 255 / .6)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = '#dfe5ff';
      ctx.fillText(tg.text, cx - tw + 16, y + h + 52 + (1 - a) * 10, tw - 32);
      ctx.globalAlpha = ga;
      cx -= tw + 10;
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
      const blockTop = 375 - (rows * l.lh + 60) / 2;
      ctx.font = `700 24px ${FONT}`;
      ctx.direction = 'rtl';
      ctx.textAlign = 'right';
      const kw = ctx.measureText(kicker).width + 36;
      const right = l.pics ? COL.right : (W + l.width) / 2;
      ctx.fillStyle = '#2f4fd8';
      rounded(ctx, right - kw, blockTop - 6, kw, 44, 22);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(kicker, right - 18, blockTop + 24);
      text(s, l, t, blockTop + 60 + l.size + 12, alpha);
    } else {
      panel(s, l, t);
      if (s.head) {
        ctx.direction = 'rtl';
        ctx.textAlign = 'right';
        if (digest) {
          // «۳» in a circle, «از ۱۲» beside it.
          ctx.fillStyle = '#2f4fd8';
          ctx.beginPath();
          ctx.arc(COL.right - 34, 186, 34, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.font = `900 36px ${FONT}`;
          ctx.textAlign = 'center';
          ctx.fillText(s.head, COL.right - 34, 199);
          ctx.textAlign = 'right';
          ctx.fillStyle = 'rgb(255 255 255 / .6)';
          ctx.font = `600 22px ${FONT}`;
          ctx.fillText(`از ${fmtNum(chapters)}`, COL.right - 82, 195);
        } else {
          ctx.fillStyle = YELLOW;
          rounded(ctx, COL.right - 8, 160, 8, 44, 4);
          ctx.fill();
          ctx.font = `800 32px ${FONT}`;
          ctx.fillText(s.head, COL.right - 24, 194);
        }
      }
      text(s, l, t, l.top + BODY.size, alpha);
    }
    ctx.restore();
  }

  function intro(t: number, alpha: number) {
    ctx.save();
    ctx.globalAlpha = alpha;
    const zoom = 1 + 0.06 * ease((t - (INTRO - 0.5)) / 0.5);
    ctx.translate(W / 2, H / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-W / 2, -H / 2);
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
    logo(ctx, W / 2, 230, 52, ease((t - outro - 0.1) / 0.6), back((t - outro - 0.5) / 0.35));
    ctx.textAlign = 'center';
    ctx.direction = 'rtl';
    ctx.fillStyle = '#fff';
    ctx.font = `900 56px ${FONT}`;
    ctx.fillText(SITE.name, W / 2, 352);
    ctx.fillStyle = 'rgb(255 255 255 / .75)';
    ctx.font = `500 28px ${FONT}`;
    ctx.fillText(digest ? 'همه‌ی خبرها با منبع:' : 'متن کامل و منبع این خبر:', W / 2, 428);
    ctx.direction = 'ltr';
    ctx.fillStyle = YELLOW;
    ctx.font = `700 32px ${FONT}`;
    ctx.fillText(link, W / 2, 482);
    ctx.fillStyle = 'rgb(255 255 255 / .6)';
    ctx.font = `500 24px ${FONT}`;
    ctx.fillText(`t.me/${SITE.channel}`, W / 2, 540);
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
/** With the browser's encoders, frame by frame, faster than real time. Null when they can't make this video. */
async function encode(v: Video, canvas: HTMLCanvasElement, draw: (t: number) => void, step: (p: number) => void, stop: AbortSignal): Promise<Blob | null> {
  if (typeof VideoEncoder !== 'function') return null;
  if (!(await canEncodeVideo('avc', { width: W, height: H }))) return null;
  const codec = v.sound ? await getFirstEncodableAudioCodec(['aac', 'opus'], { numberOfChannels: 1, sampleRate: RATE }) : null;
  if (v.sound && !codec) return null;
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const video = new CanvasSource(canvas, { codec: 'avc', bitrate: 1_200_000, keyFrameInterval: 2 });
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
async function record(v: Video, canvas: HTMLCanvasElement, draw: (t: number) => void, step: (p: number) => void, stop: AbortSignal, ac: AudioContext | null): Promise<Blob> {
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
  const rec = new MediaRecorder(stream, { mimeType: type || undefined, videoBitsPerSecond: 1_200_000 });
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
const d = $<HTMLDialogElement>('#video-sheet')!;
let run: AbortController | null = null;
let url = '';
/** The last video made, shown again when «ویدیو» is tapped for the same story with the same voice. */
let made: { key: string; show: () => void } | null = null;
const close = () => d.close();
$('[data-close]', d)!.addEventListener('click', close);
$('[data-vs-cancel]', d)!.addEventListener('click', close);
// While a video is being made (data-busy) a tap beside the sheet (app.ts closes any other dialog then), Escape or
// Android's back don't throw it away: only «لغو» and ✕ do.
const stillMaking = () => toast('ویدیو در حال ساخته شدن است؛ برای لغو، «لغو» را بزنید');
d.addEventListener('click', (e) => e.target === d && d.hasAttribute('data-busy') && stillMaking());
d.addEventListener('cancel', (e) => {
  if (!d.hasAttribute('data-busy')) return;
  e.preventDefault();
  stillMaking();
});
// Closing stops a video being made — unless the sheet was opened again before this (queued) event came.
d.addEventListener('close', () => {
  if (d.open) return;
  run?.abort();
  $<HTMLVideoElement>('[data-vs-video]', d)!.pause();
});

/** Makes the video of the story at `href` (its page's address) and offers it to share or save. `ac`: an audio
 *  context started in the tap, for recording the sound where the encoders can't (iOS only lets audio start there).
 *  `asked`: the voice sheet was already offered, so a reader who chose no downloadable voice gets a silent video. */
export async function makeVideo(href: string, ac: AudioContext | null = null, asked = false) {
  run?.abort();
  const mine = (run = new AbortController());
  const stop = mine.signal;
  const status = $('[data-vs-status]', d)!;
  const bar = $('[data-vs-bar]', d)!;
  const note = $('[data-vs-note]', d)!;
  const shareBtn = $('[data-vs-share]', d)!;
  const save = $<HTMLAnchorElement>('[data-vs-save]', d)!;
  const cancel = $('[data-vs-cancel]', d)!;
  const say = (msg: string, p: number) => {
    status.textContent = msg;
    bar.style.width = `${Math.round(p * 100)}%`;
  };
  $('[data-vs-making]', d)!.hidden = false;
  $('[data-vs-done]', d)!.hidden = true;
  shareBtn.hidden = save.hidden = true;
  cancel.textContent = 'لغو';
  note.textContent = '';
  say('آماده کردن خبر…', 0);
  d.toggleAttribute('data-busy', true);
  if (!d.open) d.showModal();
  let handedOn = false; // `ac` goes on to the next try, after the voice sheet
  try {
    await persianVoice();
    const engine = recordableVoice();
    // The video's voice has to be one the page can keep: offer the download, as «گوش دادن» does, and come back.
    if (!engine && voiceSupported() && !asked) {
      handedOn = true;
      d.close();
      toast('برای روایت ویدیو یک صدای فارسی لازم است');
      return void openVoice(() => makeVideo(href, ac, true));
    }
    const key = `${href} ${engine} ${chosenVoice()}`;
    if (made?.key === key) return made.show();
    const card = (await fetch(`${href}card.json`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))) as Card;
    await Promise.all([800, 500, 900].map((w) => document.fonts.load(`${w} 40px ${FONT}`))).catch(() => {});
    say('آوردن تصویرها…', 0.03);
    const wanted = new Map(card.video.chapters.flatMap((c) => c.pics).map((a) => [a[0], a]));
    const got = await Promise.all([...wanted.values()].map(picture));
    const pics = new Map([...wanted.keys()].map((k, i) => [k, got[i]]));
    if (stop.aborted) return;
    say(engine ? 'ساختن روایت…' : 'آماده کردن متن…', 0.06);
    const built = await build(card, pics, engine, (p) => say(`ساختن روایت… ${fmtNum(Math.round(p * 100))}٪`, 0.06 + p * 0.39));
    if (stop.aborted) return;
    const video: Video = { card, ...built, sound: mix(built, !!engine) };
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const draw = painter(canvas.getContext('2d', { alpha: false })!, video);
    const frames = (p: number) => say(`ساختن ویدیو… ${fmtNum(Math.round(p * 100))}٪`, 0.45 + p * 0.55);
    let blob = await encode(video, canvas, draw, frames, stop);
    if (!blob) {
      note.textContent = `این کار ${fmtNum(Math.ceil(video.total))} ثانیه طول می‌کشد؛ صفحه را باز نگه دارید.`;
      blob = await record(video, canvas, draw, frames, stop, ac);
    }
    if (stop.aborted) return;
    made = { key, show: done.bind(null, card, blob, video.total, !video.sound) };
    made.show();
  } catch (e) {
    if (stop.aborted || (e as Error).name === 'AbortError') return;
    console.error(e);
    say('ساختن ویدیو ممکن نشد — دوباره امتحان کنید.', 0);
    toast('ساختن ویدیو ممکن نشد');
  } finally {
    if (run === mine) d.removeAttribute('data-busy');
    // iOS keeps only a few audio contexts alive: one per video would soon leave none.
    if (!handedOn) ac?.close().catch(() => {});
  }
}

function done(card: Card, blob: Blob, seconds: number, silent: boolean) {
  if (url) URL.revokeObjectURL(url);
  url = URL.createObjectURL(blob);
  const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
  const file = new File([blob], `khabar-${card.id}.${ext}`, { type: blob.type.split(';')[0] });
  $('[data-vs-making]', d)!.hidden = true;
  $('[data-vs-done]', d)!.hidden = false;
  $<HTMLVideoElement>('[data-vs-video]', d)!.src = url;
  const min = Math.floor(seconds / 60);
  const sec = Math.round(seconds % 60);
  $('[data-vs-meta]', d)!.textContent = `${min ? `${fmtNum(min)} دقیقه و ` : ''}${fmtNum(sec)} ثانیه · ${fmtNum(Math.max(0.1, Math.round(blob.size / 1e5) / 10))} مگابایت`;
  $('[data-vs-silent]', d)!.hidden = !silent || !voiceSupported();
  $('[data-vs-voice]', d)!.onclick = () => {
    d.close();
    // Called in the voice sheet's tap: the remade video's sound can be recorded on iOS too.
    openVoice(() => makeVideo(card.href, tapAudio(), true));
  };
  const save = $<HTMLAnchorElement>('[data-vs-save]', d)!;
  save.href = url;
  save.download = file.name;
  save.hidden = false;
  const shareBtn = $('[data-vs-share]', d)!;
  shareBtn.hidden = !navigator.canShare?.({ files: [file] });
  shareBtn.onclick = () => navigator.share({ files: [file], title: card.title, text: `${card.title}\n${SITE.url}/p/${card.id}/` }).catch(() => {});
  $('[data-vs-cancel]', d)!.textContent = 'بستن';
}
