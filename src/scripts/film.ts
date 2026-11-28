// A story as a short news film (the video sheet's «فیلم», src/scripts/video.ts mode 'film'): the shots of card.json's
// `film` (src/lib/posts.ts filmPlan) drawn like a newscast's package — the source's own video under the hook and the
// first lines (src/scripts/footage.ts, credited), full-frame pictures under a slow camera move, and where a story has
// neither, a drawn backdrop of the names it's about (never a made-up picture). Cross-dissolves, a stinger (the brand's
// bars sweeping across) into the explainer shots, a headline that reveals itself as it's said with its Latin names
// marked, a status chip (رسمی / به گزارش رسانه‌ها / تأییدنشده) the way a newsroom labels a claim, numbers that count up
// as they're said, subtitles on a dark band with the word being said lit, a ticker of the day's other headlines, and
// for each kind of shot its own scene: the real post as a card, a list built up item by item, the anchor explaining
// (src/scripts/anchor.ts — Gholam for a man's voice, Parisa for a woman's, so the face matches the voice), bars for
// the numbers, the story so far on a timeline, a quiz with a countdown. A music bed made here (no licence to clear)
// ducks under the voice; the clip's own sound runs low beneath it. Only what the story says or shows: no generated
// footage. Loaded with the first film (video.ts imports it when the mode is 'film').
import { ANCHOR_LABEL, drawAnchor, drawCohost, faceAt, levelAt, levels } from './anchor';
import { FONT, INK, YELLOW, back, cover, day, ease, extras, isLatin, layout, logo, rounded, trim, type Img, type Placed, type Word } from './video';
import type { Footage } from './footage';
import { SITE } from '../site';

export type FilmSrc = { kind: string; name: string; handle?: string; avatar?: string[] | null; text?: string; title?: string; site: string; date?: string | null };
export type FilmClipJson = { url: string; poster: string[] | null; dur: number | null; ratio: number | null };
export type FilmMeta = { status: 'رسمی' | 'گزارش' | 'شایعه' | null; importance: number | null; type: string | null; names: string[]; ticker: string[] };
export type FilmShotJson = { shot: string; head?: string; say: string[]; pics: string[][]; pause?: number[]; data?: any; vid?: true; /** The first line's number among all the film's lines (video.ts numbered). */ line?: number };
export type FilmScene = { shot: string; head: string | null; words: Word[]; pics: ImageBitmap[]; from: number; to: number; lineAt: number[]; data?: any; vid: boolean; clipAt: number | null };
/** The reader's choices (the video sheet's setup): who presents (by the voice's gender), and what's drawn besides. */
export type FilmOpts = { host: 'g' | 'p'; anchor: boolean; music: boolean; subs: boolean; ticker: boolean };
export const FILM_OPTS: FilmOpts = { host: 'g', anchor: true, music: true, subs: true, ticker: true };
export type FilmVideo = {
  scenes: FilmScene[];
  clips: { at: number; pcm: Float32Array }[];
  /** The source clip's own sound, placed on the timeline (run low under the voice). */
  nat: { at: number; pcm: Float32Array }[];
  outro: number;
  total: number;
  src: FilmSrc | null;
  avatar: ImageBitmap | null;
  id: number;
  date: string;
  title: string;
  meta: FilmMeta | null;
  footage: Footage | null;
  opts: FilmOpts;
};

/** The parts of a film a reader can leave out (the sheet's chips): the shot types, and the source's video. The hook
 *  and the story's first paragraph are always in. */
export const FILM_PARTS: { key: string; label: string; shots: string[] }[] = [
  { key: 'footage', label: 'ویدیوی خود خبر', shots: [] },
  { key: 'source', label: 'منبع اصلی', shots: ['source'] },
  { key: 'body', label: 'متن کامل', shots: ['picture'] },
  { key: 'points', label: 'نکته‌ها', shots: ['points'] },
  { key: 'explain', label: 'به زبان ساده', shots: ['explain'] },
  { key: 'term', label: 'اصطلاح', shots: ['term'] },
  { key: 'numbers', label: 'عددها', shots: ['numbers'] },
  { key: 'context', label: 'ماجرا تا اینجا', shots: ['context'] },
  { key: 'why', label: 'چرا مهمه؟', shots: ['why'] },
  { key: 'quiz', label: 'سؤال', shots: ['quiz'] },
];
/** The shots kept with these parts on (the lead — the first shot after the hook — always stays). */
export function pickShots(shots: FilmShotJson[], parts: Set<string>): FilmShotJson[] {
  const lead = shots.findIndex((s, i) => i > 0 && (s.shot === 'source' || s.shot === 'picture'));
  return shots
    .filter((s, i) => {
      if (i === 0 || i === lead) return true;
      const part = FILM_PARTS.find((p) => p.shots.includes(s.shot));
      return !part || parts.has(part.key);
    })
    .map((s, i) => (i === 1 && s.shot === 'source' && !parts.has('source') ? { ...s, shot: 'picture' } : s))
    .map((s) => (s.vid && !parts.has('footage') ? { ...s, vid: undefined } : s));
}

/** Seconds of the opening (logo sting, letterbox) and the closing card. */
export const FILM_INTRO = 3.2;
export const FILM_OUTRO = 4;
const STUDIO = ['explain', 'term', 'numbers', 'context', 'quiz', 'why'];
const STATUS: Record<string, { label: string; color: string }> = {
  'رسمی': { label: 'رسمی', color: '#1f9d55' },
  'گزارش': { label: 'به گزارش رسانه‌ها', color: '#2f6fd8' },
  'شایعه': { label: 'تأییدنشده', color: '#e07a1f' },
};
const COHOST_LABEL = 'پریسا · مجری هوش مصنوعی';

/** Where the film's timeline is in the source clip at `t`, or null when no clip is on screen (the encoder asks this
 *  before each frame, src/scripts/video.ts). Through the dissolve after a clip's last shot, that shot's time. */
export function clipTimeAt(v: FilmVideo, t: number): number | null {
  if (!v.footage) return null;
  let n = 0;
  while (n + 1 < v.scenes.length && v.scenes[n + 1].from <= t) n++;
  let s = v.scenes[n];
  if (s.clipAt == null && n > 0 && t - s.from < 0.6 && v.scenes[n - 1].clipAt != null) s = v.scenes[n - 1];
  if (s.clipAt == null) return null;
  const ct = s.clipAt + Math.max(0, t - s.from);
  return ct < v.footage.duration - 0.05 ? ct : null;
}

/** A number said aloud, counted up from zero as it pops up (not a year, not a version: those stay as said). */
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
function countUp(text: string, p: number): string {
  if (p >= 1) return text;
  const m = text.match(/^([0-9۰-۹]+)(?:([.٫])([0-9۰-۹]+))?(.*)$/);
  if (!m) return text;
  const fa = /[۰-۹]/.test(m[1]);
  const toLatin = (s: string) => s.replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d)));
  const whole = Number(toLatin(m[1]));
  const dec = m[3] ? m[3].length : 0;
  const value = Number(`${whole}${dec ? `.${toLatin(m[3])}` : ''}`);
  if (!Number.isFinite(value) || (dec === 0 && whole >= 1900 && whole <= 2100) || (m[1].length > 1 && m[1].startsWith(fa ? '۰' : '0'))) return text;
  let shown = (value * p).toFixed(dec);
  if (dec) shown = shown.replace('.', m[2]);
  if (fa) shown = shown.replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)]);
  return shown + m[4];
}

/** A seeded random (the drawn backdrop must be the same on every frame and every device). */
const seeded = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

export function filmPainter(ctx: CanvasRenderingContext2D, W: number, H: number, v: FilmVideo, look: { cover?: boolean } = {}) {
  const REEL = H > W;
  const k = Math.min(W, H) / 720;
  const M = Math.round(56 * k);
  const { scenes, outro, total, opts } = v;
  const lv = levels(v.clips, 48000, total);
  const link = `${SITE.url.replace(/^https:\/\//, '')}/p/${v.id}`;
  const tickerItems = v.meta?.ticker ?? [];
  // The ticker runs along the bottom of a landscape or square film (a reel's bottom is the app's buttons).
  const TK = opts.ticker && !REEL && tickerItems.length ? Math.round(42 * k) : 0;
  const SUB = Math.round((REEL ? 46 : 34) * k);
  const SUB_W = W - 2 * M - (REEL ? 0 : 120 * k);
  const SUB_Y = REEL ? H * 0.74 : H - 92 * k - TK;
  const status = v.meta?.status ? STATUS[v.meta.status] : null;

  // ---------- once ----------
  const vignette = document.createElement('canvas');
  vignette.width = W;
  vignette.height = H;
  {
    const x = vignette.getContext('2d')!;
    const g = x.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    g.addColorStop(0, 'rgb(0 0 0 / 0)');
    g.addColorStop(1, 'rgb(0 0 0 / .55)');
    x.fillStyle = g;
    x.fillRect(0, 0, W, H);
  }
  const soft = new Map<Img, HTMLCanvasElement>();
  const blurred = (img: Img) => {
    let c = soft.get(img);
    if (c) return c;
    const tiny = document.createElement('canvas');
    tiny.width = Math.round(W / 36);
    tiny.height = Math.round(H / 36);
    const tx = tiny.getContext('2d')!;
    const s = Math.max(tiny.width / img.width, tiny.height / img.height);
    tx.drawImage(img, (tiny.width - img.width * s) / 2, (tiny.height - img.height * s) / 2, img.width * s, img.height * s);
    c = document.createElement('canvas');
    c.width = Math.round(W / 4);
    c.height = Math.round(H / 4);
    const cx = c.getContext('2d')!;
    cx.imageSmoothingQuality = 'high';
    cx.drawImage(tiny, 0, 0, c.width, c.height);
    soft.set(img, c);
    return c;
  };
  // The story's first picture, kept for the studio shots' backdrop.
  const keyPic = scenes.find((s) => s.pics.length)?.pics[0] ?? null;

  // Subtitles: each line said is its own run of words (a word with `br` starts the next).
  const runs = scenes.map((s) => {
    const out: [number, number][] = [];
    let start = 0;
    s.words.forEach((w, i) => {
      if (w.br && i > start) {
        out.push([start, i]);
        start = i;
      }
    });
    if (s.words.length) out.push([start, s.words.length]);
    return out;
  });
  const laidSubs = new Map<string, Placed[][]>();
  function subRows(n: number, r: number, width: number, size: number, weight = 600) {
    const key = `${n}:${r}:${width}:${size}`;
    let rows = laidSubs.get(key);
    if (!rows) {
      ctx.font = `${weight} ${size}px ${FONT}`;
      const [a, b] = runs[n][r];
      const ws = scenes[n].words.slice(a, b).map((w) => ({ ...w, br: false }));
      rows = layout(ctx, ws, width).map((row) => row.map((it) => ({ ...it, k: it.k + a })));
      laidSubs.set(key, rows);
    }
    return rows;
  }
  const extra = scenes.map((s) => extras(s.words));

  // The ticker's text, laid once on a strip that slides (right to left reading, so it moves left to right).
  let strip: HTMLCanvasElement | null = null;
  if (TK) {
    const size = Math.round(19 * k);
    const m = document.createElement('canvas').getContext('2d')!;
    m.font = `600 ${size}px ${FONT}`;
    const gap = 46 * k;
    const widths = tickerItems.map((t) => m.measureText(t).width);
    const width = Math.ceil(widths.reduce((a, b) => a + b + gap, 0));
    strip = document.createElement('canvas');
    strip.width = Math.min(16000, width);
    strip.height = TK;
    const x = strip.getContext('2d')!;
    x.font = `600 ${size}px ${FONT}`;
    x.direction = 'rtl';
    x.textAlign = 'right';
    let at = strip.width;
    tickerItems.forEach((t, i) => {
      x.fillStyle = '#fff';
      x.fillText(t, at - gap / 2, TK / 2 + size * 0.36);
      at -= widths[i] + gap;
      x.fillStyle = YELLOW;
      x.beginPath();
      x.arc(at + gap / 2, TK / 2, 4 * k, 0, Math.PI * 2);
      x.fill();
    });
  }

  // The drawn backdrop's pieces (a shot with neither a picture nor footage): the names it's about, a field of nodes.
  const names = (v.meta?.names.length ? v.meta.names : [...new Set(extra.flatMap((e) => e.tags.map((t) => t.text)))].slice(0, 4)).filter(Boolean);
  const rnd = seeded(v.id || 7);
  const nodes = Array.from({ length: 18 }, () => ({ x: rnd(), y: rnd(), r: 0.6 + rnd() * 1.6, a: rnd() * Math.PI * 2, s: 0.15 + rnd() * 0.25 }));

  // ---------- helpers ----------
  const sceneAt = (t: number) => {
    let i = 0;
    while (i + 1 < scenes.length && scenes[i + 1].from <= t) i++;
    return i;
  };
  const current = (s: FilmScene, t: number) => {
    if (look.cover) return -1;
    let cur = -1;
    for (let i = 0; i < s.words.length; i++) if (s.words[i].from <= t) cur = i;
    return cur;
  };
  const speaking = (s: FilmScene, t: number) => s.words.some((w) => t >= w.from - 0.05 && t <= w.to + 0.12);

  /** Persian/English text wrapped to `width` (no timing): for cards that aren't read word by word. */
  function wrap(text: string, width: number, size: number, weight: number) {
    ctx.font = `${weight} ${size}px ${FONT}`;
    const ws: Word[] = text.split(/\s+/).filter(Boolean).map((w) => ({ text: w, from: 0, to: 0, br: false, hidden: false }));
    return { ws, rows: layout(ctx, ws, width) };
  }
  function drawRows(ws: Word[], rows: Placed[][], x0: number, y0: number, lh: number, color: (k: number) => string, maxRows = 99) {
    ctx.textAlign = 'left';
    rows.slice(0, maxRows).forEach((row, r) => {
      for (const it of row) {
        ctx.fillStyle = color(it.k);
        ctx.direction = it.ltr ? 'ltr' : 'rtl';
        ctx.fillText(ws[it.k].text, x0 + it.x, y0 + r * lh);
      }
    });
  }
  function glass(x: number, y: number, w: number, h: number, r = 26 * k, a = 0.62) {
    ctx.save();
    ctx.shadowColor = 'rgb(0 0 0 / .45)';
    ctx.shadowBlur = 40 * k;
    ctx.shadowOffsetY = 14 * k;
    ctx.fillStyle = `rgb(12 16 34 / ${a})`;
    rounded(ctx, x, y, w, h, r);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgb(255 255 255 / .14)';
    ctx.lineWidth = 1.5;
    rounded(ctx, x, y, w, h, r);
    ctx.stroke();
  }
  /** A pill label, right-aligned at `xRight` (yellow by default); returns its width. */
  function label(text: string, xRight: number, y: number, a: number, size = 22 * k, bg = YELLOW, fg = INK) {
    ctx.save();
    ctx.globalAlpha *= a;
    ctx.font = `800 ${size}px ${FONT}`;
    ctx.direction = 'rtl';
    ctx.textAlign = 'right';
    const w = ctx.measureText(text).width + size * 1.4;
    ctx.fillStyle = bg;
    rounded(ctx, xRight - w, y - size * 1.25, w, size * 1.8, size * 0.9);
    ctx.fill();
    ctx.fillStyle = fg;
    ctx.fillText(text, xRight - size * 0.7, y + size * 0.1);
    ctx.restore();
    return w;
  }

  // ---------- backgrounds ----------
  function picture(img: Img, n: number, local: number, span: number, still = false) {
    // A slow push in, panning one way or the other by shot: the documentary's camera (footage barely moves: it moves).
    const p = Math.min(1, local / Math.max(1, span));
    const z = still ? 1.02 + 0.02 * p : 1.04 + 0.1 * p;
    const off = Math.abs(Math.log(img.width / img.height / (W / H)));
    if (off > 0.35) {
      // A chart, a screenshot or a video of the other shape: whole, over its own blur, never cropped mid-word.
      ctx.drawImage(blurred(still && keyPic ? keyPic : img), -W * 0.05, -H * 0.05, W * 1.1, H * 1.1);
      ctx.fillStyle = 'rgb(6 9 22 / .35)';
      ctx.fillRect(0, 0, W, H);
      // Above the subtitles and the headline: the lower third stays for words. Footage gets more of the frame.
      const room = still ? { w: W - 2 * M, h: H * (REEL ? 0.56 : 0.66), y: H * 0.08 } : REEL ? { w: W - 2 * M, h: H * 0.42, y: H * 0.1 } : { w: W * 0.72, h: H * 0.5, y: H * 0.1 };
      const sc = Math.min(room.w / img.width, room.h / img.height) * (1 + (still ? 0 : 0.04) * p);
      const dw = img.width * sc;
      const dh = img.height * sc;
      ctx.save();
      ctx.shadowColor = 'rgb(0 0 0 / .5)';
      ctx.shadowBlur = 40 * k;
      ctx.drawImage(img, (W - dw) / 2, room.y + (room.h - dh) / 2, dw, dh);
      ctx.restore();
    } else cover(ctx, img, 0, 0, W, H, z, still ? 0 : (n % 2 ? 1 : -1) * 0.3 * p);
  }
  function studio(t: number) {
    ctx.fillStyle = '#080c1c';
    ctx.fillRect(0, 0, W, H);
    if (keyPic) {
      ctx.globalAlpha *= 0.35;
      ctx.drawImage(blurred(keyPic), -W * 0.06, -H * 0.06, W * 1.12, H * 1.12);
      ctx.globalAlpha /= 0.35;
    }
    const glow = (x: number, y: number, r: number, c: string) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, c);
      g.addColorStop(1, 'rgb(8 12 28 / 0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    };
    glow(W * 0.25 + Math.sin(t * 0.21) * 90 * k, H * 0.3, 520 * k, 'rgb(47 79 216 / .42)');
    glow(W * 0.8 + Math.cos(t * 0.17) * 110 * k, H * 0.75, 480 * k, 'rgb(109 79 240 / .32)');
  }
  /** No picture and no footage: a drawn backdrop — the names the story is about in large outlined type drifting
   *  across, a perspective grid, a slow field of linked nodes. Made from the story's own words, nothing invented. */
  function graphic(n: number, t: number) {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#0b1230');
    g.addColorStop(0.55, '#141a4a');
    g.addColorStop(1, '#2a1650');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // The grid floor, vanishing to the middle.
    ctx.save();
    ctx.strokeStyle = 'rgb(138 162 255 / .13)';
    ctx.lineWidth = 1.2 * k;
    const hz = H * 0.58;
    for (let i = -10; i <= 10; i++) {
      ctx.beginPath();
      ctx.moveTo(W / 2 + i * W * 0.02, hz);
      ctx.lineTo(W / 2 + i * W * 0.16, H);
      ctx.stroke();
    }
    const shift = (t * 0.25) % 1;
    for (let j = 0; j < 9; j++) {
      const q = (j + shift) / 9;
      const y = hz + (H - hz) * q * q;
      ctx.globalAlpha = q;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
    ctx.restore();
    // The names, outlined, each row drifting its own way.
    if (names.length) {
      ctx.save();
      const size = Math.round((REEL ? W * 0.2 : H * 0.24));
      ctx.font = `900 ${size}px ${FONT}`;
      ctx.direction = 'ltr';
      ctx.textAlign = 'left';
      ctx.lineWidth = 2 * k;
      const rows = REEL ? 4 : 3;
      for (let r = 0; r < rows; r++) {
        const name = names[(r + n) % names.length];
        const w = ctx.measureText(name).width + size * 0.6;
        const dir = r % 2 ? 1 : -1;
        let x = ((dir * t * 22 * k + r * 180 * k) % w) - w;
        const y = (REEL ? H * 0.12 : H * 0.08) + r * size * 1.02 + size * 0.8;
        ctx.strokeStyle = r === 1 ? 'rgb(255 209 102 / .22)' : 'rgb(255 255 255 / .1)';
        while (x < W) {
          ctx.strokeText(name, x, y);
          x += w;
        }
      }
      ctx.restore();
    }
    // Nodes, linked when close: the network every AI story is about.
    const pts = nodes.map((p) => ({ x: (p.x + Math.sin(t * p.s + p.a) * 0.03) * W, y: (p.y + Math.cos(t * p.s * 0.8 + p.a) * 0.04) * H * 0.62, r: p.r * 3 * k }));
    ctx.save();
    ctx.lineWidth = 1 * k;
    for (let i = 0; i < pts.length; i++)
      for (let j = i + 1; j < pts.length; j++) {
        const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) / Math.max(W, H);
        if (d > 0.2) continue;
        ctx.strokeStyle = `rgb(138 162 255 / ${(0.28 * (1 - d / 0.2)).toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo(pts[i].x, pts[i].y);
        ctx.lineTo(pts[j].x, pts[j].y);
        ctx.stroke();
      }
    for (const p of pts) {
      ctx.fillStyle = 'rgb(200 210 255 / .7)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  function shade(strength = 1) {
    const g = ctx.createLinearGradient(0, REEL ? H * 0.45 : H * 0.42, 0, H);
    g.addColorStop(0, 'rgb(4 6 16 / 0)');
    g.addColorStop(1, `rgb(4 6 16 / ${0.88 * strength})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const top = ctx.createLinearGradient(0, 0, 0, H * 0.2);
    top.addColorStop(0, `rgb(4 6 16 / ${0.55 * strength})`);
    top.addColorStop(1, 'rgb(4 6 16 / 0)');
    ctx.fillStyle = top;
    ctx.fillRect(0, 0, W, H * 0.2);
  }
  /** «ویدیو: @handle»: whose footage this is, as a newscast credits it. */
  function footageCredit(a: number) {
    const who = v.src ? (v.src.handle ? `@${v.src.handle}` : v.src.site) : '';
    const text = who ? `ویدیو: ${who}` : 'ویدیوی منبع';
    ctx.save();
    ctx.globalAlpha = a;
    const size = 17 * k;
    ctx.font = `700 ${size}px ${FONT}`;
    ctx.direction = 'rtl';
    const w = ctx.measureText(text).width + 52 * k;
    const x = M;
    const y = REEL ? H * 0.115 : 82 * k;
    ctx.fillStyle = 'rgb(0 0 0 / .55)';
    rounded(ctx, x, y, w, 34 * k, 17 * k);
    ctx.fill();
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.moveTo(x + 14 * k, y + 10 * k);
    ctx.lineTo(x + 26 * k, y + 17 * k);
    ctx.lineTo(x + 14 * k, y + 24 * k);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'right';
    ctx.fillText(text, x + w - 14 * k, y + 23 * k);
    ctx.restore();
  }

  // ---------- subtitles ----------
  /** The line being said, two rows at a time, centered on a dark band: words said white, the one being said yellow. */
  function subtitles(n: number, t: number, a: number, y = SUB_Y, width = SUB_W, size = SUB) {
    if (!opts.subs) return;
    const s = scenes[n];
    const cur = current(s, t);
    if (cur < 0) return;
    const r = runs[n].findIndex(([x, y2]) => cur >= x && cur < y2);
    if (r < 0) return;
    const rows = subRows(n, r, width, size);
    const rowOf = rows.findIndex((row) => row.some((it) => it.k === cur));
    const page = Math.max(0, Math.floor(rowOf / 2));
    const shown = rows.slice(page * 2, page * 2 + 2);
    const lh = size * 1.55;
    const span = (row: Placed[]) => (row.length ? Math.max(...row.map((it) => it.x + it.w)) - Math.min(...row.map((it) => it.x)) : 0);
    ctx.save();
    ctx.globalAlpha *= a;
    // The band: as wide as the longest row, behind both.
    const bw = Math.max(...shown.map(span)) + size * 1.2;
    const top = y + (-(shown.length - 1)) * lh - size * 1.05;
    ctx.fillStyle = 'rgb(4 6 16 / .58)';
    rounded(ctx, (W - bw) / 2, top, bw, shown.length * lh + size * 0.35, size * 0.5);
    ctx.fill();
    ctx.font = `600 ${size}px ${FONT}`;
    shown.forEach((row, i) => {
      const left = Math.min(...row.map((it) => it.x));
      const x0 = (W - span(row)) / 2 - left;
      const yy = y + (i - (shown.length - 1)) * lh;
      for (const it of row) {
        const w = s.words[it.k];
        ctx.fillStyle = it.k === cur ? YELLOW : it.k < cur ? '#ffffff' : 'rgb(255 255 255 / .62)';
        ctx.direction = it.ltr ? 'ltr' : 'rtl';
        ctx.textAlign = 'left';
        ctx.fillText(w.text, x0 + it.x, yy);
      }
    });
    ctx.restore();
  }
  /** A number popping up large as it's said, counting up, a ring bursting behind it. */
  function callouts(n: number, t: number, a: number) {
    const c = extra[n].callouts.find((c) => t >= c.from && t < c.to);
    if (!c) return;
    const p = Math.min(ease((t - c.from) / 0.15), ease((c.to - t) / 0.2));
    const sc = 0.8 + 0.2 * back((t - c.from) / 0.35);
    ctx.save();
    ctx.globalAlpha *= a * p;
    // Where nothing else is: beside the source card (it's on the right), else top right.
    const left = scenes[n].shot === 'source';
    ctx.translate(REEL ? W / 2 : left ? M + 170 * k : W - M - 160 * k, REEL ? (left ? H * 0.62 : H * 0.2) : H * 0.26);
    const burst = ease((t - c.from) / 0.7);
    if (burst < 1) {
      ctx.strokeStyle = `rgb(255 209 102 / ${(0.6 * (1 - burst)).toFixed(3)})`;
      ctx.lineWidth = 6 * k * (1 - burst) + 1;
      ctx.beginPath();
      ctx.arc(0, -26 * k, (40 + 120 * burst) * k, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.scale(sc, sc);
    ctx.font = `900 ${82 * k}px ${FONT}`;
    ctx.direction = 'rtl';
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgb(0 0 0 / .6)';
    ctx.shadowBlur = 30 * k;
    ctx.fillStyle = YELLOW;
    ctx.fillText(countUp(c.text, ease((t - c.from) / 0.7)), 0, 0, W * 0.5);
    ctx.restore();
  }

  // ---------- the shots ----------
  function sourceCard(s: FilmScene, t: number, a: number) {
    const src = v.src;
    if (!src) return;
    const p = ease((t - s.from - 0.3) / 0.7);
    const w = REEL ? W - 2 * M : Math.min(620 * k, W * 0.48);
    const x = REEL ? M : W - M - w;
    const body = src.text || src.title || '';
    ctx.font = `500 ${24 * k}px system-ui, sans-serif`;
    const lines = wrapLtr(body, w - 56 * k);
    const shown = lines.slice(0, REEL ? 9 : 6);
    const h = 130 * k + shown.length * 36 * k + 40 * k;
    const y = (REEL ? H * 0.16 : H * 0.15) + (1 - p) * 40 * k;
    ctx.save();
    ctx.globalAlpha *= a * p;
    ctx.shadowColor = 'rgb(0 0 0 / .5)';
    ctx.shadowBlur = 50 * k;
    ctx.shadowOffsetY = 20 * k;
    ctx.fillStyle = '#ffffff';
    rounded(ctx, x, y, w, h, 24 * k);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    // Avatar, name, handle, where.
    const ax = x + 28 * k;
    const ay = y + 30 * k;
    const ar = 30 * k;
    ctx.save();
    ctx.beginPath();
    ctx.arc(ax + ar, ay + ar, ar, 0, Math.PI * 2);
    ctx.clip();
    if (v.avatar) ctx.drawImage(v.avatar, ax, ay, ar * 2, ar * 2);
    else {
      ctx.fillStyle = '#2f4fd8';
      ctx.fillRect(ax, ay, ar * 2, ar * 2);
    }
    ctx.restore();
    ctx.direction = 'ltr';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#0f1419';
    ctx.font = `800 ${24 * k}px system-ui, sans-serif`;
    ctx.fillText(src.name, ax + ar * 2 + 16 * k, ay + 26 * k, w - 200 * k);
    ctx.fillStyle = '#536471';
    ctx.font = `500 ${20 * k}px system-ui, sans-serif`;
    ctx.fillText(src.handle ? `@${src.handle}` : src.site, ax + ar * 2 + 16 * k, ay + 54 * k, w - 200 * k);
    // The platform's mark, drawn: X for a tweet, the domain otherwise.
    ctx.textAlign = 'right';
    ctx.fillStyle = '#0f1419';
    ctx.font = `900 ${28 * k}px system-ui, sans-serif`;
    ctx.fillText(src.kind === 'tweet' ? '𝕏' : src.kind === 'youtube' ? '▶' : '', x + w - 28 * k, ay + 32 * k);
    // The words, as posted, each line brought in as the card settles.
    ctx.textAlign = 'left';
    ctx.font = `500 ${24 * k}px system-ui, sans-serif`;
    shown.forEach((l, i) => {
      const q = ease((t - s.from - 0.6 - i * 0.12) / 0.4);
      ctx.fillStyle = `rgb(15 20 25 / ${(0.15 + 0.85 * q).toFixed(3)})`;
      ctx.fillText(i === shown.length - 1 && lines.length > shown.length ? `${l} …` : l, x + 28 * k, y + 130 * k + i * 36 * k);
    });
    if (src.date) {
      ctx.fillStyle = '#536471';
      ctx.font = `500 ${18 * k}px system-ui, sans-serif`;
      ctx.fillText(new Date(src.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }), x + 28 * k, y + h - 22 * k);
    }
    ctx.restore();
    // «منبع اصلی», on the card's corner, and the claim's status beside it.
    const lw = label('منبع اصلی', x + w, y - 14 * k, a * p, 20 * k);
    if (status) label(status.label, x + w - lw - 10 * k, y - 14 * k, a * p, 20 * k, status.color, '#fff');
  }
  function wrapLtr(text: string, width: number) {
    const out: string[] = [];
    for (const para of text.split(/\n+/)) {
      let line = '';
      for (const w of para.split(/\s+/).filter(Boolean)) {
        const next = line ? `${line} ${w}` : w;
        if (ctx.measureText(next).width > width && line) {
          out.push(line);
          line = w;
        } else line = next;
      }
      if (line) out.push(line);
    }
    return out;
  }

  function points(n: number, t: number, a: number) {
    const s = scenes[n];
    const items: string[] = s.data?.items ?? [];
    const size = Math.round((REEL ? 34 : 27) * k);
    const w = REEL ? W - 2 * M : W * 0.56;
    const x = REEL ? M : W - M - w;
    const laid = items.map((it) => wrap(it, w - 110 * k, size, 600));
    const lh = size * 1.6;
    const gap = 22 * k;
    const h = laid.reduce((sum, l) => sum + Math.min(3, l.rows.length) * lh + gap, 0) + 40 * k;
    const y = REEL ? H * 0.12 : Math.max(110 * k, (H - TK - h) / 2 - 30 * k);
    glass(x, y, w, h, 26 * k, 0.7 * a);
    let yy = y + 30 * k + size;
    laid.forEach((l, i) => {
      const at = s.lineAt[i] ?? s.from;
      const on = t >= at || !!look.cover;
      const now = on && (i === s.lineAt.length - 1 || t < (s.lineAt[i + 1] ?? Infinity));
      const p = look.cover ? 1 : ease((t - at) / 0.4);
      ctx.save();
      ctx.globalAlpha *= a * (on ? 0.35 + 0.65 * p : 0.22);
      // The number in a circle.
      ctx.fillStyle = now ? YELLOW : 'rgb(255 255 255 / .18)';
      ctx.beginPath();
      ctx.arc(x + w - 46 * k, yy - size * 0.35, 22 * k, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = now ? INK : '#fff';
      ctx.font = `900 ${22 * k}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.direction = 'rtl';
      ctx.fillText(new Intl.NumberFormat('fa-IR').format(i + 1), x + w - 46 * k, yy - size * 0.35 + 8 * k);
      ctx.font = `600 ${size}px ${FONT}`;
      drawRows(l.ws, l.rows, x + 30 * k - (1 - p) * 20 * k, yy, lh, () => (now ? '#fff' : 'rgb(255 255 255 / .85)'), 3);
      ctx.restore();
      yy += Math.min(3, l.rows.length) * lh + gap;
    });
  }

  /** The anchor with a card of text beside him or her (explain, term, why): the card's words lit as they're said. With
   *  the anchor off, the card alone, wider. */
  function anchorShot(n: number, t: number, a: number, title: string | null, big?: string) {
    const s = scenes[n];
    const host = opts.anchor;
    if (host) {
      const f = faceAt(t, levelAt(lv, t), s.words[Math.max(0, current(s, t))]?.text ?? '', !!extra[n].callouts.find((c) => t >= c.from && t < c.to), speaking(s, t));
      const enter = ease((t - s.from) / 0.6);
      // Left in landscape, low in a reel; the label under.
      const size = REEL ? W * 0.82 : H * 0.86;
      const ax = REEL ? (W - size) / 2 : M * 0.4 + (1 - enter) * -80 * k;
      const ay = REEL ? H - size * 0.98 : H - size;
      ctx.save();
      ctx.globalAlpha *= a * enter;
      // A spotlight behind.
      const g = ctx.createRadialGradient(ax + size / 2, ay + size * 0.4, 0, ax + size / 2, ay + size * 0.4, size * 0.6);
      g.addColorStop(0, opts.host === 'p' ? 'rgb(42 154 152 / .26)' : 'rgb(255 209 102 / .22)');
      g.addColorStop(1, 'rgb(255 209 102 / 0)');
      ctx.fillStyle = g;
      ctx.fillRect(ax - size * 0.2, ay - size * 0.2, size * 1.4, size * 1.4);
      (opts.host === 'p' ? drawCohost : drawAnchor)(ctx, ax, ay, size, f);
      ctx.font = `600 ${17 * k}px ${FONT}`;
      ctx.direction = 'rtl';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgb(255 255 255 / .75)';
      ctx.fillText(opts.host === 'p' ? COHOST_LABEL : ANCHOR_LABEL, ax + size / 2, REEL ? ay - 10 * k : H - TK - 16 * k);
      ctx.restore();
    }
    // The card.
    const w = REEL ? W - 2 * M : host ? W * 0.5 : W * 0.7;
    const x = REEL ? M : host ? W - M - w : (W - w) / 2;
    const size2 = Math.round((REEL ? 36 : host ? 29 : 32) * k);
    ctx.font = `600 ${size2}px ${FONT}`;
    const rows = layout(ctx, s.words, w - 60 * k);
    const lh = size2 * 1.65;
    const maxRows = REEL ? 7 : 6;
    const cur = current(s, t);
    const rowOf = Math.max(0, rows.findIndex((row) => row.some((it) => it.k === cur)));
    const page = Math.floor(rowOf / maxRows);
    const shown = rows.slice(page * maxRows, page * maxRows + maxRows);
    const head = big ? 130 * k : title ? 80 * k : 30 * k;
    const h = head + shown.length * lh + 30 * k;
    const y = REEL ? H * 0.1 : Math.max(90 * k, (H - TK - h) / 2 - 20 * k);
    const pIn = ease((t - s.from - 0.15) / 0.6);
    ctx.save();
    ctx.globalAlpha *= a * pIn;
    ctx.translate(0, (1 - pIn) * 30 * k);
    glass(x, y, w, h, 28 * k, 0.72);
    if (title) label(title, x + w - 26 * k, y + 44 * k, 1, 22 * k);
    if (big) {
      ctx.font = `900 ${50 * k}px ${FONT}`;
      ctx.direction = isLatin(big) ? 'ltr' : 'rtl';
      ctx.textAlign = 'right';
      ctx.fillStyle = YELLOW;
      ctx.fillText(big, x + w - 30 * k, y + 118 * k, w - 60 * k);
    }
    ctx.font = `600 ${size2}px ${FONT}`;
    drawRows(s.words, shown, x + 30 * k, y + head + size2, lh, (kk) => (look.cover || kk === cur ? (look.cover ? '#fff' : YELLOW) : kk < cur ? '#fff' : 'rgb(255 255 255 / .55)'));
    ctx.restore();
  }

  function numbers(n: number, t: number, a: number) {
    const s = scenes[n];
    const bars: { model: string; bench: string; value: number; label: string }[] = s.data?.bars ?? [];
    if (!bars.length) return;
    const max = Math.max(...bars.map((b) => b.value)) <= 100 ? 100 : Math.max(...bars.map((b) => b.value));
    const w = REEL ? W - 2 * M : W * 0.66;
    const x = (W - w) / 2;
    const rowH = (REEL ? 96 : 70) * k;
    const h = bars.length * rowH + 60 * k;
    const y = REEL ? H * 0.14 : Math.max(100 * k, (H - TK - h) / 2 - 50 * k);
    glass(x, y, w, h, 24 * k, 0.7 * a);
    bars.forEach((b, i) => {
      const p = look.cover ? 1 : ease((t - s.from - 0.4 - i * 0.25) / 0.9);
      const yy = y + 40 * k + i * rowH;
      const bw = (w - 340 * k) * (b.value / max) * p;
      ctx.save();
      ctx.globalAlpha *= a;
      ctx.direction = 'ltr';
      ctx.textAlign = 'left';
      ctx.fillStyle = '#fff';
      ctx.font = `700 ${21 * k}px ${FONT}`;
      ctx.fillText(b.model, x + 30 * k, yy + 20 * k, 260 * k);
      ctx.fillStyle = 'rgb(255 255 255 / .6)';
      ctx.font = `500 ${16 * k}px ${FONT}`;
      ctx.fillText(b.bench, x + 30 * k, yy + 44 * k, 260 * k);
      const g = ctx.createLinearGradient(x + 300 * k, 0, x + 300 * k + bw, 0);
      g.addColorStop(0, '#2f4fd8');
      g.addColorStop(1, i === 0 ? YELLOW : '#8aa2ff');
      ctx.fillStyle = g;
      rounded(ctx, x + 300 * k, yy + 4 * k, Math.max(4, bw), 34 * k, 17 * k);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = `800 ${22 * k}px ${FONT}`;
      ctx.globalAlpha *= p;
      ctx.fillText(countUp(b.label, p), x + 312 * k + bw, yy + 30 * k);
      ctx.restore();
    });
  }

  function context(n: number, t: number, a: number) {
    const s = scenes[n];
    const items: { date: string; title: string }[] = s.data?.items ?? [];
    const w = REEL ? W - 2 * M : W * 0.6;
    const x = (W - w) / 2;
    const rowH = (REEL ? 120 : 92) * k;
    const y = REEL ? H * 0.12 : Math.max(90 * k, (H - TK - (items.length + 1) * rowH) / 2 - 40 * k);
    const lineX = x + w - 40 * k;
    const all = [...items, { date: v.date, title: v.title, now: true } as { date: string; title: string; now?: boolean }];
    ctx.save();
    ctx.globalAlpha *= a;
    const ga = ctx.globalAlpha;
    ctx.strokeStyle = 'rgb(255 255 255 / .25)';
    ctx.lineWidth = 3 * k;
    ctx.beginPath();
    ctx.moveTo(lineX, y);
    ctx.lineTo(lineX, y + (all.length - 1) * rowH * (look.cover ? 1 : ease((t - s.from) / 1.2)));
    ctx.stroke();
    all.forEach((it, i) => {
      const p = look.cover ? 1 : ease((t - s.from - 0.3 - i * 0.45) / 0.5);
      const yy = y + i * rowH;
      const now = 'now' in it;
      ctx.globalAlpha = ga * p;
      ctx.fillStyle = now ? YELLOW : '#8aa2ff';
      ctx.beginPath();
      ctx.arc(lineX, yy, (now ? 13 : 9) * k, 0, Math.PI * 2);
      ctx.fill();
      ctx.direction = 'rtl';
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgb(255 255 255 / .6)';
      ctx.font = `600 ${18 * k}px ${FONT}`;
      ctx.fillText(now ? `امروز · ${day(it.date)}` : day(it.date), lineX - 30 * k, yy - 10 * k);
      ctx.fillStyle = '#fff';
      ctx.font = `${now ? 800 : 600} ${(REEL ? 30 : 24) * k}px ${FONT}`;
      ctx.fillText(it.title, lineX - 30 * k, yy + 24 * k, w - 80 * k);
    });
    ctx.restore();
  }

  function quiz(n: number, t: number, a: number) {
    const s = scenes[n];
    const q: { q: string; options: string[]; answer: number } = s.data;
    if (!q) return;
    const reveal = s.lineAt[1] ?? Infinity;
    const askEnd = s.words.filter((w) => w.from < reveal).at(-1)?.to ?? s.from + 2;
    const w = REEL ? W - 2 * M : W * 0.62;
    const x = (W - w) / 2;
    const size = Math.round((REEL ? 36 : 30) * k);
    const ql = wrap(q.q, w - 60 * k, size, 800);
    const y = REEL ? H * 0.1 : 90 * k;
    const qh = ql.rows.length * size * 1.55 + 70 * k;
    const pIn = ease((t - s.from) / 0.5);
    ctx.save();
    ctx.globalAlpha *= a * pIn;
    const ga = ctx.globalAlpha;
    glass(x, y, w, qh, 26 * k, 0.75);
    label('یک سؤال', x + w - 26 * k, y + 2 * k, 1, 20 * k);
    ctx.font = `800 ${size}px ${FONT}`;
    drawRows(ql.ws, ql.rows, x + 30 * k, y + 50 * k + size, size * 1.55, () => '#fff');
    // The options.
    const oh = (REEL ? 100 : 74) * k;
    q.options.forEach((o, i) => {
      const oy = y + qh + 24 * k + i * (oh + 16 * k);
      const p = ease((t - s.from - 0.5 - i * 0.2) / 0.4);
      const shown = t >= reveal;
      const right = i === q.answer;
      ctx.globalAlpha = ga * p * (shown && !right ? 0.4 : 1);
      ctx.fillStyle = shown && right ? '#1f9d55' : 'rgb(255 255 255 / .1)';
      rounded(ctx, x, oy, w, oh, 18 * k);
      ctx.fill();
      ctx.strokeStyle = shown && right ? '#7ee2a8' : 'rgb(255 255 255 / .25)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = `800 ${24 * k}px ${FONT}`;
      ctx.direction = 'rtl';
      ctx.textAlign = 'center';
      ctx.fillText(['الف', 'ب', 'ج', 'د'][i] ?? '', x + w - 40 * k, oy + oh / 2 + 9 * k);
      const ol = wrap(o, w - 120 * k, Math.round((REEL ? 28 : 23) * k), 600);
      ctx.font = `600 ${Math.round((REEL ? 28 : 23) * k)}px ${FONT}`;
      const lines = Math.min(2, ol.rows.length);
      drawRows(ol.ws, ol.rows, x + 30 * k, oy + oh / 2 + 8 * k - ((lines - 1) * 32 * k) / 2, 32 * k, () => '#fff', 2);
      if (shown && right) {
        ctx.fillStyle = '#fff';
        ctx.font = `900 ${30 * k}px ${FONT}`;
        ctx.textAlign = 'left';
        ctx.fillText('✓', x + 20 * k, oy + oh / 2 + 10 * k);
      }
    });
    // The countdown between the question and its answer.
    if (t >= askEnd && t < reveal) {
      const left = reveal - t;
      const span = reveal - askEnd;
      const cx = REEL ? W / 2 : x - 90 * k;
      const cy = REEL ? H * 0.86 : y + qh / 2;
      ctx.globalAlpha = ga;
      ctx.strokeStyle = 'rgb(255 255 255 / .2)';
      ctx.lineWidth = 8 * k;
      ctx.beginPath();
      ctx.arc(cx, cy, 44 * k, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = YELLOW;
      ctx.beginPath();
      ctx.arc(cx, cy, 44 * k, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (left / span));
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = `900 ${40 * k}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(new Intl.NumberFormat('fa-IR').format(Math.ceil(left)), cx, cy + 14 * k);
    }
    ctx.restore();
  }

  /** The headline, revealed as it's said: each word rises out of its row, a Latin name gets a yellow marker swept
   *  under it, the kicker and the claim's status above, where it's from and when below. */
  function hook(n: number, t: number, a: number) {
    const s = scenes[n];
    const size = Math.round((REEL ? 62 : 54) * k);
    ctx.font = `900 ${size}px ${FONT}`;
    const width = REEL ? W - 2 * M : W * 0.8;
    const rows = layout(ctx, s.words, width);
    const lh = size * 1.42;
    const y0 = (REEL ? H * 0.7 : H * 0.74 - TK * 0.6) - (rows.length - 1) * lh;
    // A band of shade under the headline, whatever the picture.
    const band = ctx.createLinearGradient(0, y0 - size * 2.6, 0, H);
    band.addColorStop(0, 'rgb(4 6 16 / 0)');
    band.addColorStop(0.35, `rgb(4 6 16 / ${0.78 * a})`);
    band.addColorStop(1, `rgb(4 6 16 / ${0.92 * a})`);
    ctx.fillStyle = band;
    ctx.fillRect(0, y0 - size * 2.6, W, H);
    const pIn = look.cover ? 1 : ease((t - s.from) / 0.5);
    let lx = W - M;
    if (s.head) lx -= label(s.head, lx, y0 - size - 30 * k, a * pIn, 24 * k) + 10 * k;
    if (status) lx -= label(status.label, lx, y0 - size - 30 * k, a * pIn, 24 * k, status.color, '#fff') + 10 * k;
    if ((v.meta?.importance ?? 0) >= 4) label('خبر مهم', lx, y0 - size - 30 * k, a * pIn, 24 * k, '#d92d3a', '#fff');
    ctx.save();
    ctx.globalAlpha *= a;
    const ga = ctx.globalAlpha;
    const cur = current(s, t);
    const x0 = W - M - width;
    rows.forEach((row, r) => {
      const yy = y0 + r * lh;
      // Each row is its own mask: a word comes up from under its line.
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, yy - size * 1.15, W, size * 1.55);
      ctx.clip();
      // The marker under a name (a run of Latin words, «Mistral Large»): one box, swept in from its start once said.
      for (let i = 0; i < row.length; ) {
        let j = i;
        while (j + 1 < row.length && row[i].ltr && row[j + 1].ltr && row[j + 1].k === row[j].k + 1) j++;
        const first = row[i];
        if (first.ltr && (look.cover || cur >= first.k)) {
          const left = Math.min(...row.slice(i, j + 1).map((it) => it.x));
          const right = Math.max(...row.slice(i, j + 1).map((it) => it.x + it.w));
          const m = look.cover ? 1 : ease((t - s.words[first.k].from) / 0.35);
          ctx.globalAlpha = ga;
          ctx.fillStyle = YELLOW;
          rounded(ctx, x0 + left - 8 * k, yy - size * 0.82, (right - left + 16 * k) * m, size * 1.08, 8 * k);
          ctx.fill();
        }
        i = j + 1;
      }
      for (const it of row) {
        const w = s.words[it.k];
        const p = look.cover || cur >= it.k ? 1 : ease((t - w.from + 0.3) / 0.3);
        const lift = (1 - (look.cover ? 1 : ease((t - w.from + 0.35) / 0.35))) * size * 0.9;
        ctx.globalAlpha = ga * (0.25 + 0.75 * p);
        ctx.fillStyle = it.ltr && (look.cover || cur >= it.k) ? INK : cur === it.k ? YELLOW : '#fff';
        ctx.shadowColor = it.ltr && (look.cover || cur >= it.k) ? 'transparent' : 'rgb(0 0 0 / .8)';
        ctx.shadowBlur = 24 * k;
        ctx.direction = it.ltr ? 'ltr' : 'rtl';
        ctx.textAlign = 'left';
        ctx.fillText(w.text, x0 + it.x, yy + lift);
      }
      ctx.restore();
    });
    ctx.restore();
    // Where it comes from, and when.
    ctx.save();
    ctx.globalAlpha *= a * 0.85;
    ctx.font = `500 ${20 * k}px ${FONT}`;
    ctx.direction = 'rtl';
    ctx.textAlign = 'right';
    ctx.fillStyle = '#fff';
    ctx.fillText([v.src ? `منبع: ${v.src.site}` : '', day(v.date)].filter(Boolean).join(' · '), W - M, y0 + rows.length * lh + 6 * k);
    ctx.restore();
  }

  function letterbox(p: number) {
    if (p <= 0) return;
    const bar = (REEL ? H * 0.06 : H * 0.1) * p;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, bar);
    ctx.fillRect(0, H - bar, W, bar);
  }

  function ticker(t: number, a: number) {
    if (!TK || !strip) return;
    const y = H - TK;
    ctx.save();
    ctx.globalAlpha *= a;
    ctx.fillStyle = 'rgb(8 11 28 / .92)';
    ctx.fillRect(0, y, W, TK);
    ctx.fillStyle = YELLOW;
    ctx.fillRect(0, y, W, 2 * k);
    // «تیتر خبرها» on the right, where reading starts; the headlines slide out from under it.
    const lw = 150 * k;
    const lx = W - lw;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, y, lx, TK);
    ctx.clip();
    const speed = 70 * k;
    const off = (t * speed) % strip.width;
    for (let x = off - strip.width; x < lx; x += strip.width) ctx.drawImage(strip, x, y);
    ctx.restore();
    const g = ctx.createLinearGradient(lx - 40 * k, 0, lx, 0);
    g.addColorStop(0, 'rgb(8 11 28 / 0)');
    g.addColorStop(1, 'rgb(8 11 28 / 1)');
    ctx.fillStyle = g;
    ctx.fillRect(lx - 40 * k, y + 2 * k, 40 * k, TK - 2 * k);
    ctx.fillStyle = '#2f4fd8';
    ctx.fillRect(lx, y + 2 * k, lw, TK - 2 * k);
    ctx.fillStyle = '#fff';
    ctx.font = `800 ${18 * k}px ${FONT}`;
    ctx.direction = 'rtl';
    ctx.textAlign = 'center';
    ctx.fillText('تیتر خبرها', lx + lw / 2, y + TK / 2 + 7 * k);
    ctx.restore();
  }

  function chrome(t: number, n: number) {
    // The mark, top right; the shot's name, top left as a kicker; progress along the bottom (top in a reel).
    ctx.save();
    logo(ctx, W - M - 16 * k, 46 * k, 16 * k);
    ctx.fillStyle = '#fff';
    ctx.font = `800 ${21 * k}px ${FONT}`;
    ctx.direction = 'rtl';
    ctx.textAlign = 'right';
    ctx.fillText(SITE.name, W - M - 42 * k, 54 * k);
    const head = scenes[n].head;
    if (head && scenes[n].shot !== 'hook' && !look.cover) {
      ctx.globalAlpha = ease((t - scenes[n].from) / 0.5) * 0.95;
      ctx.font = `800 ${19 * k}px ${FONT}`;
      const hw = ctx.measureText(head).width;
      ctx.fillStyle = YELLOW;
      ctx.fillRect(M, 34 * k, 5 * k, 28 * k);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#fff';
      ctx.fillText(head, M + 14 * k, 54 * k, Math.max(hw, 10));
    }
    ctx.globalAlpha = 1;
    if (!look.cover) {
      const py = REEL ? 14 * k : H - TK - 5 * k;
      const p = Math.min(1, Math.max(0, (t - FILM_INTRO) / (outro - FILM_INTRO)));
      ctx.fillStyle = 'rgb(255 255 255 / .15)';
      ctx.fillRect(0, py, W, 4 * k);
      ctx.fillStyle = YELLOW;
      ctx.fillRect(W - W * p, py, W * p, 4 * k);
    }
    ctx.restore();
  }

  function shot(n: number, t: number, a: number) {
    const s = scenes[n];
    const local = t - s.from;
    const span = s.to - s.from;
    const studioShot = STUDIO.includes(s.shot);
    const ct = s.clipAt != null && v.footage ? s.clipAt + Math.max(0, local) : null;
    const frame = ct != null && ct < v.footage!.duration - 0.05 ? (v.footage!.frame() as Img | null) : null;
    ctx.save();
    ctx.globalAlpha = a;
    let drawn = !studioShot;
    if (studioShot) studio(t);
    else if (frame && !look.cover) picture(frame, n, local, span, true);
    else if (s.pics.length) {
      const share = span / s.pics.length;
      // Drawn a little before its start (the opening's dissolve) and after its end (the next shot's): clamped.
      const i = Math.max(0, Math.min(s.pics.length - 1, Math.floor(local / share)));
      picture(s.pics[i], n + i, Math.max(0, local - i * share), share);
      if (i > 0 && local - i * share < 0.6) {
        ctx.globalAlpha = a * (1 - ease((local - i * share) / 0.6));
        picture(s.pics[i - 1], n + i - 1, share, share);
        ctx.globalAlpha = a;
      }
    } else {
      graphic(n, t);
      drawn = false;
    }
    ctx.drawImage(vignette, 0, 0);
    shade(studioShot ? 0.4 : drawn ? 1 : 0.6);
    ctx.restore();
    if (frame && !look.cover) footageCredit(a * ease(local / 0.5));
    ctx.save();
    ctx.globalAlpha = a;
    switch (s.shot) {
      case 'hook':
        hook(n, t, 1);
        ctx.restore();
        return;
      case 'source':
        sourceCard(s, t, 1);
        break;
      case 'points':
        points(n, t, 1);
        break;
      case 'explain':
      case 'why':
        anchorShot(n, t, 1, s.head);
        ctx.restore();
        return;
      case 'term':
        anchorShot(n, t, 1, s.head, s.data?.term);
        ctx.restore();
        return;
      case 'numbers':
        numbers(n, t, 1);
        break;
      case 'context':
        context(n, t, 1);
        break;
      case 'quiz':
        quiz(n, t, 1);
        ctx.restore();
        return;
    }
    if (s.shot !== 'points') {
      callouts(n, t, 1);
      subtitles(n, t, 1);
    }
    ctx.restore();
  }

  /** The brand's bars sweeping across, right to left, covering the cut at their middle (into the explainer shots). */
  function stinger(p: number) {
    const bars = [
      { c: '#2f4fd8', d: -0.1 },
      { c: '#6d4ff0', d: 0 },
      { c: YELLOW, d: 0.1 },
    ];
    ctx.save();
    for (const b of bars) {
      const q = Math.min(1, Math.max(0, p + b.d));
      const x = W - q * W * 2.6;
      const skew = H * 0.35;
      ctx.fillStyle = b.c;
      ctx.beginPath();
      ctx.moveTo(x + skew, 0);
      ctx.lineTo(x + W * 1.6 + skew, 0);
      ctx.lineTo(x + W * 1.6, H);
      ctx.lineTo(x, H);
      ctx.closePath();
      ctx.fill();
    }
    const m = 1 - Math.abs(p - 0.5) * 6;
    if (m > 0) logo(ctx, W / 2, H / 2, 54 * k * Math.min(1, m * 1.5));
    ctx.restore();
  }

  function opening(t: number) {
    ctx.fillStyle = '#05070f';
    ctx.fillRect(0, 0, W, H);
    const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.6);
    g.addColorStop(0, `rgb(47 79 216 / ${0.35 * ease(t / 1.5)})`);
    g.addColorStop(1, 'rgb(5 7 15 / 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // A light sweep across, the logo drawing itself, the name rising.
    const sweep = ease(t / 1.6);
    const sg = ctx.createLinearGradient(W * (1.2 - sweep * 1.6), 0, W * (1.5 - sweep * 1.6), H);
    sg.addColorStop(0, 'rgb(255 255 255 / 0)');
    sg.addColorStop(0.5, 'rgb(255 255 255 / .06)');
    sg.addColorStop(1, 'rgb(255 255 255 / 0)');
    ctx.fillStyle = sg;
    ctx.fillRect(0, 0, W, H);
    const grow = back(t / 0.6);
    if (grow > 0) logo(ctx, W / 2, H / 2 - 50 * k, 64 * k * grow, ease((t - 0.25) / 0.7), back((t - 0.9) / 0.35));
    ctx.textAlign = 'center';
    ctx.direction = 'rtl';
    const a1 = ease((t - 1) / 0.5);
    ctx.globalAlpha = a1;
    ctx.fillStyle = '#fff';
    ctx.font = `900 ${58 * k}px ${FONT}`;
    ctx.fillText(SITE.name, W / 2, H / 2 + 70 * k + (1 - a1) * 16 * k);
    const a2 = ease((t - 1.4) / 0.5);
    ctx.globalAlpha = a2;
    ctx.fillStyle = 'rgb(255 255 255 / .7)';
    ctx.font = `500 ${24 * k}px ${FONT}`;
    ctx.fillText([v.meta?.type, 'فیلم کوتاه خبری', day(v.date)].filter(Boolean).join(' · '), W / 2, H / 2 + 120 * k);
    ctx.globalAlpha = 1;
  }

  function closing(t: number) {
    const a = ease((t - outro) / 0.6);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgb(5 7 15 / .96)';
    ctx.fillRect(0, 0, W, H);
    logo(ctx, W / 2, H * 0.36, 50 * k, ease((t - outro - 0.1) / 0.6), back((t - outro - 0.5) / 0.35));
    ctx.textAlign = 'center';
    ctx.direction = 'rtl';
    ctx.fillStyle = '#fff';
    ctx.font = `900 ${50 * k}px ${FONT}`;
    ctx.fillText(SITE.name, W / 2, H * 0.36 + 110 * k);
    ctx.fillStyle = 'rgb(255 255 255 / .75)';
    ctx.font = `500 ${24 * k}px ${FONT}`;
    ctx.fillText('متن کامل و منبع این خبر:', W / 2, H * 0.36 + 170 * k);
    ctx.direction = 'ltr';
    ctx.fillStyle = YELLOW;
    ctx.font = `700 ${30 * k}px ${FONT}`;
    ctx.fillText(link, W / 2, H * 0.36 + 220 * k);
    ctx.fillStyle = 'rgb(255 255 255 / .5)';
    ctx.font = `500 ${18 * k}px ${FONT}`;
    ctx.direction = 'rtl';
    const by = opts.host === 'p' ? 'پریسا' : 'داش غلام';
    ctx.fillText(`روایت و مجری (${by}) با هوش مصنوعی · متن خبر: داش غلام${v.footage ? ' · ویدیو از منبع خبر' : ''}`, W / 2, H * 0.36 + 270 * k, W - 2 * M);
    ctx.restore();
    letterbox(ease((t - outro) / 0.8));
  }

  if (look.cover) {
    // The film's cover (its poster, the cinema's thumbnail): the hook with the headline whole, no motion.
    return (_t: number) => {
      const s = scenes[0];
      ctx.globalAlpha = 1;
      shot(0, s.from + Math.min(2, (s.to - s.from) / 2), 1);
      chrome(s.from + 1, 0);
      // A play mark, so it reads as a video in a list.
      ctx.save();
      ctx.fillStyle = 'rgb(0 0 0 / .45)';
      ctx.beginPath();
      ctx.arc(M + 40 * k, (REEL ? H * 0.12 : 90 * k) + 4 * k, 34 * k, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      const cx = M + 44 * k;
      const cy = (REEL ? H * 0.12 : 90 * k) + 4 * k;
      ctx.moveTo(cx - 10 * k, cy - 15 * k);
      ctx.lineTo(cx + 15 * k, cy);
      ctx.lineTo(cx - 10 * k, cy + 15 * k);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };
  }

  /** Shots the stinger leads into: an explainer after a shot of the story itself (not the quiz: that dips to black). */
  const stung = scenes.map((s, i) => i > 0 && STUDIO.includes(s.shot) && s.shot !== 'quiz' && !STUDIO.includes(scenes[i - 1].shot));
  const STING_LEAD = 0.35;
  const STING = 0.9;

  return (t: number) => {
    ctx.globalAlpha = 1;
    if (t < FILM_INTRO - 0.5) {
      opening(t);
      letterbox(1);
      return;
    }
    const n = sceneAt(t);
    const into = (t - scenes[n].from) / 0.6;
    // A stinger around this shot's start or the next one's: the cut is hidden at its middle.
    const m = stung[n] && t - scenes[n].from < STING - STING_LEAD ? n : n + 1 < scenes.length && stung[n + 1] && t > scenes[n + 1].from - STING_LEAD ? n + 1 : -1;
    const sp = m >= 0 ? (t - scenes[m].from + STING_LEAD) / STING : -1;
    if (t < FILM_INTRO) {
      opening(t);
      ctx.globalAlpha = ease((t - (FILM_INTRO - 0.5)) / 0.5);
      shot(0, t, ctx.globalAlpha);
      ctx.globalAlpha = 1;
    } else if (m >= 0) shot(sp < 0.5 ? m - 1 : m, t, 1);
    else if (n > 0 && into < 1) {
      // A cross-dissolve between shots; a dip through black before the quiz.
      if (scenes[n].shot === 'quiz') {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, W, H);
        if (into < 0.5) shot(n - 1, t, 1 - into * 2);
        else shot(n, t, (into - 0.5) * 2);
      } else {
        shot(n - 1, t, 1);
        shot(n, t, ease(into));
      }
    } else shot(n, t, 1);
    if (t >= FILM_INTRO && t < outro + 0.6) ticker(t, ease((t - FILM_INTRO - 0.8) / 0.6));
    if (t >= FILM_INTRO) chrome(t, n);
    if (m >= 0) stinger(sp);
    // The opening's letterbox opens out over the first shot.
    if (n === 0) letterbox(1 - ease((t - FILM_INTRO - 1.2) / 1));
    if (t >= outro) closing(t);
  };
}

// ---------- the sound: voice, a music bed under it, the clip's own sound, a hit on each cut ----------
/** Mood chords for the bed (Hz, a minor-ish progression, four bars of 4 s each), soft and low under the voice. */
const CHORDS = [
  [110, 164.81, 220, 261.63],
  [87.31, 130.81, 174.61, 220],
  [98, 146.83, 196, 246.94],
  [82.41, 123.47, 164.81, 207.65],
];
export function filmSound(v: FilmVideo, rate: number): AudioBuffer {
  const sound = new AudioBuffer({ numberOfChannels: 1, sampleRate: rate, length: Math.ceil(v.total * rate) });
  const out = sound.getChannelData(0);
  const lv = levels(v.clips, rate, v.total);
  const end = v.total;
  const duck = (t: number) => 1 - 0.68 * Math.min(1, levelAt(lv, t) * 2.2);
  if (v.opts.music) {
    // The bed: soft detuned pads, a slow swell, a soft pulse on the beat; ducked while the voice speaks, and lower
    // under the source's own sound.
    const natOn = (t: number) => v.nat.some((c) => t >= c.at && t < c.at + c.pcm.length / rate);
    for (let i = 0; i < out.length; i++) {
      const t = i / rate;
      const bar = Math.floor(t / 4) % CHORDS.length;
      const inBar = (t % 4) / 4;
      const env = Math.min(1, t / 2.5) * Math.min(1, (end - t) / 2.5) * (0.75 + 0.25 * Math.sin(Math.PI * inBar));
      let s = 0;
      for (const f of CHORDS[bar]) s += Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(2 * Math.PI * f * 1.003 * t);
      const beat = t % 1;
      const pulse = 0.35 * Math.exp(-beat * 14) * Math.sin(2 * Math.PI * 55 * beat);
      out[i] = (0.012 * s + 0.05 * pulse) * env * duck(t) * (v.nat.length && natOn(t) ? 0.5 : 1);
    }
  }
  // The clip's own sound: low under the voice, a little up where it's quiet.
  for (const c of v.nat) {
    const o = Math.round(c.at * rate);
    const len = c.pcm.length;
    for (let i = 0; i < len && o + i < out.length; i++) {
      const t = (o + i) / rate;
      const fade = Math.min(1, i / (0.4 * rate), (len - i) / (0.4 * rate));
      out[o + i] += c.pcm[i] * fade * (0.08 + 0.17 * (1 - Math.min(1, levelAt(lv, t) * 3)));
    }
  }
  // A low boom at the opening and the close, a soft whoosh on each cut.
  const boom = (at: number) => {
    const o = Math.round(at * rate);
    for (let i = 0; i < 1.6 * rate && o + i < out.length; i++) {
      const s = i / rate;
      out[o + i] += 0.22 * Math.exp(-s * 2.6) * Math.sin(2 * Math.PI * (52 - 14 * s) * s);
    }
  };
  const whoosh = (at: number, gain = 0.07) => {
    const o = Math.round(at * rate);
    const len = Math.round(0.5 * rate);
    let lp = 0;
    for (let i = 0; i < len && o + i < out.length; i++) {
      const x = i / len;
      lp += (0.02 + 0.2 * (1 - x)) * (Math.random() * 2 - 1 - lp);
      out[o + i] += gain * Math.sin(Math.PI * x) ** 2 * lp;
    }
  };
  boom(0.2);
  v.scenes.slice(1).forEach((s, i) => whoosh(s.from - 0.15, STUDIO.includes(s.shot) && !STUDIO.includes(v.scenes[i].shot) ? 0.14 : 0.07));
  boom(v.outro);
  for (const c of v.clips) {
    const o = Math.round(c.at * rate);
    for (let i = 0; i < c.pcm.length && o + i < out.length; i++) out[o + i] += c.pcm[i];
  }
  for (let i = 0; i < out.length; i++) out[i] = Math.max(-1, Math.min(1, out[i]));
  return sound;
}

export { trim };
