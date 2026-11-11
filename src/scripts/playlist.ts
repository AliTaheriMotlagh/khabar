// Today's stories read aloud one after another, from the home page (src/components/TodayPlaylist.astro): a story's
// headline, then its text (src/lib/lines.ts, from its card.json, fetched ahead), then the next story. The same player
// bar as a story (src/components/ListenBar.astro) with stories as its steps, the lock screen's controls, and the
// place kept for the day: «ادامه» goes on from the story it stopped at. A story heard counts as seen (the stories).
// The first headline is known on the page, so the tap that starts it plays at once (iOS only lets audio start in a tap).
import { SITE } from '../site';
import { $, $$, BASE, fmtNum, store, toast } from './core';
import { markSeen } from './game';
import { cardLines, type Card, type Line } from '../lib/lines';
import { tehranDay } from '../lib/time';
import { Speaker, getReady } from './speech';
import { canListen, listenOr } from './voice-offer';

type Item = { id: number; t: string; at: number; h: string; m: number; c: string };
const RATES = [1, 1.25, 1.5, 1.75, 2, 0.85];
const box = $('[data-playlist]');
const bar = $('[data-playlist-bar]');
let queue: Item[] = [];
let at = 0;
let phase: 'title' | 'body' = 'title';
const bodies = new Map<number, Promise<Line[]>>();

/** The story's text (not its headline), fetched once; empty when it has none beyond the headline. */
function body(item: Item) {
  if (!bodies.has(item.id)) {
    bodies.set(
      item.id,
      fetch(`${BASE}/p/${item.id}/card.json`)
        .then((r) => (r.ok ? (r.json() as Promise<Card>) : Promise.reject(new Error(String(r.status)))))
        .then((card) => cardLines(card).filter((l) => l.i > 0))
        .catch(() => []),
    );
  }
  return bodies.get(item.id)!;
}

/** Today's stories (Tehran), or the last 24 hours after a quiet day, in the reader's story order. */
function todays(all: Item[]): Item[] {
  const today = tehranDay(Date.now());
  let list = all.filter((i) => tehranDay(i.at) === today);
  if (list.length < 3) list = all.filter((i) => Date.now() - i.at < 864e5);
  const order = store.get<{ order?: string }>('settings', {}).order === 'old' ? 'old' : 'new';
  return list.sort((a, b) => (order === 'old' ? a.at - b.at : b.at - a.at));
}

const speaker = new Speaker({
  line() {},
  state(s) {
    if (!box || !bar) return;
    box.dataset.state = s;
    $('[data-playlist-label]', box)!.textContent = s === 'playing' || s === 'loading' ? 'مکث' : s === 'paused' ? 'ادامه' : 'پخش';
    $('[data-lb="toggle"]', bar)!.setAttribute('aria-label', s === 'paused' ? 'ادامه' : 'مکث');
    // Idle between a headline and its text, or between stories, for a moment: the bar only goes once it stays idle.
    const show = (on: boolean, state: string) => {
      bar.hidden = !on;
      bar.dataset.state = state;
      document.documentElement.toggleAttribute('data-listening', on);
    };
    if (s !== 'idle') show(true, s);
    else setTimeout(() => speaker.state === 'idle' && (continuing ? show(true, 'loading') : show(false, 'idle')));
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = s === 'playing' ? 'playing' : s === 'paused' ? 'paused' : 'none';
  },
  // A headline heard: its text; a text heard: the next story.
  end: () => void next(),
  fail: (msg) => toast(msg),
});
speaker.rate = store.get<number>('rate', 1);
let continuing = false; // between a story's parts, the bar stays up

async function next() {
  const item = queue[at];
  if (phase === 'title' && item) {
    continuing = true;
    const lines = await body(item);
    continuing = false;
    if (queue[at] !== item) return; // the reader moved on meanwhile
    if (lines.length) {
      phase = 'body';
      return speaker.start(lines);
    }
  }
  if (at + 1 < queue.length) return play(at + 1);
  // The end of today's news.
  store.set('playlist-at', null);
  showSpot();
  toast('خبرهای امروز تمام شد 🎧', 'reward');
}

/** Story k from its headline. In a tap the first time: nothing here waits before the audio starts. */
function play(k: number) {
  at = Math.max(0, Math.min(k, queue.length - 1));
  phase = 'title';
  const item = queue[at];
  speaker.start([{ text: item.t, post: item.id, i: 0 }]);
  body(item); // the text, while the headline plays
  if (queue[at + 1]) body(queue[at + 1]);
  markSeen(item.id);
  store.set('playlist-at', { day: tehranDay(Date.now()), id: item.id });
  showSpot();
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: item.t, artist: `${SITE.name} · پادکست امروز`, artwork: item.c ? [{ src: item.c }] : [] });
  }
}

function showSpot() {
  if (!bar) return;
  const item = queue[at];
  $('[data-lb-pos]', bar)!.textContent = queue.length > 1 ? `خبر ${fmtNum(at + 1)} از ${fmtNum(queue.length)}` : '';
  const now = $<HTMLAnchorElement>('[data-lb-now]', bar)!;
  now.textContent = item?.t ?? '';
  now.href = item?.h ?? '#';
  $$('[data-lb-track] button', bar).forEach((b, k) => {
    b.classList.toggle('done', k < at);
    b.classList.toggle('now', k === at);
  });
  $<HTMLButtonElement>('[data-lb="prev"]', bar)!.disabled = at === 0;
  $<HTMLButtonElement>('[data-lb="next"]', bar)!.disabled = at >= queue.length - 1;
}

function toggle() {
  if (speaker.state === 'playing' || speaker.state === 'loading') return speaker.pause();
  if (speaker.state === 'paused') return speaker.resume();
  // Where it stopped today, else the first story.
  const saved = store.get<{ day: string; id: number } | null>('playlist-at', null);
  const from = saved?.day === tehranDay(Date.now()) ? Math.max(0, queue.findIndex((i) => i.id === saved.id)) : 0;
  const track = $('[data-lb-track]', bar!)!;
  track.innerHTML = queue.length > 1 ? queue.map((i, k) => `<button type="button" tabindex="-1" data-lb-to="${k}" aria-label="خبر ${fmtNum(k + 1)}"></button>`).join('') : '';
  if (from) toast(`ادامه از خبر ${fmtNum(from + 1)}؛ با نوار پایین به هر خبر می‌روید`);
  play(from);
}

const showRate = () => bar && ($('[data-rate]', bar)!.textContent = `${fmtNum(speaker.rate)}×`);

export function initPlaylist() {
  if (!box || !bar) return;
  queue = todays(JSON.parse(box.dataset.playlist ?? '[]') as Item[]);
  if (!queue.length) return;
  const minutes = Math.max(1, Math.round(queue.reduce((s, i) => s + (i.m || 1), 0) * 1.2));
  $('[data-playlist-meta]', box)!.textContent = `${fmtNum(queue.length)} خبر · حدود ${fmtNum(minutes)} دقیقه · خبرها پشت سر هم خوانده می‌شوند`;
  canListen().then((ok) => (box.hidden = !ok));
  // The first story's text is fetched ahead once the card is in sight, so the bar moves on without a pause.
  new IntersectionObserver((entries, obs) => {
    if (entries.some((e) => e.isIntersecting)) {
      obs.disconnect();
      body(queue[0]);
    }
  }).observe(box);
  const btn = $('[data-playlist-play]', box)!;
  btn.addEventListener('pointerdown', getReady, { once: true });
  btn.addEventListener('click', () => (speaker.state === 'idle' ? listenOr(toggle) : toggle()));
  showRate();
  bar.addEventListener('click', (e) => {
    const t = e.target as Element;
    const to = t.closest<HTMLElement>('[data-lb-to]');
    if (to) return play(Number(to.dataset.lbTo));
    if (t.closest('[data-rate]')) {
      const r = RATES[(RATES.indexOf(speaker.rate) + 1) % RATES.length] ?? 1;
      speaker.setRate(r);
      store.set('rate', r);
      return showRate();
    }
    const action = t.closest<HTMLElement>('[data-lb]')?.dataset.lb;
    if (action === 'toggle') toggle();
    else if (action === 'prev') play(at - 1);
    else if (action === 'next') play(at + 1);
    else if (action === 'back') speaker.seek(-10);
    else if (action === 'fwd') speaker.seek(10);
    else if (action === 'stop') {
      continuing = false;
      speaker.stop();
    }
  });
  if ('mediaSession' in navigator) {
    const ms = navigator.mediaSession;
    const on = (a: MediaSessionAction, fn: () => void) => {
      try {
        ms.setActionHandler(a, fn);
      } catch {}
    };
    on('play', () => speaker.resume());
    on('pause', () => speaker.pause());
    on('stop', () => speaker.stop());
    on('nexttrack', () => play(at + 1));
    on('previoustrack', () => play(at - 1));
    on('seekbackward', () => speaker.seek(-10));
    on('seekforward', () => speaker.seek(10));
  }
  addEventListener('pagehide', () => speaker.stop());
}
