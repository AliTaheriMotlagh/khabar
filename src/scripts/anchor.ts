// «داش غلام», the channel's translator, as an illustrated anchor: a friendly Tehran «داش مشتی» — felt hat (کلاه
// مخملی), thick mustache, dark jacket over a white collar — drawn on a canvas, so every part moves on its own: the
// mouth follows the narration's own sound (how loud → how open; which vowel the word holds → its shape), the eyes
// blink, the brows lift on a number, the head nods with the speech. An illustrated character, never a human-looking
// face, and always labelled «مجری هوش مصنوعی» where it appears. No imports, no images: the same code draws him in a
// story's video (src/scripts/video.ts), on the podcast page and in the runner's renders.
//
// Drawn in a 512×512 box (head at the top, shoulders cut by the bottom edge); `drawAnchor` scales it.

export type Face = {
  /** 0 (shut) … 1 (wide open), from the sound's loudness. */
  open: number;
  /** The vowel's shape: «و / او» rounds the lips, «ی / ای» widens them. */
  round: number;
  wide: number;
  /** 0 (open) … 1 (shut). */
  blink: number;
  /** Brows raised, 0 … 1 (a number being said). */
  brow: number;
  /** Head tilt in radians and nod in box units. */
  tilt: number;
  nod: number;
  /** Where he looks: -1 (his right, our left) … 1. */
  look: number;
};

const SKIN = '#f1c39d';
const SKIN_SHADE = '#dc9f78';
const HAIR = '#231915';
const HAT = '#17151c';
const JACKET = '#1c2540';
const JACKET_HI = '#2b3760';

/** Mouth, eyes, brows and head for time `t` (seconds) from the sound's level at `t` (0…1, smoothed by the caller) and
 *  the word being said. Deterministic in `t`, so a frame drawn twice is the same frame. */
export function faceAt(t: number, level: number, word: string, numberSaid: boolean, speaking: boolean): Face {
  const open = speaking ? Math.min(1, Math.max(0, (level - 0.02) * 3.2)) : 0;
  const v = vowelOf(word, t);
  // A blink every 2.6–4.6 s (a hash of the beat), 140 ms long.
  const beat = Math.floor(t / 3.6);
  const at = beat * 3.6 + hash(beat) * 1.8;
  const k = (t - at) / 0.14;
  const blink = k > 0 && k < 1 ? Math.sin(Math.PI * k) : 0;
  const sway = Math.sin(t * 0.9) * 0.02 + Math.sin(t * 2.3) * 0.008;
  return {
    open,
    round: v === 'o' ? 1 : 0,
    wide: v === 'e' ? 1 : 0,
    blink,
    brow: numberSaid ? 1 : speaking ? 0.15 + 0.25 * open : 0,
    tilt: sway + (speaking ? open * 0.025 * Math.sin(t * 5.1) : 0),
    nod: speaking ? open * 5 : Math.sin(t * 1.4) * 1.2,
    look: Math.sin(t * 0.37) * 0.35,
  };
}

/** The word's vowel at this moment: a Persian word's letters taken in order across its length (time-sliced). */
function vowelOf(word: string, t: number): 'a' | 'o' | 'e' | null {
  const vs = [...word].map((c) => (/[اآَa]/i.test(c) ? 'a' : /[وُoOuU]/.test(c) ? 'o' : /[یيِiIeE]/.test(c) ? 'e' : null)).filter(Boolean) as ('a' | 'o' | 'e')[];
  if (!vs.length) return null;
  return vs[Math.floor(t * 7) % vs.length];
}
const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** Draws him with his box's top-left at (x, y), `size` pixels square. */
export function drawAnchor(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, f: Face) {
  const s = size / 512;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  // Shoulders and jacket stay; the head turns about the neck.
  body(ctx, f);
  ctx.save();
  ctx.translate(256, 330 + f.nod);
  ctx.rotate(f.tilt);
  ctx.translate(-256, -330);
  head(ctx, f);
  ctx.restore();
  ctx.restore();
}

function body(ctx: CanvasRenderingContext2D, f: Face) {
  const breathe = Math.sin(f.look * 3) * 1.5;
  // Neck.
  ctx.fillStyle = SKIN_SHADE;
  ctx.beginPath();
  ctx.moveTo(214, 300);
  ctx.lineTo(298, 300);
  ctx.lineTo(304, 392);
  ctx.lineTo(208, 392);
  ctx.closePath();
  ctx.fill();
  // Jacket: shoulders out to the box's edges.
  const g = ctx.createLinearGradient(0, 360, 0, 512);
  g.addColorStop(0, JACKET_HI);
  g.addColorStop(1, JACKET);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(40, 512);
  ctx.bezierCurveTo(46, 430 + breathe, 96, 384 + breathe, 186, 368 + breathe);
  ctx.lineTo(326, 368 + breathe);
  ctx.bezierCurveTo(416, 384 + breathe, 466, 430 + breathe, 472, 512);
  ctx.closePath();
  ctx.fill();
  // White shirt and its open collar.
  ctx.fillStyle = '#f4f1ea';
  ctx.beginPath();
  ctx.moveTo(206, 368 + breathe);
  ctx.lineTo(256, 452);
  ctx.lineTo(306, 368 + breathe);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = SKIN_SHADE;
  ctx.beginPath();
  ctx.moveTo(226, 370 + breathe);
  ctx.lineTo(256, 418);
  ctx.lineTo(286, 370 + breathe);
  ctx.closePath();
  ctx.fill();
  // Collar points.
  ctx.fillStyle = '#ffffff';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(256 + side * 52, 364 + breathe);
    ctx.lineTo(256 + side * 14, 392 + breathe);
    ctx.lineTo(256 + side * 40, 410 + breathe);
    ctx.closePath();
    ctx.fill();
  }
  // Lapels.
  ctx.fillStyle = '#121a30';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(256 + side * 66, 370 + breathe);
    ctx.lineTo(256 + side * 4, 470);
    ctx.lineTo(256 + side * 30, 512);
    ctx.lineTo(256 + side * 92, 512);
    ctx.lineTo(256 + side * 98, 430);
    ctx.closePath();
    ctx.fill();
  }
  // A small pocket square: the site's yellow.
  ctx.fillStyle = '#ffd166';
  ctx.beginPath();
  ctx.moveTo(360, 450);
  ctx.lineTo(392, 444);
  ctx.lineTo(388, 460);
  ctx.lineTo(362, 464);
  ctx.closePath();
  ctx.fill();
}

function head(ctx: CanvasRenderingContext2D, f: Face) {
  // Ears.
  for (const side of [-1, 1]) {
    ctx.fillStyle = SKIN_SHADE;
    ctx.beginPath();
    ctx.ellipse(256 + side * 92, 226, 17, 28, side * 0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#c98864';
    ctx.beginPath();
    ctx.ellipse(256 + side * 94, 228, 7, 14, side * 0.15, 0, Math.PI * 2);
    ctx.fill();
  }
  // Face: a soft egg, lit from the top left.
  const g = ctx.createRadialGradient(226, 190, 20, 256, 230, 130);
  g.addColorStop(0, '#f8d2b0');
  g.addColorStop(0.7, SKIN);
  g.addColorStop(1, SKIN_SHADE);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(256, 110);
  ctx.bezierCurveTo(330, 110, 352, 170, 350, 226);
  ctx.bezierCurveTo(348, 290, 312, 336, 256, 340);
  ctx.bezierCurveTo(200, 336, 164, 290, 162, 226);
  ctx.bezierCurveTo(160, 170, 182, 110, 256, 110);
  ctx.closePath();
  ctx.fill();
  // Stubble along the jaw.
  ctx.save();
  ctx.clip();
  ctx.fillStyle = 'rgb(60 40 32 / .13)';
  ctx.beginPath();
  ctx.ellipse(256, 316, 96, 52, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // Sideburns under the hat.
  ctx.fillStyle = HAIR;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(256 + side * 92, 150);
    ctx.quadraticCurveTo(256 + side * 98, 196, 256 + side * 88, 232);
    ctx.lineTo(256 + side * 80, 228);
    ctx.quadraticCurveTo(256 + side * 82, 186, 256 + side * 74, 156);
    ctx.closePath();
    ctx.fill();
  }
  // Cheeks.
  ctx.fillStyle = 'rgb(232 120 110 / .16)';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(256 + side * 52, 262, 24, 15, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  eyes(ctx, f);
  brows(ctx, f);
  // Nose: a soft shadow and a nostril line.
  ctx.strokeStyle = 'rgb(150 90 60 / .55)';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(250, 214);
  ctx.quadraticCurveTo(240, 250, 248, 262);
  ctx.quadraticCurveTo(258, 268, 268, 260);
  ctx.stroke();
  mouth(ctx, f);
  mustache(ctx, f);
  hat(ctx);
}

function eyes(ctx: CanvasRenderingContext2D, f: Face) {
  const shut = Math.min(1, f.blink);
  for (const side of [-1, 1]) {
    const cx = 256 + side * 40;
    const cy = 214;
    const h = 13 * (1 - shut) + 1.5;
    ctx.fillStyle = '#fffaf4';
    ctx.beginPath();
    ctx.ellipse(cx, cy, 19, h, 0, 0, Math.PI * 2);
    ctx.fill();
    if (shut < 0.8) {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(cx, cy, 19, h, 0, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = '#4a2e1f';
      ctx.beginPath();
      ctx.arc(cx + f.look * 6, cy + 1, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#120b08';
      ctx.beginPath();
      ctx.arc(cx + f.look * 6, cy + 1, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(cx + f.look * 6 - 3.5, cy - 3, 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    // Upper lid line.
    ctx.strokeStyle = '#2a1a12';
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 20, h + 1, 0, Math.PI * 1.05, Math.PI * 1.95);
    ctx.stroke();
  }
}

function brows(ctx: CanvasRenderingContext2D, f: Face) {
  ctx.fillStyle = HAIR;
  for (const side of [-1, 1]) {
    const lift = f.brow * 7;
    ctx.beginPath();
    ctx.moveTo(256 + side * 18, 190 - lift * 0.6);
    ctx.quadraticCurveTo(256 + side * 40, 176 - lift, 256 + side * 64, 186 - lift * 0.8);
    ctx.lineTo(256 + side * 62, 192 - lift * 0.8);
    ctx.quadraticCurveTo(256 + side * 40, 184 - lift, 256 + side * 18, 197 - lift * 0.6);
    ctx.closePath();
    ctx.fill();
  }
}

function mouth(ctx: CanvasRenderingContext2D, f: Face, lips = '#8a3b2e') {
  const cy = 296;
  const open = f.open;
  // Width: narrower for «و», wider for «ی»; a resting smile when shut.
  const w = 30 * (1 - 0.35 * f.round + 0.15 * f.wide);
  const h = 4 + open * (24 - 8 * f.wide + 4 * f.round);
  if (open < 0.06) {
    ctx.strokeStyle = lips;
    ctx.lineWidth = 4.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(256 - 26, cy - 4);
    ctx.quadraticCurveTo(256, cy + 10, 256 + 26, cy - 4);
    ctx.stroke();
    return;
  }
  ctx.save();
  ctx.fillStyle = '#5b1d1a';
  ctx.beginPath();
  if (f.round > 0.5) ctx.ellipse(256, cy + h / 2 - 4, w * 0.7, h / 2 + 2, 0, 0, Math.PI * 2);
  else {
    ctx.moveTo(256 - w, cy - 4);
    ctx.quadraticCurveTo(256, cy - 8, 256 + w, cy - 4);
    ctx.quadraticCurveTo(256 + w * 0.8, cy + h, 256, cy + h + 2);
    ctx.quadraticCurveTo(256 - w * 0.8, cy + h, 256 - w, cy - 4);
  }
  ctx.closePath();
  ctx.fill();
  ctx.clip();
  // Upper teeth and the tongue.
  ctx.fillStyle = '#fbf7f0';
  ctx.fillRect(256 - w, cy - 10, w * 2, 9);
  ctx.fillStyle = '#c4545a';
  ctx.beginPath();
  ctx.ellipse(256, cy + h + 4, w * 0.6, Math.max(4, h * 0.35), 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function mustache(ctx: CanvasRenderingContext2D, f: Face) {
  // Thick and curved down at the ends; it lifts a little as the mouth opens.
  const up = f.open * 3;
  ctx.fillStyle = HAIR;
  ctx.beginPath();
  ctx.moveTo(256, 268 - up);
  ctx.bezierCurveTo(278, 258 - up, 314, 264 - up, 322, 292 - up);
  ctx.bezierCurveTo(312, 286 - up, 300, 286 - up, 290, 288 - up);
  ctx.bezierCurveTo(278, 290 - up, 266, 286 - up, 256, 282 - up);
  ctx.bezierCurveTo(246, 286 - up, 234, 290 - up, 222, 288 - up);
  ctx.bezierCurveTo(212, 286 - up, 200, 286 - up, 190, 292 - up);
  ctx.bezierCurveTo(198, 264 - up, 234, 258 - up, 256, 268 - up);
  ctx.closePath();
  ctx.fill();
  // A sheen.
  ctx.strokeStyle = 'rgb(255 255 255 / .08)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(232, 272 - up);
  ctx.quadraticCurveTo(256, 266 - up, 280, 272 - up);
  ctx.stroke();
}

function hat(ctx: CanvasRenderingContext2D) {
  // The felt hat (کلاه مخملی): a low crown with a dent, a band, a short brim tilted a touch.
  ctx.save();
  ctx.translate(256, 150);
  ctx.rotate(-0.05);
  // Brim.
  ctx.fillStyle = HAT;
  ctx.beginPath();
  ctx.ellipse(0, 4, 128, 22, 0, 0, Math.PI * 2);
  ctx.fill();
  // Crown.
  const g = ctx.createLinearGradient(-90, -80, 90, 0);
  g.addColorStop(0, '#2c2833');
  g.addColorStop(1, HAT);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(-92, 0);
  ctx.bezierCurveTo(-96, -58, -64, -86, 0, -84);
  ctx.bezierCurveTo(64, -86, 96, -58, 92, 0);
  ctx.closePath();
  ctx.fill();
  // The dent along the top.
  ctx.strokeStyle = 'rgb(0 0 0 / .45)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(-44, -76);
  ctx.quadraticCurveTo(0, -60, 44, -76);
  ctx.stroke();
  // Band.
  ctx.fillStyle = '#3a2a1e';
  ctx.beginPath();
  ctx.moveTo(-93, -8);
  ctx.quadraticCurveTo(0, -2, 93, -8);
  ctx.lineTo(92, -24);
  ctx.quadraticCurveTo(0, -18, -92, -24);
  ctx.closePath();
  ctx.fill();
  // Velvet sheen.
  ctx.strokeStyle = 'rgb(255 255 255 / .1)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(-70, -50);
  ctx.quadraticCurveTo(-60, -76, -20, -80);
  ctx.stroke();
  ctx.restore();
}

// ---------- «پریسا», the podcast's second host ----------
// In the same style: a teal headscarf framing the face, dark manteau, the same eyes and mouth (drawn by the same code,
// so both hosts move alike). An illustrated character, labelled as Gholam is.
const SCARF = '#1f7a7a';
const SCARF_HI = '#2a9a98';
export function drawCohost(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, f: Face) {
  const s = size / 512;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  // Manteau and the scarf's fall over the shoulders.
  const g = ctx.createLinearGradient(0, 360, 0, 512);
  g.addColorStop(0, '#2a2f45');
  g.addColorStop(1, '#1a1e30');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(48, 512);
  ctx.bezierCurveTo(54, 430, 104, 386, 190, 372);
  ctx.lineTo(322, 372);
  ctx.bezierCurveTo(408, 386, 458, 430, 464, 512);
  ctx.closePath();
  ctx.fill();
  ctx.save();
  ctx.translate(256, 330 + f.nod);
  ctx.rotate(f.tilt);
  ctx.translate(-256, -330);
  // The scarf behind the head, down to the shoulders.
  const sg = ctx.createLinearGradient(140, 120, 380, 420);
  sg.addColorStop(0, SCARF_HI);
  sg.addColorStop(1, SCARF);
  ctx.fillStyle = sg;
  ctx.beginPath();
  ctx.moveTo(256, 92);
  ctx.bezierCurveTo(352, 92, 380, 170, 376, 250);
  ctx.bezierCurveTo(372, 330, 350, 380, 300, 410);
  ctx.lineTo(212, 410);
  ctx.bezierCurveTo(162, 380, 140, 330, 136, 250);
  ctx.bezierCurveTo(132, 170, 160, 92, 256, 92);
  ctx.closePath();
  ctx.fill();
  // Face.
  const fg = ctx.createRadialGradient(232, 196, 20, 256, 230, 120);
  fg.addColorStop(0, '#f9d6b8');
  fg.addColorStop(0.7, '#f2c6a2');
  fg.addColorStop(1, '#e0a883');
  ctx.fillStyle = fg;
  ctx.beginPath();
  ctx.moveTo(256, 132);
  ctx.bezierCurveTo(320, 132, 340, 182, 338, 230);
  ctx.bezierCurveTo(336, 288, 304, 330, 256, 334);
  ctx.bezierCurveTo(208, 330, 176, 288, 174, 230);
  ctx.bezierCurveTo(172, 182, 192, 132, 256, 132);
  ctx.closePath();
  ctx.fill();
  // A little dark hair at the front, swept to the side under the scarf.
  ctx.fillStyle = '#2b1a14';
  ctx.beginPath();
  ctx.moveTo(186, 178);
  ctx.bezierCurveTo(200, 140, 250, 128, 300, 140);
  ctx.bezierCurveTo(272, 146, 236, 160, 214, 190);
  ctx.closePath();
  ctx.fill();
  // The scarf's front edge, framing the face.
  ctx.strokeStyle = SCARF;
  ctx.lineWidth = 18;
  ctx.beginPath();
  ctx.moveTo(176, 300);
  ctx.bezierCurveTo(158, 220, 176, 128, 256, 120);
  ctx.bezierCurveTo(336, 128, 354, 220, 336, 300);
  ctx.stroke();
  // The scarf wrapped under the chin and draped over the shoulders (it hides the neck).
  const wrap = ctx.createLinearGradient(160, 280, 360, 480);
  wrap.addColorStop(0, SCARF_HI);
  wrap.addColorStop(1, '#17605f');
  ctx.fillStyle = wrap;
  ctx.beginPath();
  ctx.moveTo(172, 270);
  ctx.bezierCurveTo(190, 330, 222, 350, 256, 352);
  ctx.bezierCurveTo(290, 350, 322, 330, 340, 270);
  ctx.bezierCurveTo(372, 330, 396, 400, 404, 470);
  ctx.bezierCurveTo(330, 492, 182, 492, 108, 470);
  ctx.bezierCurveTo(116, 400, 140, 330, 172, 270);
  ctx.closePath();
  ctx.fill();
  // A fold.
  ctx.strokeStyle = 'rgb(0 0 0 / .16)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(214, 372);
  ctx.quadraticCurveTo(256, 400, 300, 372);
  ctx.stroke();
  // Cheeks.
  ctx.fillStyle = 'rgb(236 120 120 / .2)';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(256 + side * 48, 262, 22, 13, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  eyes(ctx, f);
  // Lashes.
  ctx.strokeStyle = '#1d120d';
  ctx.lineWidth = 3;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(256 + side * 58, 207);
    ctx.lineTo(256 + side * 66, 200);
    ctx.stroke();
  }
  // Fine brows.
  ctx.strokeStyle = '#3a2418';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    const lift = f.brow * 6;
    ctx.beginPath();
    ctx.moveTo(256 + side * 20, 192 - lift * 0.6);
    ctx.quadraticCurveTo(256 + side * 40, 180 - lift, 256 + side * 60, 188 - lift * 0.8);
    ctx.stroke();
  }
  // Nose.
  ctx.strokeStyle = 'rgb(160 96 70 / .5)';
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(252, 220);
  ctx.quadraticCurveTo(244, 250, 252, 258);
  ctx.quadraticCurveTo(260, 262, 266, 256);
  ctx.stroke();
  // Lips: a soft rose, the same shapes as his mouth.
  mouth(ctx, f, '#b4475a');
  ctx.restore();
  ctx.restore();
}

/** A label under him on screen: he is drawn, the voice is a machine's. */
export const ANCHOR_LABEL = 'داش غلام · مجری هوش مصنوعی';

/** The sound's level over the timeline, 100 per second (RMS of each 10 ms), from clips placed at `at` seconds. */
export function levels(clips: { at: number; pcm: Float32Array }[], rate: number, total: number): Float32Array {
  const out = new Float32Array(Math.ceil(total * 100) + 1);
  const win = Math.round(rate / 100);
  for (const c of clips) {
    const start = Math.round(c.at * 100);
    for (let i = 0; i * win < c.pcm.length && start + i < out.length; i++) {
      let sum = 0;
      const end = Math.min(c.pcm.length, (i + 1) * win);
      for (let j = i * win; j < end; j++) sum += c.pcm[j] * c.pcm[j];
      out[start + i] = Math.max(out[start + i], Math.sqrt(sum / Math.max(1, end - i * win)));
    }
  }
  // Normalised to the loud parts, and smoothed (attack fast, release slower), as a mouth moves.
  let peak = 0;
  for (const v of out) peak = Math.max(peak, v);
  const norm = peak > 0 ? 1 / (peak * 0.8) : 0;
  let s = 0;
  for (let i = 0; i < out.length; i++) {
    const v = Math.min(1, out[i] * norm);
    s += (v > s ? 0.6 : 0.25) * (v - s);
    out[i] = s;
  }
  return out;
}
export const levelAt = (lv: Float32Array, t: number) => lv[Math.max(0, Math.min(lv.length - 1, Math.round(t * 100)))] ?? 0;
