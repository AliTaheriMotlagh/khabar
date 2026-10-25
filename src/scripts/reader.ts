// Reading tools on a story page: listen aloud, text size and line spacing, focus mode,
// time left, "continue where you left off", and sharing a selected quote.
import { SITE } from '../site';
import { $, $$, fmtNum, store, toast } from './core';
import { award } from './game';
import { Speaker, getReady, type Line } from './speech';
import { canListen, listenOr } from './voice-offer';

type Prefs = Record<string, string>;
const SIZES = ['s', 'm', 'l', 'xl'];
const SIZE_NAMES: Prefs = { s: 'کوچک', m: 'معمولی', l: 'بزرگ', xl: 'خیلی بزرگ' };
const SPACINGS = ['s', 'm', 'l'];
const SPACING_NAMES: Prefs = { s: 'فشرده', m: 'معمولی', l: 'باز' };

const article = $('[data-article]');
const id = Number(article?.dataset.id);
let prefs: () => Prefs = () => ({});
let save: (patch: Prefs) => void = () => {};

// ---------- text size, spacing, focus ----------
export function stepSize(delta: number) {
  const i = Math.max(0, Math.min(SIZES.length - 1, SIZES.indexOf(prefs().size) + delta));
  save({ size: SIZES[i] });
  toast(`اندازه‌ی متن: ${SIZE_NAMES[SIZES[i]]}`);
}
function stepSpacing() {
  const next = SPACINGS[(SPACINGS.indexOf(prefs().spacing) + 1) % SPACINGS.length];
  save({ spacing: next });
  toast(`فاصله‌ی خطوط: ${SPACING_NAMES[next]}`);
}
export function toggleFocus() {
  const on = prefs().focus !== 'on';
  // The layout changes under the reader: keep the paragraph they were on at the same spot.
  const anchor = $$('h1, .article-media, .prose p, .why, .digest-list li', article ?? document).find((el) => el.getBoundingClientRect().bottom > 90);
  const top = anchor?.getBoundingClientRect().top ?? 0;
  save({ focus: on ? 'on' : 'off' });
  if (anchor) scrollBy({ top: anchor.getBoundingClientRect().top - top, behavior: 'instant' });
  toast(on ? 'حالت مطالعه روشن شد' : 'حالت مطالعه خاموش شد');
}

// ---------- time left ----------
const timeLeft = $('[data-time-left]');
const minutes = Number(article?.dataset.minutes) || 1;
let lastRatio = 0;
/** Called from the page's scroll handler with how far through the article the reader is (0–1). */
export function readerProgress(ratio: number) {
  lastRatio = ratio;
  if (!timeLeft) return;
  // Blank at the top: the meta line above already says how long the story is.
  timeLeft.textContent = ratio > 0.97 ? 'تا آخر خواندید' : ratio < 0.03 ? '' : `${fmtNum(Math.max(1, Math.ceil(minutes * (1 - ratio))))} دقیقه مانده`;
}

// ---------- continue where you left off ----------
type Positions = Record<string, number>;
function rememberPosition() {
  if (!id) return;
  const all = store.get<Positions>('positions', {});
  delete all[id];
  if (lastRatio > 0.08 && lastRatio < 0.92) all[id] = Math.round(lastRatio * 1000) / 1000;
  store.set('positions', Object.fromEntries(Object.entries(all).slice(-40)));
}
function scrollToRatio(ratio: number) {
  const r = article!.getBoundingClientRect();
  scrollTo({ top: scrollY + r.top + ratio * Math.max(r.height - innerHeight, 1) - 80, behavior: 'smooth' });
}
function offerResume() {
  const ratio = store.get<Positions>('positions', {})[id];
  const pill = $('[data-resume]');
  if (!ratio || !pill || scrollY > 200 || location.hash) return;
  pill.hidden = false;
  const hide = () => (pill.hidden = true);
  $('[data-resume-go]', pill)?.addEventListener('click', () => (hide(), scrollToRatio(ratio)));
  $('[data-resume-x]', pill)?.addEventListener('click', hide);
  setTimeout(hide, 10_000);
  addEventListener('scroll', () => scrollY > 400 && hide(), { passive: true });
}

// ---------- listen (src/scripts/speech.ts picks the voice; src/scripts/voice-offer.ts offers one if there is none) ----------
const listenBtn = $('[data-listen]');
const rateBtn = $('[data-rate]');
const RATES = [1, 1.25, 1.5, 1.75, 0.85];
let paragraphs: HTMLElement[] = [];
let touchedAt = 0; // last time the reader scrolled by hand
for (const type of ['wheel', 'touchmove', 'keydown']) addEventListener(type, () => (touchedAt = Date.now()), { passive: true });
const speaker = new Speaker({
  line(n) {
    $$('.is-speaking').forEach((el) => el.classList.remove('is-speaking'));
    const el = paragraphs[n];
    if (!el) return;
    el.classList.add('is-speaking');
    // Follow along, but only when the paragraph is off screen and the reader isn't scrolling on their own.
    const r = el.getBoundingClientRect();
    if ((r.top < 0 || r.bottom > innerHeight) && Date.now() - touchedAt > 5000) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  },
  state(s) {
    if (!listenBtn) return;
    listenBtn.dataset.state = s;
    listenBtn.setAttribute('aria-pressed', String(s === 'playing' || s === 'loading'));
    $('[data-listen-label]', listenBtn)!.textContent = s === 'playing' ? 'مکث' : s === 'loading' ? 'آماده‌سازی…' : s === 'paused' ? 'ادامه' : 'گوش دادن';
    if (s === 'idle') $$('.is-speaking').forEach((el) => el.classList.remove('is-speaking'));
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = s === 'playing' ? 'playing' : s === 'paused' ? 'paused' : 'none';
  },
  fail: (msg) => toast(msg),
});
speaker.rate = store.get<number>('rate', 1);

// Runs straight from the tap (see speech.ts).
function toggleListen() {
  if (speaker.state === 'playing' || speaker.state === 'loading') return speaker.pause();
  if (speaker.state === 'paused') return speaker.resume();
  // The story's text only, not its headline: paragraph k is card.json's k + 1 (0 is the headline, see api/tts.js).
  // A brief's first line is its headline again, and a line that is only a link isn't worth hearing: both are skipped.
  // A story with no text is read by its headline.
  const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();
  const head = text($('h1', article!)!).replace(/…$/, '');
  const all = $$('.prose p, .why p, .digest-list li', article!).filter((el) => text(el));
  const again = all[0] && text(all[0]).length < head.length + 20 && text(all[0]).startsWith(head.slice(0, 30)) ? 1 : 0;
  let parts = all.map((el, k) => ({ el, i: k + 1 })).filter(({ el, i }) => i > again && !/^\P{L}*https?:\/\/\S+$/u.test(text(el)));
  if (!parts.length) parts = $$('h1', article!).map((el) => ({ el, i: 0 }));
  paragraphs = parts.map((p) => p.el);
  if ('mediaSession' in navigator) {
    const cover = article?.dataset.cover;
    navigator.mediaSession.metadata = new MediaMetadata({ title: article?.dataset.title ?? document.title, artist: SITE.name, artwork: cover ? [{ src: cover }] : [] });
  }
  speaker.start(parts.map(({ el, i }) => ({ text: text(el), post: id, i })));
}

function stepRate() {
  const r = RATES[(RATES.indexOf(speaker.rate) + 1) % RATES.length] ?? 1;
  speaker.setRate(r);
  store.set('rate', r);
  showRate();
}
const showRate = () => rateBtn && (rateBtn.textContent = `${fmtNum(speaker.rate)}×`);

// ---------- share a selected quote ----------
const quoteBtn = $<HTMLButtonElement>('[data-quote]');
let quote = '';
function placeQuoteButton() {
  const sel = getSelection();
  const text = sel?.toString().replace(/\s+/g, ' ').trim() ?? '';
  const inside = sel?.rangeCount && article?.contains(sel.getRangeAt(0).commonAncestorContainer) && sel.getRangeAt(0).commonAncestorContainer.parentElement?.closest('h1, .prose, .why, .digest-list');
  if (!quoteBtn) return;
  if (!inside || text.length < 8) {
    quoteBtn.hidden = true;
    return;
  }
  quote = text.length > 400 ? `${text.slice(0, 400)}…` : text;
  const r = sel!.getRangeAt(0).getBoundingClientRect();
  quoteBtn.hidden = false;
  // Below the selection, where the phone's own copy menu (shown above it) doesn't cover it.
  const top = Math.min(innerHeight - 56, r.bottom + 12);
  const left = Math.max(12, Math.min(innerWidth - quoteBtn.offsetWidth - 12, r.left + r.width / 2 - quoteBtn.offsetWidth / 2));
  quoteBtn.style.transform = `translate(${left}px, ${top}px)`;
}
async function shareQuote() {
  const title = article?.dataset.title ?? document.title;
  const url = new URL(article?.dataset.href ?? location.pathname, location.href).href;
  const text = `«${quote}»\n— ${title}`;
  quoteBtn!.hidden = true;
  if (navigator.share) {
    try {
      await navigator.share({ text, url });
      award('share');
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(`${text}\n${url}`);
    toast('نقل‌قول و پیوند کپی شد');
    award('share');
  } catch {
    prompt('کپی کنید:', `${text}\n${url}`);
  }
}

// ---------- listen to the morning brief (home page) ----------
function initBrief() {
  const btn = $('[data-brief-listen]');
  if (!btn) return;
  const items = $$('.brief-list li');
  const lines = JSON.parse(btn.dataset.lines ?? '[]') as Line[];
  const label = $('[data-listen-label]', btn)!;
  const brief = new Speaker({
    line(n) {
      items.forEach((li, k) => li.classList.toggle('is-speaking', k === n - 1));
    },
    state(s) {
      btn.dataset.state = s;
      btn.setAttribute('aria-pressed', String(s === 'playing' || s === 'loading'));
      label.textContent = s === 'playing' ? 'مکث' : s === 'loading' ? 'آماده‌سازی…' : s === 'paused' ? 'ادامه' : 'گوش دادن';
      if (s === 'idle') items.forEach((li) => li.classList.remove('is-speaking'));
    },
    fail: (msg) => toast(msg),
  });
  brief.rate = store.get<number>('rate', 1);
  const toggle = () => {
    if (brief.state === 'playing' || brief.state === 'loading') return brief.pause();
    if (brief.state === 'paused') return brief.resume();
    if ('mediaSession' in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: 'خلاصه‌ی خبرهای صبح', artist: SITE.name });
    brief.start(lines);
  };
  canListen().then((ok) => (btn.hidden = !ok || !lines.length));
  btn.addEventListener('pointerdown', getReady, { once: true });
  btn.addEventListener('click', () => (brief.state === 'idle' ? listenOr(toggle) : toggle()));
  addEventListener('pagehide', () => brief.stop());
}

export function initReader(get: () => Prefs, set: (patch: Prefs) => void) {
  prefs = get;
  save = set;
  initBrief();
  if (!article) return;
  readerProgress(0);
  offerResume();
  addEventListener('pagehide', () => (rememberPosition(), speaker.stop()));
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && rememberPosition());

  if (listenBtn) {
    canListen().then((ok) => (listenBtn.hidden = !ok));
    listenBtn.addEventListener('pointerdown', getReady, { once: true });
    listenBtn.addEventListener('click', () => (speaker.state === 'idle' ? listenOr(toggleListen) : toggleListen()));
    showRate();
    rateBtn?.addEventListener('click', stepRate);
    if ('mediaSession' in navigator) {
      const ms = navigator.mediaSession;
      ms.setActionHandler('play', () => speaker.resume());
      ms.setActionHandler('pause', () => speaker.pause());
      ms.setActionHandler('stop', () => speaker.stop());
      ms.setActionHandler('nexttrack', () => speaker.play(Math.min(speaker.at + 1, paragraphs.length - 1)));
      ms.setActionHandler('previoustrack', () => speaker.play(Math.max(speaker.at - 1, 0)));
    }
  }
  $$('[data-size-step]').forEach((b) => b.addEventListener('click', () => stepSize(Number(b.dataset.sizeStep))));
  $('[data-spacing-step]')?.addEventListener('click', stepSpacing);
  $('[data-focus-toggle]')?.addEventListener('click', toggleFocus);

  let pending = 0;
  document.addEventListener('selectionchange', () => {
    clearTimeout(pending);
    pending = window.setTimeout(placeQuoteButton, 250);
  });
  quoteBtn?.addEventListener('pointerdown', (e) => e.preventDefault()); // keep the selection while tapping
  quoteBtn?.addEventListener('click', shareQuote);
  addEventListener('scroll', () => quoteBtn && !quoteBtn.hidden && placeQuoteButton(), { passive: true });
}
