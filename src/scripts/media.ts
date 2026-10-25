// Images and videos come from Telegram/X, whose CDNs are filtered for most readers (Iran) and slow for others.
// An image arrives with its addresses best first (src/lib/posts.ts, picture()): src, then data-alt, space-separated —
// the image proxy, the site's own relay, the original. A failed address moves on to the next one, and so does one that
// just hangs (filtered connections often never answer). While an image loads it shows a soft placeholder. Offline, it
// waits for the connection instead of using up its addresses. When all failed, the whole list is tried once more,
// then the item falls back: a gallery shows "not loaded" with retry + a link to the post, a cover drops out, and small
// decorative images (avatars, thumbnails) turn into a neutral icon instead of a broken-image glyph.
import { $$, esc } from './core';

const RETRY_MS = 2500;
/** An image that hasn't arrived this long after it started loading is treated as failed (a video: twice as long). */
const SLOW_MS = 9000;
const PLACEHOLDER =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#8b93a7" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/></svg>',
  );

type MediaEl = HTMLImageElement | HTMLVideoElement;
const isMedia = (el: EventTarget | null): el is MediaEl => el instanceof HTMLImageElement || el instanceof HTMLVideoElement;
const srcOf = (el: MediaEl) => el.getAttribute('src') ?? '';
const remote = (src: string) => !!src && !src.startsWith('data:') && !src.startsWith('blob:');
/** Figures taken over by a fallback box keep their original content, so "retry" can put it back. */
const originals = new WeakMap<Element, Node[]>();

// The service worker caches cross-origin images without seeing their status, so a failed response could be
// replayed from its cache forever: ask it to forget the URL before trying again.
const evict = (url: string) => navigator.serviceWorker?.controller?.postMessage({ evict: url });

/** Every address of an element, best first; fixed at its first failure so a retry starts over from the top. */
function addresses(el: MediaEl) {
  el.dataset.chain ??= [srcOf(el), ...(el.dataset.alt ?? '').split(' ')].filter(Boolean).join(' ');
  return el.dataset.chain.split(' ');
}

function go(el: MediaEl, url: string) {
  if (!el.isConnected || !url) return;
  if (el instanceof HTMLImageElement) el.dataset.loading = '';
  if (srcOf(el) === url) el.removeAttribute('src');
  el.src = url;
  if (el instanceof HTMLVideoElement) el.load();
  watch(el);
}

// ---------- slow addresses ----------
const timers = new WeakMap<MediaEl, number>();
const arrived = (el: MediaEl) => (el instanceof HTMLImageElement ? el.complete && el.naturalWidth > 0 : el.readyState >= 2);
/** Starts the clock on the address being loaded now. */
function watch(el: MediaEl) {
  clearTimeout(timers.get(el));
  const url = srcOf(el);
  if (!remote(url) || arrived(el)) return;
  timers.set(
    el,
    window.setTimeout(() => {
      // Hidden tabs throttle loading: judge only what the reader is waiting for.
      if (el.isConnected && srcOf(el) === url && !arrived(el) && navigator.onLine && document.visibilityState === 'visible') failed(el);
    }, el instanceof HTMLVideoElement ? SLOW_MS * 2 : SLOW_MS),
  );
}
// Lazy images start loading near the viewport: that's when their clock starts.
const nearby =
  'IntersectionObserver' in window
    ? new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (!e.isIntersecting) continue;
            nearby?.unobserve(e.target);
            watch(e.target as HTMLImageElement);
          }
        },
        { rootMargin: '600px 0px' },
      )
    : null;

function failed(el: MediaEl) {
  clearTimeout(timers.get(el));
  delete el.dataset.loading;
  const src = srcOf(el);
  if (!remote(src)) return;
  // Offline: try the same address again when the connection is back, rather than giving up on the others.
  if (!navigator.onLine) return void addEventListener('online', () => go(el, src), { once: true });
  evict(src);
  const list = addresses(el);
  const at = Math.max(0, list.indexOf(src)) + 1;
  if (at < list.length) return go(el, list[at]);
  if (!el.dataset.retried) {
    el.dataset.retried = '1';
    setTimeout(() => go(el, list[0]), RETRY_MS);
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

/** Puts a new picture into an element that is reused (lightbox, preview), with its own fallback addresses. */
export function showImage(el: HTMLImageElement, src: string, alt = '') {
  delete el.dataset.retried;
  delete el.dataset.chain;
  el.classList.remove('img-ph');
  if (alt) el.dataset.alt = alt;
  else delete el.dataset.alt;
  go(el, src);
}

function gone(fig: Element, el: MediaEl, href: string) {
  originals.set(fig, [...fig.childNodes]);
  const where = /^https:\/\/t\.me\//.test(href) ? 'دیدن در تلگرام' : 'دیدن در منبع';
  const box = document.createElement('div');
  box.className = 'media-gone';
  // A video that won't play here still shows its picture (the poster comes through the image proxy).
  const poster = el instanceof HTMLVideoElement ? el.getAttribute('poster') : null;
  if (poster) box.style.setProperty('--poster', `url("${poster.replace(/["\\]/g, '')}")`);
  box.innerHTML = `<img src="${PLACEHOLDER}" alt="" width="28" height="28">
    <span>${el instanceof HTMLVideoElement ? 'ویدیو با این اتصال باز نشد' : 'تصویر بارگذاری نشد'}</span>
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
    el.dataset.retried = '1'; // one more round of failures goes straight back to the fallback box
    go(el, addresses(el)[0]);
  }
}

/** Mark images that are still loading, and handle the ones that already failed before this script ran. */
export function watchMedia(root: ParentNode = document) {
  for (const img of $$<HTMLImageElement>('img', root)) {
    if (!remote(srcOf(img))) continue;
    if (img.complete && !img.naturalWidth) failed(img);
    else if (!img.complete) {
      img.dataset.loading = '';
      if (img.loading === 'lazy' && nearby) nearby.observe(img);
      else watch(img);
    }
  }
  for (const video of $$<HTMLVideoElement>('video', root)) if (video.error) failed(video);
}

document.addEventListener(
  'load',
  (e) => {
    const el = e.target;
    if (!(el instanceof HTMLImageElement) || el.src.startsWith('data:')) return;
    clearTimeout(timers.get(el));
    delete el.dataset.loading;
    delete el.dataset.retried;
    el.classList.remove('img-ph');
  },
  true,
);
// A video only loads once it's played (preload="none"): its clock starts then.
document.addEventListener('play', (e) => e.target instanceof HTMLVideoElement && watch(e.target), true);
document.addEventListener('loadeddata', (e) => e.target instanceof HTMLVideoElement && clearTimeout(timers.get(e.target)), true);
document.addEventListener('error', (e) => isMedia(e.target) && failed(e.target), true);
document.addEventListener('click', (e) => {
  const btn = (e.target as Element).closest('[data-media-retry]');
  if (btn) {
    e.preventDefault();
    retry(btn);
  }
});
