// Reading tools on a story page: listen aloud, text size and line spacing, focus mode,
// time left, "continue where you left off", and sharing a selected quote.
import { $, $$, fmtNum, store, toast } from './core';
import { award } from './game';
import type { Line } from './speech';
import { player, type Snap } from './listen';
import { storyLines } from '../lib/lines';
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

// ---------- listen (src/scripts/listen.ts plays, speech.ts picks the voice, voice-offer.ts offers one if there is none) ----------
// The site's player reads the story; this page shows it: the button, the paragraph being read (a tap on another one
// reads from there), and following along. Where the reader stopped is kept per story (listen.ts): «ادامه‌ی گوش دادن»
// goes on from that paragraph. The player plays on while the reader goes to other pages, and this page picks it up
// again when it is opened while its story plays.
const listenBtn = $('[data-listen]');
const key = `story:${id}`;
let paragraphs: HTMLElement[] = [];
let lines: Line[] = [];
type Spots = Record<string, number>;
const listenSpot = () => store.get<Spots>('listen-at', {})[id] ?? 0;
const idleLabel = () => (listenSpot() ? 'ادامه‌ی گوش دادن' : 'گوش دادن');
let touchedAt = 0; // last time the reader scrolled by hand
for (const type of ['wheel', 'touchmove', 'keydown']) addEventListener(type, () => (touchedAt = Date.now()), { passive: true });

/** Which paragraphs are read, and each one's index for the cloud voice: src/lib/lines.ts (shared with the playlist and
 *  the offline audio, which read card.json). */
function readLines() {
  const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();
  const h1 = $('h1', article!)!;
  const els = $$('.prose p, .why p, .digest-list li', article!).filter((el) => text(el));
  lines = storyLines(id, text(h1), els.map(text));
  paragraphs = lines.map((l) => (l.i ? els[l.i - 1] : h1));
}

let speaking = -1;
function show(s: Snap) {
  const mine = s.key === key;
  const state = mine ? s.state : 'idle';
  if (listenBtn) {
    listenBtn.dataset.state = state;
    listenBtn.setAttribute('aria-pressed', String(state === 'playing' || state === 'loading'));
    $('[data-listen-label]', listenBtn)!.textContent = state === 'playing' ? 'مکث' : state === 'loading' ? 'آماده‌سازی…' : state === 'paused' ? 'ادامه' : idleLabel();
  }
  $$('[data-rate]').forEach((b) => (b.textContent = `${fmtNum(s.rate)}×`));
  const n = state === 'idle' ? -1 : s.step;
  if (n === speaking) return;
  speaking = n;
  $$('.is-speaking', article ?? document).forEach((el) => el.classList.remove('is-speaking'));
  const el = paragraphs[n];
  if (!el) return;
  el.classList.add('is-speaking');
  $('[data-resume]')?.setAttribute('hidden', '');
  // Follow along, but only when the paragraph is off screen and the reader isn't scrolling on their own.
  const r = el.getBoundingClientRect();
  if ((r.top < 0 || r.bottom > innerHeight) && Date.now() - touchedAt > 5000) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

// Runs straight from the tap (see speech.ts).
function toggleListen() {
  const p = player();
  if (p.key === key) return p.toggle();
  readLines();
  // Where the reader stopped last time (a paragraph that is still there), else the top.
  const from = listenSpot() < paragraphs.length ? listenSpot() : 0;
  if (from) toast(`ادامه از بند ${fmtNum(from + 1)}؛ با نوار پایین صفحه به هر بند می‌روید`);
  const d = article!.dataset;
  p.playLines({ key, title: d.title ?? document.title, href: d.href ?? location.pathname, cover: d.cover || undefined, unit: 'بند' }, lines, from);
}

/** A paragraph of the story while it is read: read from there. */
function readFromHere(e: MouseEvent) {
  const p = player();
  if (p.key !== key) return;
  const t = e.target as Element;
  if (t.closest('a, button, mark, input, textarea') || getSelection()?.toString()) return;
  const n = paragraphs.findIndex((el) => el.contains(t));
  if (n >= 0 && n !== speaking) p.jump(n);
}

// ---------- a selected passage: comment on it (social.ts), or share it as a quote ----------
const quoteBar = $('[data-quote-bar]');
let selected = '';
function placeQuoteButton() {
  const sel = getSelection();
  const text = sel?.toString().replace(/\s+/g, ' ').trim() ?? '';
  const inside = sel?.rangeCount && article?.contains(sel.getRangeAt(0).commonAncestorContainer) && sel.getRangeAt(0).commonAncestorContainer.parentElement?.closest('h1, .prose, .why, .digest-list');
  if (!quoteBar) return;
  if (!inside || text.length < 8) {
    quoteBar.hidden = true;
    return;
  }
  selected = text;
  const r = sel!.getRangeAt(0).getBoundingClientRect();
  quoteBar.hidden = false;
  // Below the selection, where the phone's own copy menu (shown above it) doesn't cover it.
  const top = Math.min(innerHeight - 56, r.bottom + 12);
  const left = Math.max(12, Math.min(innerWidth - quoteBar.offsetWidth - 12, r.left + r.width / 2 - quoteBar.offsetWidth / 2));
  quoteBar.style.transform = `translate(${left}px, ${top}px)`;
}
/** The comment form takes the passage (up to 300 characters, cut at a word: it is matched against the text). */
function commentOnQuote() {
  const q = selected.length > 300 ? selected.slice(0, 300).replace(/\s+\S*$/, '') : selected;
  quoteBar!.hidden = true;
  getSelection()?.removeAllRanges();
  document.dispatchEvent(new CustomEvent('comment-on', { detail: q }));
}
async function shareQuote() {
  const title = article?.dataset.title ?? document.title;
  const url = new URL(article?.dataset.href ?? location.pathname, location.href).href;
  const quote = selected.length > 400 ? `${selected.slice(0, 400)}…` : selected;
  const text = `«${quote}»\n— ${title}`;
  quoteBar!.hidden = true;
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
  const p = player();
  const off = p.subscribe((s) => {
    const state = s.key === 'brief' ? s.state : 'idle';
    btn.dataset.state = state;
    btn.setAttribute('aria-pressed', String(state === 'playing' || state === 'loading'));
    label.textContent = state === 'playing' ? 'مکث' : state === 'loading' ? 'آماده‌سازی…' : state === 'paused' ? 'ادامه' : 'گوش دادن';
    // Line 0 is the summary's heading, then one line per item.
    items.forEach((li, k) => li.classList.toggle('is-speaking', state !== 'idle' && k === s.step - 1));
  });
  addEventListener('pagehide', off);
  const toggle = () => {
    if (p.key === 'brief') return p.toggle();
    p.playLines({ key: 'brief', title: 'خلاصه‌ی خبرهای صبح', href: `${location.pathname}#brief`, unit: 'خبر' }, lines);
  };
  canListen().then((ok) => (btn.hidden = !ok || !lines.length));
  btn.addEventListener('pointerdown', () => p.ready(), { once: true });
  btn.addEventListener('click', () => (p.key === 'brief' ? toggle() : listenOr(toggle)));
}

export function initReader(get: () => Prefs, set: (patch: Prefs) => void) {
  prefs = get;
  save = set;
  initBrief();
  if (!article) return;
  readerProgress(0);
  offerResume();
  addEventListener('pagehide', rememberPosition);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && rememberPosition());

  if (listenBtn) {
    const p = player();
    readLines();
    canListen().then((ok) => (listenBtn.hidden = !ok));
    const off = p.subscribe(show);
    addEventListener('pagehide', off);
    listenBtn.addEventListener('pointerdown', () => p.ready(), { once: true });
    listenBtn.addEventListener('click', () => (p.key === key ? toggleListen() : listenOr(toggleListen)));
    $$('[data-rate]').forEach((b) => b.addEventListener('click', () => p.cycleRate()));
    article.addEventListener('click', readFromHere);
  }
  $$('[data-size-step]').forEach((b) => b.addEventListener('click', () => stepSize(Number(b.dataset.sizeStep))));
  $('[data-spacing-step]')?.addEventListener('click', stepSpacing);
  $('[data-focus-toggle]')?.addEventListener('click', toggleFocus);

  let pending = 0;
  document.addEventListener('selectionchange', () => {
    clearTimeout(pending);
    pending = window.setTimeout(placeQuoteButton, 250);
  });
  quoteBar?.addEventListener('pointerdown', (e) => e.preventDefault()); // keep the selection while tapping
  $('[data-quote]', quoteBar ?? undefined)?.addEventListener('click', shareQuote);
  $('[data-quote-comment]', quoteBar ?? undefined)?.addEventListener('click', commentOnQuote);
  addEventListener('scroll', () => quoteBar && !quoteBar.hidden && placeQuoteButton(), { passive: true });
}
