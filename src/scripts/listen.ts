// The site's one player: a story read aloud (src/scripts/reader.ts), the morning brief, today's podcast
// (src/scripts/playlist.ts) and the week's most read (src/scripts/week.ts) all play here, with one bar
// (src/components/ListenBar.astro), the lock screen's controls and one speed.
//
// It keeps playing while the reader moves around the site. A page is its own document, and leaving it ends its sound,
// so while something plays (or is paused) a tap on a link of the site opens that page in the shell: a frame over the
// whole window, with the bar of the window that plays on top of it. The address bar, the title and «back» follow the
// frame; back past its first page closes it. A page in the frame plays through this window's player (player() below),
// so «گوش دادن» there swaps what plays and the sound still goes on from page to page. Links to other sites open in a
// new tab meanwhile. Same origin only (the site's X-Frame-Options is SAMEORIGIN).
//
// iOS lets audio start only inside a tap: a page in the frame calls this window's player straight from its tap, nothing
// awaits on that path, and the audio element here has played before (that is what opened the frame).
import { SITE } from '../site';
import { $, $$, BASE, fmtNum, store, toast } from './core';
import { markSeen } from './game';
import { cardLines, type Card, type Line } from '../lib/lines';
import { tehranDay } from '../lib/time';
import { Speaker, getReady, type SpeechState } from './speech';
import { voiceStates } from './voice';

/** What plays: `key` names it for the pages ('story:<id>', 'brief', 'playlist', 'week'). */
export type Track = { key: string; title: string; href: string; cover?: string; artist?: string; unit?: string };
/** A story of a queue: its headline is read, then its text (from its card.json). */
export type QItem = { id: number; t: string; h: string; c?: string };
export type Snap = {
  key: string | null;
  state: SpeechState;
  /** The paragraph (a story, the brief) or the story (a queue) playing, and how many there are. */
  step: number;
  total: number;
  title: string;
  href: string;
  rate: number;
};

const RATES = [1, 1.25, 1.5, 1.75, 2, 0.85];
const root = document.documentElement;
type Spots = Record<string, number>;

class Player {
  private speaker: Speaker;
  private track: Track | null = null;
  private lines: Line[] = [];
  private queue: QItem[] | null = null;
  private at = 0;
  private phase: 'title' | 'body' = 'title';
  /** A queue between a story's headline and its text, or between stories: still playing. */
  private between = false;
  /** Paused in that moment: the text waits here until resumed. */
  private held: Line[] | null = null;
  private bodies = new Map<number, Promise<Line[]>>();
  private subs = new Set<(s: Snap) => void>();
  private emitting = false;
  /** Bumps whenever what plays changes: a story's text that arrives late is dropped. */
  private seq = 0;

  constructor() {
    this.speaker = new Speaker({
      line: () => this.lineChanged(),
      state: () => this.soon(),
      end: () => void this.ended(),
      fail: (msg) => toast(msg),
    });
    this.speaker.rate = store.get<number>('rate', 1);
  }

  get key() {
    return this.state === 'idle' ? null : (this.track?.key ?? null);
  }
  get state(): SpeechState {
    if (this.held) return 'paused';
    return this.between ? 'loading' : this.speaker.state;
  }

  snap(): Snap {
    const q = this.queue;
    const item = q?.[this.at];
    return {
      key: this.key,
      state: this.state,
      step: q ? this.at : this.speaker.at,
      total: q ? q.length : this.lines.length,
      title: item?.t ?? this.track?.title ?? '',
      href: item?.h ?? this.track?.href ?? '',
      rate: this.speaker.rate,
    };
  }

  /** Listens for changes (and hears the present one at once); returns the way to stop listening. */
  subscribe(fn: (s: Snap) => void) {
    this.subs.add(fn);
    try {
      fn(this.snap());
    } catch {}
    return () => void this.subs.delete(fn);
  }

  /** A story or the brief: these lines, from `from`. Straight from a tap. */
  playLines(track: Track, lines: Line[], from = 0) {
    this.reset();
    this.track = track;
    this.lines = lines;
    this.metadata(track.title, track.artist ?? SITE.name, track.cover);
    this.speaker.start(lines, Math.max(0, Math.min(from, lines.length - 1)));
    this.emit();
  }

  /** Stories one after another, each its headline then its text, from story `from`. Straight from a tap. */
  playQueue(track: Track, items: QItem[], from = 0) {
    if (!items.length) return;
    this.reset();
    this.track = track;
    this.queue = items;
    this.playItem(from);
  }

  toggle() {
    const s = this.state;
    if (s === 'playing' || s === 'loading') return this.pause();
    if (s === 'paused') return this.resume();
  }

  pause() {
    if (this.between) {
      this.between = false;
      this.held = [];
      return this.emit();
    }
    this.speaker.pause();
  }

  resume() {
    if (this.held) {
      const lines = this.held;
      this.held = null;
      if (lines.length) {
        this.phase = 'body';
        this.speaker.start(lines);
      } else void this.ended();
      return this.emit();
    }
    this.speaker.resume();
  }

  stop() {
    this.reset();
    this.speaker.stop();
    this.emit();
  }

  /** The paragraph or story before (-1) or after (1). */
  skip(d: number) {
    if (this.queue) return this.playItem(this.at + d);
    this.speaker.skip(d);
  }
  seek(sec: number) {
    if (!this.held && !this.between) this.speaker.seek(sec);
  }
  /** Paragraph or story k. */
  jump(k: number) {
    if (this.queue) return this.playItem(k);
    this.held = null;
    this.speaker.play(Math.max(0, Math.min(k, this.lines.length - 1)));
  }
  cycleRate() {
    const r = RATES[(RATES.indexOf(this.speaker.rate) + 1) % RATES.length] ?? 1;
    this.speaker.setRate(r);
    store.set('rate', r);
    this.emit();
  }
  /** The reader is about to listen: the downloaded voice's model starts loading in this window. */
  ready() {
    getReady();
  }

  // ---------- inside ----------
  private reset() {
    this.seq++;
    this.between = false;
    this.held = null;
    this.queue = null;
    this.lines = [];
    this.at = 0;
  }

  private playItem(k: number) {
    const q = this.queue;
    if (!q?.length) return;
    this.seq++;
    this.held = null;
    this.between = false;
    this.at = Math.max(0, Math.min(k, q.length - 1));
    this.phase = 'title';
    const item = q[this.at];
    this.speaker.start([{ text: item.t, post: item.id, i: 0 }]);
    this.body(item); // the text, while the headline plays
    if (q[this.at + 1]) this.body(q[this.at + 1]);
    markSeen(item.id);
    if (this.track?.key === 'playlist') store.set('playlist-at', { day: tehranDay(Date.now()), id: item.id });
    this.metadata(item.t, this.track?.artist ?? SITE.name, item.c);
    this.emit();
  }

  /** A story's text (not its headline), fetched once; empty when it has none beyond the headline. */
  private body(item: QItem) {
    if (!this.bodies.has(item.id)) {
      this.bodies.set(
        item.id,
        fetch(`${BASE}/p/${item.id}/card.json`)
          .then((r) => (r.ok ? (r.json() as Promise<Card>) : Promise.reject(new Error(String(r.status)))))
          .then((card) => cardLines(card).filter((l) => l.i > 0))
          .catch(() => []),
      );
    }
    return this.bodies.get(item.id)!;
  }

  private async ended() {
    const q = this.queue;
    if (!q) {
      // A story heard to the end: next time it starts from the top.
      if (this.track?.key.startsWith('story:')) this.keepSpot(null);
      return this.emit();
    }
    const item = q[this.at];
    if (this.phase === 'title' && item) {
      const mine = ++this.seq;
      this.between = true;
      this.emit();
      const lines = await this.body(item);
      if (mine !== this.seq) return; // moved on, or stopped, meanwhile
      if (this.held) {
        this.held = lines; // paused meanwhile: resume() reads it
        return this.emit();
      }
      this.between = false;
      if (lines.length) {
        this.phase = 'body';
        return this.speaker.start(lines);
      }
    }
    if (this.at + 1 < q.length) return this.playItem(this.at + 1);
    // The end of the queue.
    if (this.track?.key === 'playlist') store.set('playlist-at', null);
    this.between = false;
    this.queue = null;
    this.emit();
    toast(this.track?.key === 'week' ? 'پربازدیدهای هفته تمام شد 🎧' : 'خبرهای امروز تمام شد 🎧', 'reward');
  }

  private lineChanged() {
    if (!this.queue && this.track?.key.startsWith('story:')) this.keepSpot(this.speaker.at);
    this.emit();
  }

  /** Where the reader is in a story, so «ادامه‌ی گوش دادن» goes on from there (src/scripts/reader.ts reads it). */
  private keepSpot(n: number | null) {
    const id = this.track!.key.slice(6);
    const all = store.get<Spots>('listen-at', {});
    delete all[id];
    if (n) all[id] = n;
    store.set('listen-at', Object.fromEntries(Object.entries(all).slice(-40)));
  }

  private metadata(title: string, artist: string, cover?: string) {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title, artist, artwork: cover ? [{ src: new URL(cover, location.href).href }] : [] });
    } catch {}
  }

  /** The speaker's state settles within the same task (a headline ends, the next part starts): tell once, after it. */
  private soon() {
    if (this.emitting) return;
    this.emitting = true;
    queueMicrotask(() => {
      this.emitting = false;
      this.emit();
    });
  }

  emit() {
    const s = this.snap();
    paintBar(s, this.queue ? 'خبر' : (this.track?.unit ?? 'بند'));
    root.toggleAttribute('data-listening', s.state !== 'idle');
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = s.state === 'playing' ? 'playing' : s.state === 'paused' ? 'paused' : 'none';
    for (const fn of this.subs) {
      try {
        fn(s);
      } catch {
        this.subs.delete(fn); // a page that has gone
      }
    }
  }
}

// ---------- the bar ----------
const bar = $('[data-listen-bar]');
let drawn = '';
function paintBar(s: Snap, unit: string) {
  if (!bar || framed) return;
  bar.hidden = s.state === 'idle';
  bar.dataset.state = s.state;
  if (s.state === 'idle') return;
  const now = $<HTMLAnchorElement>('[data-lb-now]', bar)!;
  now.textContent = s.title;
  now.href = s.href || '#';
  $('[data-lb-pos]', bar)!.textContent = s.total > 1 ? `${unit} ${fmtNum(s.step + 1)} از ${fmtNum(s.total)}` : '';
  const track = $('[data-lb-track]', bar)!;
  const shape = `${s.key}:${s.total}`;
  if (shape !== drawn) {
    drawn = shape;
    track.innerHTML = s.total > 1 ? Array.from({ length: s.total }, (_, k) => `<button type="button" tabindex="-1" data-lb-to="${k}" aria-label="${unit} ${fmtNum(k + 1)}"></button>`).join('') : '';
  }
  $$('button', track).forEach((b, k) => {
    b.classList.toggle('done', k < s.step);
    b.classList.toggle('now', k === s.step);
  });
  const prev = $<HTMLButtonElement>('[data-lb="prev"]', bar)!;
  const next = $<HTMLButtonElement>('[data-lb="next"]', bar)!;
  prev.disabled = s.step <= 0;
  next.disabled = s.step >= s.total - 1;
  prev.setAttribute('aria-label', `${unit} قبلی`);
  next.setAttribute('aria-label', `${unit} بعدی`);
  $('[data-lb="toggle"]', bar)!.setAttribute('aria-label', s.state === 'paused' ? 'ادامه' : 'مکث');
  $('[data-lb="rate"]', bar)!.textContent = `${fmtNum(s.rate)}×`;
}

// ---------- which player: this window's, or the one of the window this page is framed in ----------
type Host = Window & { __khabarPlayer?: Player };
const framed = (() => {
  try {
    return window.top !== window && !!(window.top as Host).__khabarPlayer && !!window.frameElement?.hasAttribute('data-shell-frame');
  } catch {
    return false; // framed by another site: not ours
  }
})();
let local: Player | null = null;
/** The player to use from this page. */
export function player(): Player {
  if (framed) return (window.top as Host).__khabarPlayer!;
  return (local ??= new Player());
}
export const inShell = () => framed;

// ---------- the shell (the window that plays) ----------
let frame: HTMLIFrameElement | null = null;
let home = { url: '', title: '' };
const SKIP = /\.(xml|json|webmanifest|txt|png|jpe?g|webp|gif|svg|mp3|mp4|pdf)$/i;

/** A link of the site that opens a page: what the shell opens instead of leaving this one. */
function sitePage(a: HTMLAnchorElement): URL | null {
  if (!a.href || a.hasAttribute('download') || (a.target && a.target !== '_self')) return null;
  const u = new URL(a.href, location.href);
  if (u.origin !== location.origin || !u.pathname.startsWith(`${BASE}/`) || u.pathname.startsWith(`${BASE}/api/`) || SKIP.test(u.pathname)) return null;
  return u;
}
const external = (a: HTMLAnchorElement) => /^https?:/.test(a.href) && new URL(a.href).origin !== location.origin;
const sameDoc = (u: URL, base = location.href) => {
  const b = new URL(base);
  return u.pathname === b.pathname && u.search === b.search;
};

function openShell(url: string, push = true) {
  if (frame) {
    frame.contentWindow?.location.assign(url);
    return;
  }
  if (push) {
    home = { url: location.href, title: document.title };
    history.pushState({ shell: 1 }, '', url);
  }
  frame = document.createElement('iframe');
  frame.className = 'shell-frame';
  frame.dataset.shellFrame = '';
  frame.title = 'صفحه';
  frame.src = url;
  frame.addEventListener('load', () => {
    try {
      const w = frame!.contentWindow!;
      if (w.location.origin !== location.origin) return;
      history.replaceState({ shell: 1 }, '', w.location.href);
      document.title = w.document.title;
    } catch {}
  });
  document.body.append(frame);
  root.dataset.shell = '';
}

function closeShell() {
  frame?.remove();
  frame = null;
  delete root.dataset.shell;
  delete root.dataset.frameModal;
  if (home.title) document.title = home.title;
}

function initShell(p: Player) {
  // After the page's own handlers (on window, the last stop of a click): a link they took care of is theirs.
  addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element).closest?.<HTMLAnchorElement>('a[href]');
    if (!a || p.state === 'idle') return;
    if (external(a) && !a.target) {
      a.target = '_blank'; // another site: in a tab of its own, so the sound goes on here
      a.rel = `${a.rel} noopener`.trim();
      return;
    }
    const u = sitePage(a);
    if (!u) return;
    if (!frame && sameDoc(u)) {
      // A place on this page goes as usual; this very page isn't loaded again (that would end the sound): to what plays.
      if (u.hash) return;
      e.preventDefault();
      const at = $('.is-speaking');
      return at ? at.scrollIntoView({ block: 'center', behavior: 'smooth' }) : scrollTo({ top: 0, behavior: 'smooth' });
    }
    e.preventDefault();
    // The page that plays is this one: back to it.
    if (frame && sameDoc(u, home.url)) {
      closeShell();
      history.pushState(null, '', home.url);
      return;
    }
    openShell(u.href);
  });
  // A search (or any form of the site that gets a page) while playing: the same.
  addEventListener('submit', (e) => {
    const f = e.target as HTMLFormElement;
    if (e.defaultPrevented || p.state === 'idle' || (f.method || 'get').toLowerCase() !== 'get' || (f.target && f.target !== '_self')) return;
    const u = new URL(f.action || location.href, location.href);
    if (u.origin !== location.origin || u.pathname.startsWith(`${BASE}/api/`)) return;
    e.preventDefault();
    u.search = new URLSearchParams(new FormData(f) as unknown as Record<string, string>).toString();
    openShell(u.href);
  });
  addEventListener('popstate', (e) => {
    const shell = (e.state as { shell?: number } | null)?.shell;
    if (frame && !shell) closeShell();
    else if (!frame && shell) openShell(location.href, false);
  });
  // Another page (the frame) changed the display settings or the voice: follow.
  addEventListener('storage', (e) => {
    if (e.key === 'khabar:voice' || e.key === 'khabar:voice-custom') voiceStates().catch(() => {});
  });
  addEventListener('pagehide', () => p.stop());
}

// ---------- a page in the shell ----------
function initFramed(p: Player) {
  const top = window.top!.document.documentElement;
  // The bar of the window that plays shows what plays; this page's own bar stays hidden. Room is kept for it.
  const off = p.subscribe((s) => root.toggleAttribute('data-listening', s.state !== 'idle'));
  // Another site can't be shown in a frame: its links open in a tab of their own.
  document.addEventListener('click', (e) => {
    const a = (e.target as Element).closest?.<HTMLAnchorElement>('a[href]');
    if (a && external(a) && (!a.target || a.target === '_self' || a.target === '_top')) {
      a.target = '_blank';
      a.rel = `${a.rel} noopener`.trim();
    }
  });
  // The bar sits where this page's tab bar leaves room (it hides on scrolling down), and steps aside for a sheet.
  const sync = () => {
    top.dataset.chrome = root.dataset.chrome ?? 'show';
    top.toggleAttribute('data-frame-modal', !!document.querySelector('dialog[open], .player'));
  };
  new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ['open'], childList: true, subtree: true });
  new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ['data-chrome'] });
  sync();
  addEventListener('pagehide', () => {
    off();
    top.removeAttribute('data-frame-modal');
  });
}

// ---------- boot ----------
export function initListen() {
  if (framed) {
    root.dataset.framed = '';
    return initFramed(player());
  }
  const p = player();
  (window as Host).__khabarPlayer = p;
  initShell(p);
  bar?.addEventListener('click', (e) => {
    const t = e.target as Element;
    const to = t.closest<HTMLElement>('[data-lb-to]');
    if (to) return p.jump(Number(to.dataset.lbTo));
    const action = t.closest<HTMLElement>('[data-lb]')?.dataset.lb;
    if (action === 'toggle') p.toggle();
    else if (action === 'prev') p.skip(-1);
    else if (action === 'next') p.skip(1);
    else if (action === 'back') p.seek(-10);
    else if (action === 'fwd') p.seek(10);
    else if (action === 'rate') p.cycleRate();
    else if (action === 'stop') p.stop();
  });
  if ('mediaSession' in navigator) {
    const on = (a: MediaSessionAction, fn: () => void) => {
      try {
        navigator.mediaSession.setActionHandler(a, fn);
      } catch {} // an action this browser doesn't know
    };
    on('play', () => p.resume());
    on('pause', () => p.pause());
    on('stop', () => p.stop());
    on('nexttrack', () => p.skip(1));
    on('previoustrack', () => p.skip(-1));
    on('seekbackward', () => p.seek(-10));
    on('seekforward', () => p.seek(10));
  }
}
