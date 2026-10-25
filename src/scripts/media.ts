// Images and videos come straight from Telegram/X, often over slow or filtered connections.
// While an image loads it shows a soft placeholder. A Telegram URL that fails first switches to its fresh address
// (data-fresh → /api/media, which redirects to the URL Telegram signs today: stored ones expire); any failure is then
// retried once (after the connection is back),
// then the item falls back: a gallery shows "not loaded" with retry + a link to the post, a cover drops out,
// and small decorative images (avatars, thumbnails) turn into a neutral icon instead of a broken-image glyph.
import { $$, esc } from './core';

const RETRY_MS = 2500;
const PLACEHOLDER =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#8b93a7" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/></svg>',
  );

type MediaEl = HTMLImageElement | HTMLVideoElement;
const isMedia = (el: EventTarget | null): el is MediaEl => el instanceof HTMLImageElement || el instanceof HTMLVideoElement;
const srcOf = (el: MediaEl) => el.getAttribute('src') ?? '';
/** Figures taken over by a fallback box keep their original content, so "retry" can put it back. */
const originals = new WeakMap<Element, Node[]>();

// The service worker caches cross-origin images without seeing their status, so a failed response could be
// replayed from its cache forever: ask it to forget the URL before trying again.
const evict = (url: string) => navigator.serviceWorker?.controller?.postMessage({ evict: url });

function load(el: MediaEl) {
  const src = srcOf(el);
  if (!el.isConnected || !src) return;
  evict(src);
  if (el instanceof HTMLVideoElement) return el.load();
  el.dataset.loading = '';
  el.removeAttribute('src');
  el.src = src;
}

function failed(el: MediaEl) {
  delete el.dataset.loading;
  const src = srcOf(el);
  if (!src || src.startsWith('data:')) return;
  const fresh = el.dataset.fresh;
  if (fresh && !el.dataset.refreshed && src !== fresh) {
    el.dataset.refreshed = '1';
    evict(src); // the expired copy shouldn't be replayed from the offline cache on the next visit
    if (navigator.onLine) return void (el.src = fresh);
    return void addEventListener('online', () => el.isConnected && (el.src = fresh), { once: true });
  }
  if (!el.dataset.retried) {
    el.dataset.retried = '1';
    const again = () => setTimeout(() => load(el), RETRY_MS);
    if (navigator.onLine) again();
    else addEventListener('online', again, { once: true });
    return;
  }
  const href = el.dataset.fallback;
  const lead = el.closest('.lead-main');
  if (lead) {
    el.remove();
    lead.classList.add('no-img');
    return;
  }
  const holder = href && el.closest('figure, .story-cover, .og');
  if (holder && holder.tagName === 'FIGURE') return void gone(holder, el, href);
  if (holder) return void holder.remove(); // a cover or link preview: the card reads fine without it
  if (el instanceof HTMLVideoElement) return void el.remove();
  el.classList.add('img-ph');
  el.src = PLACEHOLDER;
}

function gone(fig: Element, el: MediaEl, href: string) {
  originals.set(fig, [...fig.childNodes]);
  const what = el instanceof HTMLVideoElement ? 'ویدیو' : 'تصویر';
  const where = /^https:\/\/t\.me\//.test(href) ? 'دیدن در تلگرام' : 'دیدن در منبع';
  const box = document.createElement('div');
  box.className = 'media-gone';
  box.innerHTML = `<img src="${PLACEHOLDER}" alt="" width="28" height="28">
    <span>${what} بارگذاری نشد</span>
    <span class="mg-actions"><button type="button" data-media-retry>تلاش دوباره</button><a href="${esc(href)}" target="_blank" rel="noopener">${where}</a></span>`;
  fig.replaceChildren(box);
}

function retry(btn: Element) {
  const fig = btn.closest('figure');
  const kids = fig && originals.get(fig);
  if (!fig || !kids) return;
  fig.replaceChildren(...kids);
  originals.delete(fig);
  const el = kids.find(isMedia);
  if (el) {
    el.dataset.retried = '1'; // one more failure goes straight back to the fallback box
    load(el);
  }
}

/** Mark images that are still loading, and handle the ones that already failed before this script ran. */
export function watchMedia(root: ParentNode = document) {
  for (const img of $$<HTMLImageElement>('img', root)) {
    if (!srcOf(img) || srcOf(img).startsWith('data:')) continue;
    if (!img.complete) img.dataset.loading = '';
    else if (!img.naturalWidth) failed(img);
  }
  for (const video of $$<HTMLVideoElement>('video', root)) if (video.error) failed(video);
}

document.addEventListener(
  'load',
  (e) => {
    const el = e.target;
    if (!(el instanceof HTMLImageElement) || el.src.startsWith('data:')) return;
    delete el.dataset.loading;
    delete el.dataset.retried;
    el.classList.remove('img-ph');
  },
  true,
);
document.addEventListener('error', (e) => isMedia(e.target) && failed(e.target), true);
document.addEventListener('click', (e) => {
  const btn = (e.target as Element).closest('[data-media-retry]');
  if (btn) {
    e.preventDefault();
    retry(btn);
  }
});
