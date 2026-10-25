// Small helpers shared by every browser script. Everything here is local to the reader's device.
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

export const fmtNum = (n: number) => n.toLocaleString('fa-IR');
export const compact = (n: number) => new Intl.NumberFormat('fa-IR', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
export const esc = (s = '') => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const rtf = new Intl.RelativeTimeFormat('fa-IR', { numeric: 'auto' });
export function relTime(when: string | number) {
  const d = new Date(when);
  const mins = (Date.now() - d.getTime()) / 6e4;
  if (mins < 1) return 'همین حالا';
  if (mins < 60) return rtf.format(-Math.round(mins), 'minute');
  if (mins < 60 * 24) return rtf.format(-Math.round(mins / 60), 'hour');
  if (mins < 60 * 24 * 7) return rtf.format(-Math.round(mins / 1440), 'day');
  return new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: 'Asia/Tehran', day: 'numeric', month: 'long' }).format(d);
}

let toastTimer: number | undefined;
export function toast(msg: string, kind: 'info' | 'reward' = 'info') {
  const el = $('[data-toast]');
  if (!el) return;
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
