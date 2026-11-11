// Reading tools on a story page: listen aloud, text size and line spacing, focus mode,
// time left, "continue where you left off", and sharing a selected quote.
import { SITE } from '../site';
import { $, $$, fmtNum, store, toast } from './core';
import { award } from './game';
import { Speaker, getReady, type Line } from './speech';
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

// ---------- listen (src/scripts/speech.ts picks the voice; src/scripts/voice-offer.ts offers one if there is none) ----------
// While it plays, a bar at the bottom (the page's [data-listen-bar]): paragraph before/after, 10 seconds back/forward,
// speed, stop, and a track with a step per paragraph to jump to. A tap on a paragraph of the story reads from there.
// Where the reader stopped is kept per story: «ادامه‌ی گوش دادن» goes on from that paragraph.
const listenBtn = $('[data-listen]');
const listenBar = $('[data-listen-bar]');
const RATES = [1, 1.25, 1.5, 1.75, 2, 0.85];
let paragraphs: HTMLElement[] = [];
type Spots = Record<string, number>;
const listenSpot = () => store.get<Spots>('listen-at', {})[id] ?? 0;
function keepSpot(n: number | null) {
  const all = store.get<Spots>('listen-at', {});
  delete all[id];
  if (n) all[id] = n;
  store.set('listen-at', Object.fromEntries(Object.entries(all).slice(-40)));
}
const idleLabel = () => (listenSpot() ? 'ادامه‌ی گوش دادن' : 'گوش دادن');
function showSpot(n: number) {
  if (!listenBar) return;
  const total = paragraphs.length;
  $('[data-lb-pos]', listenBar)!.textContent = total > 1 ? `بند ${fmtNum(n + 1)} از ${fmtNum(total)}` : '';
  $$('[data-lb-track] button', listenBar).forEach((b, k) => {
    b.classList.toggle('done', k < n);
    b.classList.toggle('now', k === n);
  });
  $<HTMLButtonElement>('[data-lb="prev"]', listenBar)!.disabled = n === 0;
  $<HTMLButtonElement>('[data-lb="next"]', listenBar)!.disabled = n >= total - 1;
}
let touchedAt = 0; // last time the reader scrolled by hand
for (const type of ['wheel', 'touchmove', 'keydown']) addEventListener(type, () => (touchedAt = Date.now()), { passive: true });
const speaker = new Speaker({
  line(n) {
    $$('.is-speaking').forEach((el) => el.classList.remove('is-speaking'));
    showSpot(n);
    keepSpot(n);
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
    $('[data-listen-label]', listenBtn)!.textContent = s === 'playing' ? 'مکث' : s === 'loading' ? 'آماده‌سازی…' : s === 'paused' ? 'ادامه' : idleLabel();
    if (s === 'idle') $$('.is-speaking').forEach((el) => el.classList.remove('is-speaking'));
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = s === 'playing' ? 'playing' : s === 'paused' ? 'paused' : 'none';
    if (listenBar) {
      listenBar.hidden = s === 'idle';
      listenBar.dataset.state = s;
      $('[data-lb="toggle"]', listenBar)!.setAttribute('aria-label', s === 'paused' ? 'ادامه' : 'مکث');
      document.documentElement.toggleAttribute('data-listening', s !== 'idle');
      if (s !== 'idle') $('[data-resume]')?.setAttribute('hidden', '');
    }
  },
  // Heard to the end: next time it starts from the top.
  end: () => {
    keepSpot(null);
    if (listenBtn) $('[data-listen-label]', listenBtn)!.textContent = idleLabel();
  },
  fail: (msg) => toast(msg),
});
speaker.rate = store.get<number>('rate', 1);

// Runs straight from the tap (see speech.ts).
function toggleListen() {
  if (speaker.state === 'playing' || speaker.state === 'loading') return speaker.pause();
  if (speaker.state === 'paused') return speaker.resume();
  // Which paragraphs are read, and each one's index for the cloud voice: src/lib/lines.ts (shared with the playlist
  // and the offline audio, which read card.json).
  const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();
  const h1 = $('h1', article!)!;
  const els = $$('.prose p, .why p, .digest-list li', article!).filter((el) => text(el));
  const lines = storyLines(id, text(h1), els.map(text));
  paragraphs = lines.map((l) => (l.i ? els[l.i - 1] : h1));
  if ('mediaSession' in navigator) {
    const cover = article?.dataset.cover;
    navigator.mediaSession.metadata = new MediaMetadata({ title: article?.dataset.title ?? document.title, artist: SITE.name, artwork: cover ? [{ src: cover }] : [] });
  }
  const track = listenBar && $('[data-lb-track]', listenBar);
  if (track) {
    track.innerHTML = paragraphs.length > 1 ? paragraphs.map((_, k) => `<button type="button" tabindex="-1" data-lb-to="${k}" aria-label="بند ${fmtNum(k + 1)}"></button>`).join('') : '';
  }
  // Where the reader stopped last time (a paragraph that is still there), else the top.
  const from = listenSpot() < paragraphs.length ? listenSpot() : 0;
  if (from) toast(`ادامه از بند ${fmtNum(from + 1)}؛ با نوار پایین صفحه به هر بند می‌روید`);
  speaker.start(lines, from);
}

/** The bar's buttons, a step of its track, or a paragraph of the story while listening. */
function listenControl(e: Event) {
  const t = e.target as Element;
  const to = t.closest<HTMLElement>('[data-lb-to]');
  if (to) return speaker.play(Number(to.dataset.lbTo));
  const action = t.closest<HTMLElement>('[data-lb]')?.dataset.lb;
  if (action === 'toggle') toggleListen();
  else if (action === 'prev') speaker.skip(-1);
  else if (action === 'next') speaker.skip(1);
  else if (action === 'back') speaker.seek(-10);
  else if (action === 'fwd') speaker.seek(10);
  else if (action === 'stop') speaker.stop();
}
function readFromHere(e: MouseEvent) {
  if (speaker.state === 'idle') return;
  const t = e.target as Element;
  if (t.closest('a, button, mark, input, textarea') || getSelection()?.toString()) return;
  const n = paragraphs.findIndex((p) => p.contains(t));
  if (n >= 0 && n !== speaker.at) speaker.play(n);
}

function stepRate() {
  const r = RATES[(RATES.indexOf(speaker.rate) + 1) % RATES.length] ?? 1;
  speaker.setRate(r);
  store.set('rate', r);
  showRate();
}
const showRate = () => $$('[data-rate]').forEach((b) => (b.textContent = `${fmtNum(speaker.rate)}×`));

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
    $('[data-listen-label]', listenBtn)!.textContent = idleLabel();
    listenBtn.addEventListener('pointerdown', getReady, { once: true });
    listenBtn.addEventListener('click', () => (speaker.state === 'idle' ? listenOr(toggleListen) : toggleListen()));
    showRate();
    $$('[data-rate]').forEach((b) => b.addEventListener('click', stepRate));
    listenBar?.addEventListener('click', listenControl);
    article.addEventListener('click', readFromHere);
    if ('mediaSession' in navigator) {
      const ms = navigator.mediaSession;
      const on = (action: MediaSessionAction, fn: () => void) => {
        try {
          ms.setActionHandler(action, fn);
        } catch {} // an action this browser doesn't know
      };
      on('play', () => speaker.resume());
      on('pause', () => speaker.pause());
      on('stop', () => speaker.stop());
      on('nexttrack', () => speaker.skip(1));
      on('previoustrack', () => speaker.skip(-1));
      on('seekbackward', () => speaker.seek(-10));
      on('seekforward', () => speaker.seek(10));
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
  quoteBar?.addEventListener('pointerdown', (e) => e.preventDefault()); // keep the selection while tapping
  $('[data-quote]', quoteBar ?? undefined)?.addEventListener('click', shareQuote);
  $('[data-quote-comment]', quoteBar ?? undefined)?.addEventListener('click', commentOnQuote);
  addEventListener('scroll', () => quoteBar && !quoteBar.hidden && placeQuoteButton(), { passive: true });
}
