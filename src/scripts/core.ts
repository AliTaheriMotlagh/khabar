// Small helpers shared by every browser script. Everything here is local to the reader's device.
import { relTime } from '../lib/time';
export { relTime };
export const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
export const $ = <T extends Element = HTMLElement>(sel: string, el: ParentNode = document) => el.querySelector<T>(sel);
export const $$ = <T extends Element = HTMLElement>(sel: string, el: ParentNode = document) => [...el.querySelectorAll<T>(sel)];
export const PAGE_CACHE = 'pages-v2'; // must match public/sw.js

// Never throws: private mode / blocked storage still renders the site.
export const store = {
  get<T>(key: string, fallback: T): T {
    try {
      const v = localStorage.getItem(`khabar:${key}`);
      return v ? (JSON.parse(v) as T) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem(`khabar:${key}`, JSON.stringify(value));
    } catch {}
  },
};

/** Without an AudioEncoder (iOS before 26) a video's sound is recorded as it plays, through an audio context iOS only
 *  starts in a tap: call it in the tap. Null where the encoders make the sound. */
export function tapAudio(): AudioContext | null {
  const ac = typeof AudioEncoder === 'function' ? null : new AudioContext();
  ac?.resume().catch(() => {});
  return ac;
}

// ---------- usage counts for the owner's page (server/live.js `ev:<day>`) ----------
// What readers use (listen, share, make a video…): counted here and sent with the next presence beat, so counting never
// costs a request of its own. No ids, no text: a name from a fixed list and a number.
export const EVENTS = ['listen', 'playlist', 'share', 'save', 'video-made-v', 'video-made-h', 'video-made-s', 'video-shared', 'quiz-right', 'quiz-wrong', 'push-on', 'install', 'term', 'simple', 'today', 'week-listen', 'brief60', 'ad-view', 'ad-click', 'lang-en', 'investigate'] as const;
export type EventName = (typeof EVENTS)[number];
export function track(name: EventName) {
  const ev = store.get<Record<string, number>>('ev', {});
  ev[name] = Math.min(50, (ev[name] ?? 0) + 1);
  store.set('ev', ev);
}
/** The counts waiting to be sent, cleared; `putBack` returns them when the send failed. */
export function takeEvents(): Record<string, number> | undefined {
  const ev = store.get<Record<string, number>>('ev', {});
  if (!Object.keys(ev).length) return undefined;
  store.set('ev', {});
  return ev;
}
export function putBack(ev: Record<string, number> | undefined) {
  if (!ev) return;
  const now = store.get<Record<string, number>>('ev', {});
  for (const [k, n] of Object.entries(ev)) now[k] = Math.min(50, (now[k] ?? 0) + n);
  store.set('ev', now);
}

// ---------- a story's card.json, fetched once per page ----------
// The glossary underlines and the voices' spoken names read it (src/scripts/extras.ts, reader.ts). `cardNow` is what a
// tap can use without waiting (iOS starts audio only inside the tap).
type CardJson = { terms?: [string, string][]; lex?: Record<string, string>; [k: string]: unknown };
const cards = new Map<number, { p: Promise<CardJson | null>; v?: CardJson | null }>();
export function card(id: number): Promise<CardJson | null> {
  let c = cards.get(id);
  if (!c) {
    const entry: { p: Promise<CardJson | null>; v?: CardJson | null } = { p: Promise.resolve(null) };
    entry.p = fetch(`${BASE}/p/${id}/card.json`)
      .then((r) => (r.ok ? (r.json() as Promise<CardJson>) : null))
      .catch(() => null)
      .then((v) => (entry.v = v));
    cards.set(id, (c = entry));
  }
  return c.p;
}
export const cardNow = (id: number) => cards.get(id)?.v ?? null;

/** The English edition (/en/) shares these scripts: numbers and words follow the page's language. */
export const isEn = () => document.documentElement.lang === 'en';
/** The Persian text, or the English one on an English page. */
export const L = (fa: string, en: string) => (isEn() ? en : fa);
const numLocale = () => (isEn() ? 'en-US' : 'fa-IR');
export const fmtNum = (n: number) => n.toLocaleString(numLocale());
export const compact = (n: number) => new Intl.NumberFormat(numLocale(), { notation: 'compact', maximumFractionDigits: 1 }).format(n);
export const esc = (s = '') => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

let toastTimer: number | undefined;
// The English edition (/en/) shares these scripts: their messages in English there. A Persian message with no
// English one (points, badges: the Persian site's game) isn't shown on an English page.
const TOAST_EN: Record<string, string> = {
  'از ذخیره‌ها حذف شد': 'Removed from saved',
  'ذخیره شد — حتی آفلاین هم در دسترس است': 'Saved — it opens offline too',
  'پیوند کپی شد': 'Link copied',
  'دوباره آنلاین شدید': "You're back online",
  'اتصال اینترنت را بررسی کنید': 'Check your internet connection',
  'کمی آهسته‌تر 🙂': 'A little slower 🙂',
  'واکنش ثبت نشد؛ اتصال اینترنت را بررسی کنید': "Your reaction wasn't saved; check your connection",
  'تنظیمات به حالت پیش‌فرض برگشت': 'Settings are back to default',
};
export function toast(msg: string, kind: 'info' | 'reward' = 'info') {
  const el = $('[data-toast]');
  if (!el) return;
  if (isEn() && /[\u0600-\u06ff]/.test(msg)) {
    if (!TOAST_EN[msg]) return;
    msg = TOAST_EN[msg];
  }
  el.textContent = msg;
  el.dataset.kind = kind;
  el.classList.add('show');
  clearTimeout(toastTimer);
  // Long enough to read: a longer sentence stays longer.
  toastTimer = window.setTimeout(() => el.classList.remove('show'), Math.max(kind === 'reward' ? 3200 : 2200, msg.length * 60));
}

// ---------- guest identity (no signup) ----------
export function guest(): string {
  let id = store.get<string>('guest', '');
  if (!id) {
    id = (crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`).replace(/[^\w-]/g, '');
    store.set('guest', id);
  }
  return id;
}
export const myName = () => store.get<string>('name', '');
/** Which part of a story «گوش دادن» reads (the settings sheet's «چه بخشی خوانده شود»; src/lib/lines.ts Part). */
export function listenPart(): 'all' | 'title' | 'lead' | 'last' {
  const v = store.get<{ listen?: string }>('settings', {}).listen;
  return v === 'title' || v === 'lead' || v === 'last' ? v : 'all';
}
export function setMyName(name: string) {
  store.set('name', name.trim().slice(0, 32));
  document.dispatchEvent(new CustomEvent('me-change'));
}
/** Stable colour for a name/id, so avatars are recognisable. */
export const hue = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
export const initial = (name: string) => (name.trim()[0] ?? '؟').toUpperCase();

// ---------- saved & history ----------
export type Entry = { id: number; title: string; href: string; cover?: string; date?: string; at?: number };
export const getSaved = () => store.get<Entry[]>('saved', []);
export const getHistory = () => store.get<Entry[]>('history', []);

export function rowHtml(e: Entry, saved: boolean) {
  const when = e.at ? `خوانده‌شده ${relTime(e.at)}` : e.date ? relTime(e.date) : '';
  return `<li class="row-item" data-id="${e.id}">
    <a href="${esc(e.href)}">
      ${e.cover ? `<img src="${esc(e.cover)}" alt="" width="64" height="64" loading="lazy" referrerpolicy="no-referrer">` : '<span class="ph"></span>'}
      <span><b>${esc(e.title)}</b><small>${esc(when)}</small></span>
    </a>
    ${saved ? `<button class="icon-btn save-btn" type="button" aria-pressed="true" aria-label="حذف از ذخیره‌ها" data-save data-id="${e.id}"><svg class="i on" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 4h12v17l-6-4-6 4z"/></svg></button>` : ''}
  </li>`;
}
