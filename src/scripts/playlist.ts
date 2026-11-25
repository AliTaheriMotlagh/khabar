// Today's stories read aloud one after another, from the home page (src/components/TodayPlaylist.astro): a story's
// headline, then its text, then the next story — played by the site's player (src/scripts/listen.ts: its bar, the lock
// screen's controls, and it goes on while the reader browses other pages). The place is kept for the day: «ادامه» goes
// on from the story it stopped at. A story heard counts as seen (the stories). The first headline is known on the page,
// so the tap that starts it plays at once (iOS only lets audio start in a tap).
import { $, BASE, fmtNum, store, toast, track } from './core';
import type { Line } from '../lib/lines';
import { tehranDay } from '../lib/time';
import { player, type QItem } from './listen';
import { canListen, listenOr } from './voice-offer';

type Item = QItem & { at: number; m: number; i?: number };
const box = $('[data-playlist]');
let queue: Item[] = [];

/** Today's stories (Tehran), or the last 24 hours after a quiet day, in the reader's story order. */
function todays(all: Item[]): Item[] {
  const today = tehranDay(Date.now());
  let list = all.filter((i) => tehranDay(i.at) === today);
  if (list.length < 3) list = all.filter((i) => Date.now() - i.at < 864e5);
  const order = store.get<{ order?: string }>('settings', {}).order;
  if (order === 'important') return list.sort((a, b) => (b.i ?? 0) - (a.i ?? 0) || b.at - a.at);
  return list.sort((a, b) => (order === 'old' ? a.at - b.at : b.at - a.at));
}

// The host's lines for the day (pipeline/daily.py → /daily/<day>.json): a greeting, a line into each story, a sign-off.
// Fetched when the page loads, so the tap that starts the podcast never waits; without them it plays as before.
type Host = { day: string; intro: string; links: Record<string, string>; outro: string };
let host: Host | null = null;
function loadHost(items: Item[]) {
  const days = [...new Set(items.map((i) => tehranDay(i.at)))].slice(0, 2);
  (async () => {
    for (const d of days) {
      const h = await fetch(`${BASE}/daily/${d}.json`).then((r) => (r.ok ? (r.json() as Promise<Host>) : null), () => null);
      if (h?.intro) return void (host = h);
    }
  })();
}
const hostLine = (text: string, k: string): Line => ({ text, post: 0, i: 0, src: `day=${host!.day}&k=${k}` });
/** The queue with the host's lines: the greeting before the first story heard, each story's lead-in before its
 *  headline (any order works: no line refers to another story), the sign-off after the last. */
function hosted(list: Item[], from: number): Item[] {
  if (!host) return list;
  return list.map((it, k) => {
    const pre = [...(k === from ? [hostLine(host!.intro, 'intro')] : []), ...(host!.links[it.id] ? [hostLine(host!.links[it.id], String(it.id))] : [])];
    const post = k === list.length - 1 && host!.outro ? [hostLine(host!.outro, 'outro')] : [];
    return { ...it, ...(pre.length && { pre }), ...(post.length && { post }) };
  });
}

/** From the tap: pause or go on, else start where it stopped today (or the first story). */
function toggle() {
  const p = player();
  if (p.key === 'playlist') return p.toggle();
  const saved = store.get<{ day: string; id: number } | null>('playlist-at', null);
  const from = saved?.day === tehranDay(Date.now()) ? Math.max(0, queue.findIndex((i) => i.id === saved.id)) : 0;
  if (from) toast(`ادامه از خبر ${fmtNum(from + 1)}؛ با نوار پایین به هر خبر می‌روید`);
  track('playlist');
  p.playQueue({ key: 'playlist', title: 'پادکست خبرهای امروز', href: location.pathname, unit: 'خبر' }, hosted(queue, from), from);
}

export function initPlaylist() {
  if (!box) return;
  queue = todays(JSON.parse(box.dataset.playlist ?? '[]') as Item[]);
  if (!queue.length) return void (box.hidden = true);
  loadHost(queue);
  const p = player();
  const minutes = Math.max(1, Math.round(queue.reduce((s, i) => s + (i.m || 1), 0) * 1.2));
  const meta = `${fmtNum(queue.length)} خبر · حدود ${fmtNum(minutes)} دقیقه · خبرها پشت سر هم خوانده می‌شوند`;
  $('[data-playlist-meta]', box)!.textContent = meta;
  $('[data-playlist-play]', box)!.title = meta;
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
