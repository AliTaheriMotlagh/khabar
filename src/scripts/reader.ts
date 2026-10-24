// Reading tools on a story page: listen aloud, text size and line spacing, focus mode,
// time left, "continue where you left off", and sharing a selected quote.
import { $, $$, fmtNum, store, toast } from './core';
import { award } from './game';

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
  save({ focus: on ? 'on' : 'off' });
  toast(on ? 'حالت مطالعه: فقط خود خبر' : 'حالت مطالعه خاموش شد');
}

// ---------- time left ----------
const timeLeft = $('[data-time-left]');
const minutes = Number(article?.dataset.minutes) || 1;
let lastRatio = 0;
/** Called from the page's scroll handler with how far through the article the reader is (0–1). */
export function readerProgress(ratio: number) {
  lastRatio = ratio;
  if (!timeLeft) return;
  timeLeft.textContent = ratio > 0.97 ? 'تا آخر خواندید' : ratio < 0.03 ? `${fmtNum(minutes)} دقیقه مطالعه` : `${fmtNum(Math.max(1, Math.ceil(minutes * (1 - ratio))))} دقیقه مانده`;
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

// ---------- listen (the browser's own speech; Persian needs a Persian voice on the device) ----------
const synth = 'speechSynthesis' in window ? speechSynthesis : null;
const listenBtn = $('[data-listen]');
let queue: HTMLElement[] = [];
let at = 0;
let run = 0; // bumps on pause/stop so a cancelled utterance's events are ignored
const isPersian = (s: string) => /[؀-ۿ]/.test(s);

function voices(): Promise<SpeechSynthesisVoice[]> {
  const now = synth!.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((done) => {
    const t = setTimeout(() => done(synth!.getVoices()), 1200);
    synth!.addEventListener('voiceschanged', () => (clearTimeout(t), done(synth!.getVoices())), { once: true });
  });
}
const voiceFor = (all: SpeechSynthesisVoice[], lang: string) => all.find((v) => v.lang.toLowerCase().replace('_', '-').startsWith(lang));

function setListenState(state: 'idle' | 'playing' | 'paused') {
  if (!listenBtn) return;
  listenBtn.dataset.state = state;
  listenBtn.setAttribute('aria-pressed', String(state === 'playing'));
  $('[data-listen-label]', listenBtn)!.textContent = state === 'playing' ? 'مکث' : state === 'paused' ? 'ادامه‌ی پخش' : 'گوش دادن';
}

async function speakFrom(i: number) {
  const mine = ++run;
  const all = await voices();
  $$('.is-speaking').forEach((el) => el.classList.remove('is-speaking'));
  const el = queue[i];
  if (mine !== run) return;
  if (!el) return stopListening();
  at = i;
  const text = el.textContent?.trim() ?? '';
  if (!text) return speakFrom(i + 1);
  const lang = isPersian(text) ? 'fa' : 'en';
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang === 'fa' ? 'fa-IR' : 'en-US';
  const v = voiceFor(all, lang);
  if (v) u.voice = v;
  u.onend = () => mine === run && speakFrom(i + 1);
  u.onerror = (e) => {
    if (mine !== run || e.error === 'interrupted' || e.error === 'canceled') return;
    stopListening();
    toast('پخش صدا روی این دستگاه ممکن نشد');
  };
  el.classList.add('is-speaking');
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  synth!.speak(u);
}

function stopListening() {
  run++;
  synth?.cancel();
  at = 0;
  $$('.is-speaking').forEach((el) => el.classList.remove('is-speaking'));
  setListenState('idle');
}

async function toggleListen() {
  if (!synth || !listenBtn) return;
  const state = listenBtn.dataset.state ?? 'idle';
  if (state === 'playing') {
    // pause() is unreliable on mobile; cancel and restart the current paragraph instead.
    run++;
    synth.cancel();
    return setListenState('paused');
  }
  if (state === 'idle') {
    queue = $$('h1, .prose p, .why p, .digest-list li', article!);
    const all = await voices();
    if (all.length && queue.some((el) => isPersian(el.textContent ?? '')) && !voiceFor(all, 'fa')) {
      toast('صدای فارسی روی این دستگاه نصب نیست؛ از تنظیمات «متن به گفتار» دستگاه اضافه‌اش کنید');
      return;
    }
  }
  setListenState('playing');
  speakFrom(state === 'paused' ? at : 0);
}

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
    award('share', { quiet: true });
  } catch {
    prompt('کپی کنید:', `${text}\n${url}`);
  }
}

export function initReader(get: () => Prefs, set: (patch: Prefs) => void) {
  prefs = get;
  save = set;
  if (!article) return;
  readerProgress(0);
  offerResume();
  addEventListener('pagehide', () => (rememberPosition(), synth?.cancel()));
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && rememberPosition());

  if (synth && listenBtn) {
    listenBtn.hidden = false;
    listenBtn.addEventListener('click', toggleListen);
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
