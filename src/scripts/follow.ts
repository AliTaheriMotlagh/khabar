// Topics the reader follows, kept on this device: a follow button on each topic's page and on /tags/, a «موضوع‌های من»
// filter on the home timeline, and the topics a notification subscription asks for (src/scripts/notify.ts listens to
// the `follows-change` event).
import { $, $$, fmtNum, store, toast } from './core';

const KEY = 'follows';
export const getFollows = () => store.get<string[]>(KEY, []);
const isFollowed = (tag: string) => getFollows().includes(tag);

export function toggleFollow(tag: string, name = tag) {
  const list = getFollows();
  const on = !list.includes(tag);
  store.set(KEY, on ? [...list, tag].slice(-40) : list.filter((t) => t !== tag));
  toast(on ? `«${name}» را دنبال می‌کنید؛ در خانه با «موضوع‌های من» فقط همین‌ها را ببینید` : `«${name}» دیگر دنبال نمی‌شود`);
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

// ---------- the home timeline's filter bar (src/components/Timeline.astro) ----------
// Three filters that combine: «موضوع‌های من» (the followed topics and people), a story *type* (the AI's, pipeline/ai.py:
// a tool, a paper, an opinion…) and a *topic* of this page (the keyword tags). «همه» clears them all.
const FILTER = 'tl-filter';
const TYPE = 'tl-type';
const TOPIC = 'tl-topic';
/** Marks the stories of followed topics, applies the filters, and hides days left with nothing to show. Run again
 *  after "load more" adds stories. */
export function applyFollowFilter() {
  const box = $('[data-tl-filter]');
  const tl = $('[data-tl]');
  if (!tl) return;
  const follows = new Set(getFollows());
  for (const item of $$('.tl-item[data-tags]', tl)) {
    const mine = (item.dataset.tags ?? '').split(',').some((t) => follows.has(t));
    item.classList.toggle('is-mine', mine);
  }
  const only = !!box && follows.size > 0 && store.get<string>(FILTER, 'all') === 'mine';
  if (box) {
    box.hidden = !follows.size;
    $<HTMLInputElement>('input', box)!.checked = only;
  }
  // A chip for each type this page has, shown once there are two.
  const types = $('[data-tl-types]');
  const items = $$('.tl-item', tl);
  let type = '';
  if (types) {
    const present = new Set(items.map((i) => i.dataset.type).filter(Boolean));
    $$('[data-type-chip]', types).forEach((c) => (c.hidden = !present.has(c.dataset.typeChip)));
    types.hidden = present.size < 2;
    type = present.has(store.get<string>(TYPE, '')) ? store.get<string>(TYPE, '') : '';
  }
  const topics = $('[data-tl-topics]');
  const known = new Set($$('[data-topic-chip]').map((c) => c.dataset.topicChip));
  const topic = topics && known.has(store.get<string>(TOPIC, '')) ? store.get<string>(TOPIC, '') : '';
  $$<HTMLInputElement>('input[name="tl-type"]').forEach((i) => (i.checked = i.value === type && !(i.hasAttribute('data-tl-all') && (topic || only))));
  $$<HTMLInputElement>('input[name="tl-topic"]').forEach((i) => (i.checked = i.value === topic));
  const tagsOf = (el: HTMLElement) => (el.dataset.tags ?? '').split(',');
  const shows = (el: HTMLElement) =>
    (!only || el.classList.contains('is-mine')) && (!type || el.dataset.type === type) && (!topic || tagsOf(el).includes(topic));
  for (const item of items) item.classList.toggle('is-off', !shows(item));
  const filtered = only || !!type || !!topic;
  tl.classList.toggle('filtered', filtered);
  // What's on, in words, with one tap to clear it.
  const active = $('[data-tl-active]');
  if (active) {
    const n = items.filter(shows).length;
    const what = [only && 'موضوع‌های من', type && `نوع: ${type}`, topic && `موضوع: ${topic}`].filter(Boolean).join(' · ');
    $('[data-tl-active-text]', active)!.textContent = `${what} — ${fmtNum(n)} خبر`;
    active.hidden = !filtered;
  }
  // A day's pill stays only if one of its stories still shows.
  let day: HTMLElement | null = null;
  let shown = 0;
  const close = () => day?.classList.toggle('is-empty', filtered && !shown);
  for (const el of $$('[data-tl] > li', document)) {
    if (el.matches('[data-day]')) {
      close();
      day = el;
      shown = 0;
    } else if (el.matches('.tl-item') && shows(el)) shown++;
  }
  close();
  const empty = $('[data-tl-mine-empty]');
  if (empty) empty.hidden = !filtered || items.some(shows);
}

export function initFollow() {
  paintButtons();
  applyFollowFilter();
  document.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('[data-follow]');
    if (!b) return;
    e.preventDefault();
    toggleFollow(b.dataset.follow!, b.dataset.followName);
  });
  $('[data-tl-bar]')?.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.name === 'tl-filter') store.set(FILTER, t.checked ? 'mine' : 'all');
    else if (t.hasAttribute('data-tl-all')) [FILTER, TYPE, TOPIC].forEach((k) => store.set(k, k === FILTER ? 'all' : ''));
    else if (t.name === 'tl-type') store.set(TYPE, t.value);
    else if (t.name === 'tl-topic') store.set(TOPIC, t.value);
    applyFollowFilter();
  });
  // A tap on the chosen type or topic again clears it (radios can't be unticked by hand).
  $('[data-tl-bar]')?.addEventListener('click', (e) => {
    const input = (e.target as Element).closest('label')?.querySelector<HTMLInputElement>('input[type="radio"]');
    if (!input || input.hasAttribute('data-tl-all') || !input.checked) return;
    const key = input.name === 'tl-topic' ? TOPIC : TYPE;
    if (store.get<string>(key, '') !== input.value) return;
    e.preventDefault();
    store.set(key, '');
    applyFollowFilter();
  });
  // «صافی» opens over the timeline: a pick, a tap elsewhere or Escape closes it.
  const more = $<HTMLDetailsElement>('[data-tl-bar] details');
  if (more) {
    const close = () => (more.open = false);
    $('[data-tl-bar]')!.addEventListener('change', (e) => (e.target as Element).closest('details') && close());
    document.addEventListener('click', (e) => more.open && !more.contains(e.target as Node) && close());
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !more.open) return;
      close();
      $('summary', more)?.focus();
    });
  }
  $('[data-tl-clear]')?.addEventListener('click', () => {
    [FILTER, TYPE, TOPIC].forEach((k) => store.set(k, k === FILTER ? 'all' : ''));
    applyFollowFilter();
  });
  document.addEventListener('follows-change', () => (paintButtons(), applyFollowFilter()));
  // Another tab followed or dropped a topic.
  addEventListener('storage', (e) => e.key?.endsWith(`:${KEY}`) && (paintButtons(), applyFollowFilter()));
}
