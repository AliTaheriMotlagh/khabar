// Client behaviour for every page. Everything is progressive: the site works without JS.
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
const root = document.documentElement;
const $ = <T extends Element = HTMLElement>(sel: string, el: ParentNode = document) => el.querySelector<T>(sel);
const $$ = <T extends Element = HTMLElement>(sel: string, el: ParentNode = document) => [...el.querySelectorAll<T>(sel)];

// ---------- storage (never throws: private mode / blocked storage still renders the site) ----------
const store = {
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

// ---------- reader settings ----------
type Settings = Record<string, string | number>;
const DEFAULTS: Settings = {
  theme: 'auto', font: 'vazir', fs: 18, lh: '1.95', width: 'medium', align: 'start', view: 'cards',
  media: 'show', source: 'closed', calendar: 'persian', digits: 'arab', uiFont: 'ui', header: 'auto', motion: 'full',
};
let settings: Settings = { ...DEFAULTS, ...store.get<Settings>('settings', {}) };
const darkQuery = matchMedia('(prefers-color-scheme: dark)');

function resolvedTheme() {
  return settings.theme === 'auto' ? (darkQuery.matches ? 'dark' : 'light') : String(settings.theme);
}

function applySettings() {
  root.dataset.theme = resolvedTheme();
  for (const k of ['font', 'width', 'align', 'view', 'media', 'motion', 'uiFont', 'source'] as const) root.dataset[k] = String(settings[k]);
  root.style.setProperty('--fs', `${settings.fs}px`);
  root.style.setProperty('--lh', String(settings.lh));
  const meta = $<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(document.body).backgroundColor;
  $$<HTMLDetailsElement>('details[data-source]').forEach((d) => (d.open = settings.source === 'open'));
  renderDates();
  renderDigits();
}

function saveSettings(patch: Settings) {
  settings = { ...settings, ...patch };
  const diff = Object.fromEntries(Object.entries(settings).filter(([k, v]) => DEFAULTS[k] !== v));
  store.set('settings', diff);
  applySettings();
  syncForm();
}

darkQuery.addEventListener('change', () => settings.theme === 'auto' && applySettings());

const settingsDialog = $<HTMLDialogElement>('#settings');
const keysDialog = $<HTMLDialogElement>('#keys');
const form = $<HTMLFormElement>('[data-settings-form]');

function syncForm() {
  if (!form) return;
  for (const [k, v] of Object.entries(settings)) {
    const input = form.querySelector<HTMLInputElement>(`input[name="${k}"][value="${v}"]`) || form.querySelector<HTMLInputElement>(`input[type=range][name="${k}"]`);
    if (!input) continue;
    if (input.type === 'range') input.value = String(v);
    else input.checked = true;
  }
  const out = $('[data-fs-out]');
  if (out) out.textContent = fmtNum(Number(settings.fs));
}

form?.addEventListener('input', (e) => {
  const t = e.target as HTMLInputElement;
  saveSettings({ [t.name]: t.type === 'range' ? Number(t.value) : t.value });
});
const bumpFont = (d: number) => saveSettings({ fs: Math.min(30, Math.max(14, Number(settings.fs) + d)) });
$$('[data-fs]').forEach((b) => b.addEventListener('click', () => bumpFont(Number(b.dataset.fs))));
$('[data-reset]')?.addEventListener('click', () => {
  settings = { ...DEFAULTS };
  saveSettings({});
  toast('تنظیمات به حالت پیش‌فرض برگشت');
});
for (const dlg of [settingsDialog, keysDialog]) {
  dlg?.addEventListener('click', (e) => {
    if (e.target === dlg || (e.target as Element).closest('[data-close]')) dlg.close();
  });
}
const openSettings = () => { syncForm(); settingsDialog?.showModal(); };
$$('[data-open-settings]').forEach((b) => b.addEventListener('click', openSettings));
$$('[data-open-keys]').forEach((b) => b.addEventListener('click', () => keysDialog?.showModal()));
const toggleTheme = () => {
  const dark = ['dark', 'black'].includes(resolvedTheme());
  saveSettings({ theme: dark ? 'light' : 'dark' });
};
$('[data-theme-toggle]')?.addEventListener('click', toggleTheme);

// ---------- dates & digits (rendered client-side so "today"/"2h ago" are never stale) ----------
const locale = () => `fa-IR-u-ca-${settings.calendar}${settings.digits === 'latn' ? '-nu-latn' : ''}`;
const TZ = 'Asia/Tehran';
const fmtNum = (n: number) => n.toLocaleString(settings.digits === 'latn' ? 'en-US' : 'fa-IR');
const tehranDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);

function renderDates() {
  const now = Date.now();
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });
  const today = tehranDay(new Date());
  const yesterday = tehranDay(new Date(now - 864e5));
  $$<HTMLTimeElement>('time[data-f]').forEach((el) => {
    const d = new Date(el.dateTime);
    const mins = (now - d.getTime()) / 6e4;
    const f = el.dataset.f;
    let text: string;
    if (f === 'rel' && mins < 60 * 24) {
      text = mins < 1 ? 'همین حالا' : mins < 60 ? rtf.format(-Math.round(mins), 'minute') : rtf.format(-Math.round(mins / 60), 'hour');
    } else if (f === 'long') {
      text = new Intl.DateTimeFormat(locale(), { timeZone: TZ, dateStyle: 'full', timeStyle: 'short' }).format(d);
    } else {
      text = new Intl.DateTimeFormat(locale(), { timeZone: TZ, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(d);
    }
    el.textContent = text;
    el.title = new Intl.DateTimeFormat(locale(), { timeZone: TZ, dateStyle: 'full', timeStyle: 'short' }).format(d);
  });
  $$('[data-day]').forEach((el) => {
    const day = el.dataset.day!;
    el.textContent =
      day === today ? 'امروز' : day === yesterday ? 'دیروز'
      : new Intl.DateTimeFormat(locale(), { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${day}T12:00:00Z`));
  });
}

function renderDigits() {
  const latn = settings.digits === 'latn';
  $$('[data-num]').forEach((el) => {
    el.dataset.orig ??= el.textContent ?? '';
    el.textContent = latn ? el.dataset.orig.replace(/[۰-۹]/g, (c) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c))) : el.dataset.orig;
  });
}

// ---------- toast ----------
let toastTimer: number | undefined;
function toast(msg: string) {
  const el = $('[data-toast]');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), 2200);
}

// ---------- bookmarks ----------
type Saved = { id: number; title: string; href: string; cover?: string; excerpt?: string; date?: string };
const getSaved = () => store.get<Saved[]>('saved', []);
function renderSaved() {
  const ids = new Set(getSaved().map((s) => s.id));
  $$('[data-save]').forEach((b) => {
    const on = ids.has(Number(b.dataset.id));
    b.setAttribute('aria-pressed', String(on));
    b.setAttribute('aria-label', on ? 'حذف از ذخیره‌ها' : 'ذخیره برای بعد');
    b.title = on ? 'حذف از ذخیره‌ها (s)' : 'ذخیره برای بعد (s)';
  });
  const badge = $('[data-saved-count]');
  if (badge) {
    badge.hidden = ids.size === 0;
    badge.textContent = fmtNum(ids.size);
  }
}
function toggleSave(btn: HTMLElement) {
  const id = Number(btn.dataset.id);
  const list = getSaved();
  const i = list.findIndex((s) => s.id === id);
  if (i >= 0) {
    list.splice(i, 1);
    toast('از ذخیره‌ها حذف شد');
  } else {
    const d = btn.dataset;
    list.unshift({ id, title: d.title!, href: d.href!, cover: d.cover || undefined, excerpt: d.excerpt, date: d.date });
    toast('ذخیره شد — در «ذخیره‌شده‌ها» پیدایش کنید');
  }
  store.set('saved', list);
  renderSaved();
  document.dispatchEvent(new CustomEvent('saved-change'));
}

// ---------- read / new-since-last-visit ----------
const readIds = new Set(store.get<number[]>('read', []));
function markReadState() {
  $$('.card[data-id]').forEach((c) => c.classList.toggle('is-read', readIds.has(Number(c.dataset.id))));
}
const article = $('[data-article]');
if (article) {
  readIds.add(Number(article.dataset.id));
  store.set('read', [...readIds].slice(-3000));
}
function markNew() {
  const lastSeen = store.get<number>('lastSeen', 0);
  const cards = $$('.card[data-id]');
  if (!cards.length) return;
  const maxId = Math.max(...cards.map((c) => Number(c.dataset.id)));
  if (lastSeen) {
    let firstOld: HTMLElement | null = null;
    for (const c of cards) {
      if (Number(c.dataset.id) > lastSeen) {
        const meta = $('.meta', c);
        if (meta && !$('.new', meta)) meta.insertAdjacentHTML('afterbegin', '<span class="new">تازه</span>');
      } else if (!firstOld) firstOld = c;
    }
    if (firstOld && firstOld !== cards[0] && !$('.new-divider')) {
      firstOld.insertAdjacentHTML('beforebegin', '<div class="new-divider" role="separator">خبرهای قبلی که دیده بودید</div>');
    }
  }
  if (maxId > lastSeen) setTimeout(() => store.set('lastSeen', maxId), 4000);
}

// ---------- share / copy ----------
async function share(urlStr: string, title: string) {
  const full = new URL(urlStr, location.href).href;
  if (navigator.share) {
    try {
      await navigator.share({ title, url: full });
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
  }
  copy(full);
}
async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast('پیوند کپی شد');
  } catch {
    prompt('پیوند را کپی کنید:', text);
  }
}

// ---------- delegated clicks (works for cards appended by "load more") ----------
document.addEventListener('click', (e) => {
  const t = e.target as Element;
  const save = t.closest<HTMLElement>('[data-save]');
  if (save) return toggleSave(save);
  const sh = t.closest<HTMLElement>('[data-share]');
  if (sh) return share(sh.dataset.url!, sh.dataset.title ?? document.title);
  const cp = t.closest<HTMLElement>('[data-copy]');
  if (cp) return copy(new URL(cp.dataset.copy!, location.href).href);
  const reveal = t.closest('.reveal');
  if (reveal) return reveal.closest('.media')?.classList.add('revealed');
  const top = t.closest('[data-to-top]');
  if (top) return scrollTo({ top: 0, behavior: 'smooth' });
  const more = t.closest<HTMLAnchorElement>('[data-load-more]');
  if (more) {
    e.preventDefault();
    loadMore(more);
  }
});

// Only one video plays at a time.
document.addEventListener('play', (e) => $$<HTMLVideoElement>('video').forEach((v) => v !== e.target && v.pause()), true);

// ---------- load more (progressive: the link is a normal pagination link) ----------
async function loadMore(link: HTMLAnchorElement) {
  link.setAttribute('aria-busy', 'true');
  link.textContent = 'در حال بارگذاری…';
  try {
    const html = await (await fetch(link.href)).text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const feed = $('.feed');
    const lastDay = $$('[data-day]', feed!).pop()?.dataset.day;
    const items = $$('.feed > *', doc);
    if (items[0]?.dataset.day && items[0].dataset.day === lastDay) items.shift();
    feed?.append(...items.map((n) => document.adoptNode(n)));
    const next = $<HTMLAnchorElement>('[data-load-more]', doc);
    if (next) {
      link.href = next.href;
      link.textContent = 'خبرهای بیشتر';
      link.removeAttribute('aria-busy');
    } else link.closest('.load-more')?.remove();
    enhance();
  } catch {
    location.href = link.href;
  }
}

// ---------- header, progress, back-to-top ----------
const header = $('[data-header]');
const bar = $('.progress i');
const toTop = $('[data-to-top]');
let lastY = scrollY;
let ticking = false;
addEventListener(
  'scroll',
  () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const y = scrollY;
      if (header) header.classList.toggle('is-hidden', settings.header === 'auto' && y > 240 && y > lastY && !settingsDialog?.open);
      toTop?.classList.toggle('show', y > 1400);
      if (bar && article) {
        const r = article.getBoundingClientRect();
        const total = r.height - innerHeight + 120;
        bar.style.transform = `scaleX(${Math.min(1, Math.max(0, (-r.top + 60) / Math.max(total, 1)))})`;
      }
      lastY = y;
      ticking = false;
    });
  },
  { passive: true },
);

// ---------- keyboard ----------
let focusIdx = -1;
let pendingG = false;
function focusCard(delta: number) {
  const cards = $$('.card[data-id]');
  if (!cards.length) return;
  cards[focusIdx]?.classList.remove('is-focused');
  focusIdx = Math.max(0, Math.min(cards.length - 1, focusIdx + delta));
  const c = cards[focusIdx];
  c.classList.add('is-focused');
  c.scrollIntoView({ block: 'center', behavior: settings.motion === 'reduce' ? 'auto' : 'smooth' });
}
document.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  if (e.metaKey || e.ctrlKey || e.altKey || t.closest('input, textarea, select, [contenteditable]') || document.querySelector('dialog[open]')) return;
  const key = e.key;
  if (pendingG) {
    pendingG = false;
    if (key === 'h') location.href = `${BASE}/`;
    if (key === 's') location.href = `${BASE}/saved/`;
    return;
  }
  const focused = $$('.card[data-id]')[focusIdx];
  switch (key) {
    case 'j': focusCard(1); break;
    case 'k': focusCard(-1); break;
    case 'o': case 'Enter': if (focused) $<HTMLAnchorElement>('h2 a', focused)?.click(); else return; break;
    case 's': { const b = focused ? $('[data-save]', focused) : $('[data-article] [data-save]'); if (b) toggleSave(b); break; }
    case 'n': $<HTMLAnchorElement>('[data-next]')?.click(); break;
    case 'p': $<HTMLAnchorElement>('[data-prev]')?.click(); break;
    case '/': location.href = `${BASE}/search/`; break;
    case 't': toggleTheme(); break;
    case ',': openSettings(); break;
    case '+': case '=': bumpFont(1); break;
    case '-': bumpFont(-1); break;
    case '?': keysDialog?.showModal(); break;
    case 'g': pendingG = true; setTimeout(() => (pendingG = false), 1200); break;
    default: return;
  }
  e.preventDefault();
});

// ---------- boot ----------
function enhance() {
  renderDates();
  renderDigits();
  renderSaved();
  markReadState();
  $$<HTMLDetailsElement>('details[data-source]').forEach((d) => (d.open = settings.source === 'open'));
}
applySettings();
enhance();
markNew();
setInterval(renderDates, 60_000);

// Offline reading + faster repeat visits on flaky connections.
if ('serviceWorker' in navigator && location.hostname !== 'localhost') {
  addEventListener('load', () => navigator.serviceWorker.register(`${BASE}/sw.js`).catch(() => {}));
}

export { getSaved, store };
