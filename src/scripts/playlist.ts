// Today's stories read aloud one after another, from the home page (src/components/TodayPlaylist.astro): a story's
// headline, then its text, then the next story — played by the site's player (src/scripts/listen.ts: its bar, the lock
// screen's controls, and it goes on while the reader browses other pages). The place is kept for the day: «ادامه» goes
// on from the story it stopped at. A story heard counts as seen (the stories). The first headline is known on the page,
// so the tap that starts it plays at once (iOS only lets audio start in a tap).
import { $, fmtNum, store, toast } from './core';
import { tehranDay } from '../lib/time';
import { player, type QItem } from './listen';
import { canListen, listenOr } from './voice-offer';

type Item = QItem & { at: number; m: number };
const box = $('[data-playlist]');
let queue: Item[] = [];

/** Today's stories (Tehran), or the last 24 hours after a quiet day, in the reader's story order. */
function todays(all: Item[]): Item[] {
  const today = tehranDay(Date.now());
  let list = all.filter((i) => tehranDay(i.at) === today);
  if (list.length < 3) list = all.filter((i) => Date.now() - i.at < 864e5);
  const order = store.get<{ order?: string }>('settings', {}).order === 'old' ? 'old' : 'new';
  return list.sort((a, b) => (order === 'old' ? a.at - b.at : b.at - a.at));
}

/** From the tap: pause or go on, else start where it stopped today (or the first story). */
function toggle() {
  const p = player();
  if (p.key === 'playlist') return p.toggle();
  const saved = store.get<{ day: string; id: number } | null>('playlist-at', null);
  const from = saved?.day === tehranDay(Date.now()) ? Math.max(0, queue.findIndex((i) => i.id === saved.id)) : 0;
  if (from) toast(`ادامه از خبر ${fmtNum(from + 1)}؛ با نوار پایین به هر خبر می‌روید`);
  p.playQueue({ key: 'playlist', title: 'پادکست خبرهای امروز', href: location.pathname, unit: 'خبر' }, queue, from);
}

export function initPlaylist() {
  if (!box) return;
  queue = todays(JSON.parse(box.dataset.playlist ?? '[]') as Item[]);
  if (!queue.length) return;
  const p = player();
  const minutes = Math.max(1, Math.round(queue.reduce((s, i) => s + (i.m || 1), 0) * 1.2));
  $('[data-playlist-meta]', box)!.textContent = `${fmtNum(queue.length)} خبر · حدود ${fmtNum(minutes)} دقیقه · خبرها پشت سر هم خوانده می‌شوند`;
  canListen().then((ok) => (box.hidden = !ok));
  const label = $('[data-playlist-label]', box)!;
  const off = p.subscribe((s) => {
    const state = s.key === 'playlist' ? s.state : 'idle';
    box.dataset.state = state;
    label.textContent = state === 'playing' || state === 'loading' ? 'مکث' : state === 'paused' ? 'ادامه' : 'پخش';
  });
  addEventListener('pagehide', off);
  const btn = $('[data-playlist-play]', box)!;
  btn.addEventListener('pointerdown', () => p.ready(), { once: true });
  btn.addEventListener('click', () => (p.key === 'playlist' ? toggle() : listenOr(toggle)));
}
