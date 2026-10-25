// Client behaviour for every page. Everything is progressive: the site works without JS.
import { $, $$, BASE, PAGE_CACHE, fmtNum, getSaved, relTime, store, toast, type Entry } from './core';
import { award, clearSeen, markAllSeen, markNew, recordRead, renderMe, unreadTest } from './game';
import { STORY_SHOW, TZ, decodeStories, pickStories, tehranDay, type StoryOrder, type StoryShow } from '../lib/time';
import { SITE } from '../site';
import { showImage, watchMedia } from './media';
import { initPeek, peek } from './peek';
import { initReader, readerProgress, stepSize, toggleFocus } from './reader';
import { initSocial, loadEngage } from './social';
import { initVoiceOffer } from './voice-offer';

export { getSaved, getHistory, rowHtml, store } from './core';

const root = document.documentElement;

// ---------- display settings ----------
type Settings = { theme: string; size: string; spacing: string; focus: string; view: string; media: string; story: StoryShow; order: StoryOrder };
const DEFAULTS: Settings = { theme: 'auto', size: 'm', spacing: 'm', focus: 'off', view: 'cards', media: 'show', story: 'unseen', order: 'new' };
let settings: Settings = { ...DEFAULTS, ...store.get<Partial<Settings>>('settings', {}) };
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
const resolvedTheme = () => (settings.theme === 'auto' ? (darkQuery.matches ? 'dark' : 'light') : settings.theme);

function applySettings() {
  root.dataset.theme = resolvedTheme();
  root.dataset.size = settings.size;
  root.dataset.spacing = settings.spacing;
  root.dataset.focus = settings.focus;
  root.dataset.view = settings.view;
  root.dataset.media = settings.media;
  $$('[data-set-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.setView === settings.view)));
  $$('[data-focus-toggle]').forEach((b) => b.setAttribute('aria-pressed', String(settings.focus === 'on')));
}
function saveSettings(patch: Partial<Settings>) {
  settings = { ...settings, ...patch };
  store.set('settings', Object.fromEntries(Object.entries(settings).filter(([k, v]) => DEFAULTS[k as keyof Settings] !== v)));
  applySettings();
  syncForm();
}
darkQuery.addEventListener('change', () => settings.theme === 'auto' && applySettings());

const settingsDialog = $<HTMLDialogElement>('#settings');
const form = $<HTMLFormElement>('[data-settings-form]');
function syncForm() {
  for (const [k, v] of Object.entries(settings)) {
    const input = form?.querySelector<HTMLInputElement>(`input[name="${k}"][value="${v}"]`);
    if (input) input.checked = true;
  }
}
/** What the stories show changed: the rail redraws, an open player starts over once the sheet closes. */
const storiesChanged = () => (renderRail(), document.dispatchEvent(new Event('stories-changed')));
form?.addEventListener('input', (e) => {
  const t = e.target as HTMLInputElement;
  saveSettings({ [t.name]: t.value });
  if (t.name === 'story' || t.name === 'order') storiesChanged();
});
$('[data-reset]')?.addEventListener('click', () => {
  settings = { ...DEFAULTS };
  saveSettings({});
  storiesChanged();
  toast('تنظیمات به حالت پیش‌فرض برگشت');
});
$('[data-seen-all]')?.addEventListener('click', () => {
  markAllSeen();
  storiesChanged();
  toast('همه‌ی خبرها دیده‌شده حساب شدند؛ استوری فقط خبرهای تازه‌تر را نشان می‌دهد');
});
$('[data-seen-clear]')?.addEventListener('click', () => {
  clearSeen();
  storiesChanged();
  toast('استوری از نو: خبرهای دیده‌شده دوباره پخش می‌شوند (جز آن‌هایی که باز کرده‌اید)');
});
for (const dlg of $$<HTMLDialogElement>('dialog')) {
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg || (e.target as Element).closest('[data-close]')) dlg.close();
  });
}
$$('[data-open-settings]').forEach((b) => b.addEventListener('click', () => (syncForm(), settingsDialog?.showModal())));
const toggleTheme = () => saveSettings({ theme: resolvedTheme() === 'dark' ? 'light' : 'dark' });
$$('[data-theme-toggle]').forEach((b) => b.addEventListener('click', toggleTheme));

// ---------- relative times (rendered client-side so they never go stale) ----------
function renderDates() {
  $$<HTMLTimeElement>('time[data-f]').forEach((el) => {
    const d = new Date(el.dateTime);
    const full = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: TZ, dateStyle: 'full', timeStyle: 'short' }).format(d);
    el.textContent = el.dataset.f === 'long' ? full : relTime(el.dateTime);
    el.title = full;
  });
  const today = tehranDay(new Date());
  const yesterday = tehranDay(new Date(Date.now() - 864e5));
  $$('[data-day]').forEach((el) => {
    const label = $('[data-day-label]', el);
    if (!label) return;
    label.dataset.orig ??= label.textContent ?? '';
    const day = el.dataset.day;
    label.textContent = day === today ? `امروز · ${label.dataset.orig}` : day === yesterday ? `دیروز · ${label.dataset.orig}` : label.dataset.orig;
    el.classList.toggle('is-today', day === today);
  });
}

// ---------- bookmarks (saved pages are also stored for offline reading) ----------
function renderSaved() {
  const ids = new Set(getSaved().map((s) => s.id));
  $$('[data-save]').forEach((b) => {
    const on = ids.has(Number(b.dataset.id));
    b.setAttribute('aria-pressed', String(on));
    b.setAttribute('aria-label', on ? 'حذف از ذخیره‌ها' : 'ذخیره برای بعد');
  });
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
    list.unshift({ id, title: d.title!, href: d.href!, cover: d.cover || undefined, date: d.date });
    caches?.open(PAGE_CACHE).then((c) => c.add(d.href!)).catch(() => {});
    award('save');
    toast('ذخیره شد — حتی آفلاین هم در دسترس است');
  }
  store.set('saved', list);
  renderSaved();
  document.dispatchEvent(new CustomEvent('saved-change'));
}

// ---------- share / copy ----------
/** Shared links always point at the primary site (a mirror's address would split the story's audience and ranking). */
const primary = (urlStr: string) => {
  const u = new URL(urlStr, location.href);
  return u.origin === location.origin ? new URL(u.pathname.slice(BASE.length).replace(/^\//, '') + u.search, `${SITE.url}/`).href : u.href;
};
async function share(urlStr: string, title: string) {
  const full = primary(urlStr);
  if (navigator.share) {
    try {
      // Messengers keep the text and drop the title: the headline and the site's name go in the text.
      await navigator.share({ title, text: `${title}\n— ${SITE.name}`, url: full });
      award('share');
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
    award('share');
  } catch {
    prompt('پیوند را کپی کنید:', text);
  }
}

// ---------- lightbox ----------
const lightbox = $<HTMLDialogElement>('#lightbox');
function zoom(img: HTMLImageElement) {
  const big = $<HTMLImageElement>('[data-lightbox-img]', lightbox!);
  if (!lightbox || !big) return;
  // The large picture's own addresses, then the one already on screen.
  showImage(big, img.dataset.zoom || img.src, [img.dataset.zoomAlt, img.src].filter(Boolean).join(' '));
  big.alt = img.alt;
  lightbox.showModal();
}

// ---------- delegated clicks (also covers items appended by "load more") ----------
document.addEventListener('click', (e) => {
  const t = e.target as Element;
  const save = t.closest<HTMLElement>('[data-save]');
  if (save) return toggleSave(save);
  const sh = t.closest<HTMLElement>('[data-share]');
  if (sh) return void share(sh.dataset.url!, sh.dataset.title ?? document.title);
  const cp = t.closest<HTMLElement>('[data-copy]');
  if (cp) return void copy(primary(cp.dataset.copy!));
  const view = t.closest<HTMLElement>('[data-set-view]');
  if (view) return saveSettings({ view: view.dataset.setView! });
  const gallery = t.closest<HTMLElement>('.gallery');
  if (gallery && root.dataset.media === 'tap' && !gallery.classList.contains('revealed')) {
    e.preventDefault();
    return gallery.classList.add('revealed');
  }
  const img = t.closest<HTMLImageElement>('.gallery img[data-zoom]');
  if (img) return zoom(img);
  if (t.closest('[data-to-top]')) return scrollTo({ top: 0, behavior: 'smooth' });
  const more = t.closest<HTMLAnchorElement>('[data-load-more]');
  if (more) {
    e.preventDefault();
    loadMore(more);
  }
});

// Only one video plays at a time.
document.addEventListener('play', (e) => $$<HTMLVideoElement>('video').forEach((v) => v !== e.target && !v.loop && v.pause()), true);

// ---------- load more (progressive: the link is a normal pagination link) ----------
async function loadMore(link: HTMLAnchorElement) {
  link.setAttribute('aria-busy', 'true');
  const label = link.innerHTML;
  link.textContent = 'در حال بارگذاری…';
  try {
    const doc = new DOMParser().parseFromString(await (await fetch(link.href)).text(), 'text/html');
    const tl = $('[data-tl]')!;
    const lastDay = $$('[data-day]', tl).pop()?.dataset.day;
    const items = $$('[data-tl] > *', doc);
    if (items[0]?.dataset.day && items[0].dataset.day === lastDay) items.shift();
    const added = items.map((n) => document.adoptNode(n));
    tl.append(...added);
    const next = $<HTMLAnchorElement>('[data-load-more]', doc);
    if (next) {
      link.href = next.href;
      link.innerHTML = label;
      link.removeAttribute('aria-busy');
    } else link.closest('.pager-nav')?.remove();
    history.replaceState(history.state, '', location.href);
    renderDates();
    renderSaved();
    markNew();
    watchMedia(tl);
    loadEngage(tl);
  } catch {
    location.href = link.href;
  }
}

// ---------- reading progress, back-to-top, bars that step aside ----------
// Scrolling down hides the header and tab bar on phones (and the reading tools in reading mode), scrolling up brings
// them back: more room for the text, and nothing fixed fighting iOS Safari's own collapsing toolbar.
const bar = $('.progress i');
const toTop = $('[data-to-top]');
const article = $('[data-article]');
let ticking = false;
let lastY = scrollY;
addEventListener(
  'scroll',
  () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      // iOS reports rubber-band overscroll past both ends: clamp it, so a bounce never flips the bars.
      const max = document.documentElement.scrollHeight - innerHeight;
      const y = Math.min(Math.max(scrollY, 0), max);
      const atEnd = y >= max - 80;
      if (y < 120 || atEnd) root.dataset.chrome = 'show';
      else if (Math.abs(y - lastY) > 16) root.dataset.chrome = y > lastY ? 'hide' : 'show';
      if (Math.abs(y - lastY) > 16 || y < 120) lastY = y;
      toTop?.classList.toggle('show', y > 1400);
      if (article) {
        const r = article.getBoundingClientRect();
        const ratio = Math.min(1, Math.max(0, (-r.top + 80) / Math.max(r.height - innerHeight, 1)));
        if (bar) bar.style.transform = `scaleX(${ratio})`;
        readerProgress(ratio);
      }
      ticking = false;
    });
  },
  { passive: true },
);

// ---------- keyboard ----------
let focusIdx = -1;
function focusItem(delta: number) {
  const items = $$('[data-tl] .tl-item');
  if (!items.length) return;
  items[focusIdx]?.classList.remove('is-focused');
  focusIdx = Math.max(0, Math.min(items.length - 1, focusIdx + delta));
  items[focusIdx].classList.add('is-focused');
  items[focusIdx].scrollIntoView({ block: 'center', behavior: 'smooth' });
}
document.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  if (e.metaKey || e.ctrlKey || e.altKey || t.closest('input, textarea, select, [contenteditable]') || $('dialog[open]')) return;
  const focused = $$('[data-tl] .tl-item')[focusIdx];
  switch (e.key) {
    case 'j': focusItem(1); break;
    case 'k': focusItem(-1); break;
    case 'o': case 'Enter': if (focused) $<HTMLAnchorElement>('h3 a', focused)?.click(); else return; break;
    case 'n': $<HTMLAnchorElement>('[data-next]')?.click(); break;
    case 'p': $<HTMLAnchorElement>('[data-prev]')?.click(); break;
    case '/': location.href = `${BASE}/search/`; break;
    case 't': toggleTheme(); break;
    case 'v': {
      const link = focused && $<HTMLAnchorElement>('h3 a', focused);
      if (!link || !peek(link)) return;
      break;
    }
    case '+': case '=': if (!article) return; stepSize(1); break;
    case '-': if (!article) return; stepSize(-1); break;
    case 'f': if (!article) return; toggleFocus(); break;
    case 'Escape': if (!article || settings.focus !== 'on') return; toggleFocus(); break;
    default: return;
  }
  e.preventDefault();
});

// ---------- offline & install ----------
const offlineBar = $('[data-offline]');
const syncOnline = () => offlineBar && (offlineBar.hidden = navigator.onLine);
addEventListener('online', () => (syncOnline(), toast('دوباره آنلاین شدید')));
addEventListener('offline', syncOnline);
syncOnline();

let installEvent: (Event & { prompt: () => Promise<void> }) | null = null;
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvent = e as typeof installEvent;
  $$('[data-install]').forEach((b) => (b.hidden = false));
});
$$('[data-install]').forEach((b) =>
  b.addEventListener('click', async () => {
    await installEvent?.prompt();
    installEvent = null;
    $$('[data-install]').forEach((x) => (x.hidden = true));
  }),
);

if ('serviceWorker' in navigator && location.hostname !== 'localhost') {
  addEventListener('load', () => navigator.serviceWorker.register(`${BASE}/sw.js`).catch(() => {}));
}

// ---------- story rail (home): one circle with what the stories show (settings), the newest unseen one's picture ----------
function renderRail() {
  const rail = $('[data-rail]');
  const a = rail && $<HTMLAnchorElement>('[data-rail-ids]', rail);
  if (!rail || !a) return;
  const unread = unreadTest();
  const list = pickStories(decodeStories(a.dataset.railIds ?? ''), settings.story, 'new', unread);
  rail.hidden = !list.length;
  if (!list.length) return;
  const unseen = list.filter((i) => unread(i.id));
  const faces = $$<HTMLImageElement>('[data-face]', a);
  const faceOf = (id: number) => faces.find((img) => Number(img.dataset.face) === id);
  const face = [...unseen, ...list].map((i) => faceOf(i.id)).find(Boolean);
  faces.forEach((img) => (img.hidden = img !== face));
  const name = STORY_SHOW[settings.story];
  $('small', a)!.textContent = name;
  const count = $('[data-rail-n]', a)!;
  count.hidden = !unseen.length;
  count.textContent = fmtNum(unseen.length);
  a.setAttribute('aria-label', unseen.length ? `${name} · ${fmtNum(unseen.length)} خبر ندیده` : name);
  a.classList.toggle('seen', !unseen.length);
}
// Coming back from the player (bfcache) shows what was just watched.
addEventListener('pageshow', (e) => e.persisted && renderRail());

// ---------- boot ----------
applySettings();
renderDates();
renderSaved();
renderMe();
if (article) {
  const d = article.dataset;
  const entry: Entry = { id: Number(d.id), title: d.title!, href: d.href!, cover: d.cover || undefined };
  recordRead(entry, (d.tags ?? '').split(',').filter(Boolean));
}
markNew();
renderRail();
watchMedia();
initSocial();
initPeek();
initVoiceOffer();
initReader(() => settings, saveSettings);
setInterval(renderDates, 60_000);
