// Topics the reader follows, kept on this device: a follow button on each topic's page and on /tags/, a «موضوع‌های من»
// filter on the home timeline, and the topics a notification subscription asks for (src/scripts/notify.ts listens to
// the `follows-change` event).
import { $, $$, fmtNum, store, toast } from './core';

const KEY = 'follows';
export const getFollows = () => store.get<string[]>(KEY, []);
const isFollowed = (tag: string) => getFollows().includes(tag);

export function toggleFollow(tag: string) {
  const list = getFollows();
  const on = !list.includes(tag);
  store.set(KEY, on ? [...list, tag].slice(-40) : list.filter((t) => t !== tag));
  toast(on ? `«${tag}» را دنبال می‌کنید؛ در خانه با «موضوع‌های من» فقط همین‌ها را ببینید` : `«${tag}» دیگر دنبال نمی‌شود`);
  document.dispatchEvent(new CustomEvent('follows-change'));
}

/** Follow buttons show their state; the settings line counts the topics. */
function paintButtons() {
  for (const b of $$<HTMLButtonElement>('[data-follow]')) {
    const on = isFollowed(b.dataset.follow!);
    b.setAttribute('aria-pressed', String(on));
    const label = $('[data-follow-label]', b);
    if (label) label.textContent = on ? 'دنبال می‌کنید' : 'دنبال کردن';
    b.title = on ? 'برای دنبال نکردن بزنید' : 'این موضوع را دنبال کنید';
  }
  const n = getFollows().length;
  $$('[data-follow-count]').forEach((el) => (el.textContent = n ? `${fmtNum(n)} موضوع` : 'هنوز هیچ'));
}

// ---------- the home timeline: all news, or only the followed topics ----------
const FILTER = 'tl-filter';
/** Marks the stories of followed topics, applies the filter, and hides days left with nothing to show. Run again after
 *  "load more" adds stories. */
export function applyFollowFilter() {
  const box = $('[data-tl-filter]');
  const tl = $('[data-tl]');
  if (!tl) return;
  const follows = new Set(getFollows());
  for (const item of $$('.tl-item[data-tags]', tl)) {
    const mine = (item.dataset.tags ?? '').split(',').some((t) => follows.has(t));
    item.classList.toggle('is-mine', mine);
  }
  if (!box) return;
  box.hidden = !follows.size;
  const only = follows.size > 0 && store.get<string>(FILTER, 'all') === 'mine';
  $<HTMLInputElement>(`input[value="${only ? 'mine' : 'all'}"]`, box)!.checked = true;
  tl.classList.toggle('only-mine', only);
  // A day's pill stays only if one of its stories still shows.
  let day: HTMLElement | null = null;
  let shown = 0;
  const close = () => day?.classList.toggle('is-empty', only && !shown);
  for (const el of $$('[data-tl] > li', document)) {
    if (el.matches('[data-day]')) {
      close();
      day = el;
      shown = 0;
    } else if (!only || el.classList.contains('is-mine')) shown++;
  }
  close();
  const empty = $('[data-tl-mine-empty]');
  if (empty) empty.hidden = !only || $$('.tl-item.is-mine', tl).length > 0;
}

export function initFollow() {
  paintButtons();
  applyFollowFilter();
  document.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('[data-follow]');
    if (!b) return;
    e.preventDefault();
    toggleFollow(b.dataset.follow!);
  });
  $('[data-tl-filter]')?.addEventListener('change', (e) => {
    store.set(FILTER, (e.target as HTMLInputElement).value);
    applyFollowFilter();
  });
  document.addEventListener('follows-change', () => (paintButtons(), applyFollowFilter()));
  // Another tab followed or dropped a topic.
  addEventListener('storage', (e) => e.key?.endsWith(`:${KEY}`) && (paintButtons(), applyFollowFilter()));
}
