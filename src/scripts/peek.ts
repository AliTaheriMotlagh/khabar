// Long-press (or "v" on a focused story) any link to a story to preview it in a sheet without leaving the page.
import { $, BASE, esc, fmtNum, getSaved, relTime } from './core';
import { showImage } from './media';

type Card = {
  id: number; kind: string; title: string; href: string; date: string; minutes: number;
  tag: string | null; site: string | null; cover: string | null; coverAlt?: string | null; thumb: string; body: string[]; why: string | null;
};

const HOLD_MS = 420;
const SLOP = 10; // px a finger may drift before the press counts as a scroll
const STORY = new RegExp(`^${BASE}/p/(\\d+)/$`);
const dialog = $<HTMLDialogElement>('#peek');
const cards = new Map<string, Promise<Card>>();

/** The story page a link points to on this site, or null. */
function storyPath(a: HTMLAnchorElement) {
  const u = new URL(a.href, location.href);
  return u.origin === location.origin && STORY.test(u.pathname) && u.pathname !== location.pathname ? u.pathname : null;
}

function load(path: string) {
  let p = cards.get(path);
  if (!p) {
    p = fetch(`${path}card.json`).then((r) => (r.ok ? (r.json() as Promise<Card>) : Promise.reject(new Error(String(r.status)))));
    p.catch(() => cards.delete(path));
    cards.set(path, p);
  }
  return p;
}

function fill(c: Partial<Card> & { title: string; href: string }, state: 'loading' | 'ready' | 'failed') {
  if (!dialog) return;
  const set = (sel: string, text: string) => {
    const el = $(sel, dialog)!;
    el.textContent = text;
    el.hidden = !text;
  };
  set('[data-peek-tag]', c.tag ?? '');
  set('[data-peek-site]', c.site ?? '');
  set('[data-peek-when]', c.date ? `${relTime(c.date)}، ${fmtNum(c.minutes ?? 1)} دقیقه مطالعه` : '');
  set('[data-peek-title]', c.title);
  const cover = $<HTMLImageElement>('[data-peek-cover]', dialog)!;
  cover.hidden = !c.cover;
  if (c.cover && cover.getAttribute('src') !== c.cover) {
    showImage(cover, c.cover, c.coverAlt ?? '');
  }
  const text = $('[data-peek-text]', dialog)!;
  text.innerHTML =
    state === 'loading'
      ? '<p class="peek-skel"></p><p class="peek-skel"></p><p class="peek-skel short"></p>'
      : state === 'failed'
        ? '<p class="muted">پیش‌نمایش این خبر الان در دسترس نیست؛ برای خواندن، خبر را باز کنید.</p>'
        : (c.body ?? []).map((p) => `<p>${esc(p)}</p>`).join('') + (c.why ? `<aside class="why"><b>چرا مهمه؟</b><p>${esc(c.why)}</p></aside>` : '');
  $<HTMLAnchorElement>('[data-peek-open]', dialog)!.href = c.href;
  const share = $('[data-peek-share]', dialog)!;
  share.dataset.url = c.href;
  share.dataset.title = c.title;
  const save = $('[data-peek-save]', dialog)!;
  save.hidden = !c.id;
  if (c.id) {
    Object.assign(save.dataset, { id: String(c.id), title: c.title, href: c.href, cover: c.thumb ?? '', date: c.date ?? '' });
    const on = getSaved().some((s) => s.id === c.id);
    save.setAttribute('aria-pressed', String(on));
    save.setAttribute('aria-label', on ? 'حذف از ذخیره‌ها' : 'ذخیره برای بعد');
  }
}

/** Open the preview for a story link. Returns false when the link isn't a story on this site. */
export function peek(a: HTMLAnchorElement): boolean {
  const path = storyPath(a);
  if (!dialog || !path) return false;
  // While loading, show the card's headline when the link belongs to that card ("ادامه", the cover), else the link text.
  const heading = a.closest('[data-id]')?.querySelector<HTMLAnchorElement>('h2 a, h3 a');
  const title = (heading && heading.pathname === path ? heading.textContent : a.textContent)?.trim() || '';
  fill({ title, href: path }, 'loading');
  $('.peek-scroll', dialog)!.scrollTop = 0;
  if (!dialog.open) dialog.showModal();
  load(path).then(
    (c) => dialog.open && $<HTMLAnchorElement>('[data-peek-open]', dialog)!.pathname === path && fill(c, 'ready'),
    () => dialog.open && fill({ title, href: path }, 'failed'),
  );
  return true;
}

// ---------- long press (touch and pen; a mouse keeps its normal click and right-click) ----------
let timer = 0;
let origin: { x: number; y: number; a: HTMLAnchorElement } | null = null;
let fired = false;

function cancel() {
  clearTimeout(timer);
  origin?.a.classList.remove('is-pressing');
  origin = null;
}

export function initPeek() {
  if (!dialog) return;
  document.addEventListener(
    'pointerdown',
    (e) => {
      fired = false;
      if (e.pointerType === 'mouse' || !e.isPrimary) return;
      const a = (e.target as Element).closest<HTMLAnchorElement>('a[href]');
      if (!a || a.closest('dialog') || !storyPath(a)) return;
      origin = { x: e.clientX, y: e.clientY, a };
      a.classList.add('is-pressing');
      timer = window.setTimeout(() => {
        const link = origin?.a;
        cancel();
        if (!link) return;
        fired = true;
        navigator.vibrate?.(12);
        window.getSelection()?.removeAllRanges();
        peek(link);
      }, HOLD_MS);
    },
    { passive: true },
  );
  document.addEventListener(
    'pointermove',
    (e) => origin && Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > SLOP && cancel(),
    { passive: true },
  );
  for (const type of ['pointerup', 'pointercancel', 'dragstart']) document.addEventListener(type, cancel, { passive: true });
  addEventListener('scroll', cancel, { passive: true, capture: true });
  // The browser's own long-press menu and the click that follows a press must not also fire.
  document.addEventListener('contextmenu', (e) => (origin || fired) && e.preventDefault());
  document.addEventListener(
    'click',
    (e) => {
      if (!fired) return;
      fired = false;
      e.preventDefault();
      e.stopImmediatePropagation();
    },
    true,
  );
  dialog.addEventListener('close', () => {
    const cover = $<HTMLImageElement>('[data-peek-cover]', dialog)!;
    cover.removeAttribute('src');
  });
}
