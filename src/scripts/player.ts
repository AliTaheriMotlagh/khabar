// The story player (/today/): stories one after another, like a video. Each scene stays for its own data-seconds;
// with sound on, a video scene plays with its own sound for the video's length, and the others are narrated for as
// long as the voice takes. Tap the left side for the next story and the right side for the previous one (it's a
// right-to-left page), hold to pause, swipe down or Esc to leave.
// The page carries three days of stories and plays one set of them (?s=new | unseen | all, default today); the end
// screen switches sets in place, offering only the sets that have something to play. Opened without a set before
// anything was published today, it plays the last three days instead of an empty screen.
import { $, $$, fmtNum, store, toast } from './core';
import { markSeen, offersSet, pickStories, storySet, type StorySet } from './game';
import { Speaker, canSpeakPersian, type Line } from './speech';
import { openVoice } from './voice-offer';
import { voiceSupported } from './voice';

const TEXT: Record<StorySet, { name: string; done: string; empty: string }> = {
  new: { name: 'تازه‌ها از آخرین سر زدن', done: 'همه‌ی خبرهای تازه را دیدید', empty: 'از آخرین سر زدنتان خبر تازه‌ای نیامده' },
  unseen: { name: 'خبرهای نخوانده', done: 'همه‌ی خبرهای نخوانده را دیدید', empty: 'خبر نخوانده‌ای نمانده' },
  today: { name: 'امروز در یک نگاه', done: 'همه‌ی خبرهای امروز را دیدید', empty: 'امروز هنوز خبری نیامده' },
  all: { name: 'سه روز اخیر', done: 'همه‌ی خبرهای این سه روز را دیدید', empty: 'خبری نیست' },
};
/** With sound on, a video plays with its own sound for its own length, up to this many seconds. */
const VIDEO_MAX = 60;
/** The clock waits for a scene's picture or video at most this long, then moves on without it. */
const WAIT_MAX = 6000;
/** Up to this many scenes each get a segment of the progress bar; a longer set gets one bar (a phone fits ~40). */
const BARS_MAX = 40;

type MediaEl = HTMLImageElement | HTMLVideoElement;
const mediaOf = (s?: HTMLElement) => (s ? $<MediaEl>('.pl-bg img, .pl-bg video', s) : null);
const videoOf = (s?: HTMLElement) => (s ? $<HTMLVideoElement>('.pl-bg video', s) : null);
/** A video (not a GIF) has its own sound: with sound on it plays instead of the narration. */
const hasAudio = (s?: HTMLElement) => !!videoOf(s) && !s!.hasAttribute('data-gif');

const player = $('[data-player]');
if (player) init(player);

function init(player: HTMLElement) {
  const every = $$('.pl-scene', player);
  const items = every.map((el) => ({ id: Number(el.dataset.id), at: Date.parse(el.dataset.date ?? ''), el }));
  const barBox = $('[data-pl-bars]', player)!;
  const end = $('[data-pl-end]', player)!;
  const backdrop = $('[data-pl-backdrop]', player)!;
  const pos = $('[data-pl-pos]', player)!;
  const pauseBtn = $('[data-pl-pause]', player)!;
  const soundBtn = $('[data-pl-sound]', player)!;

  const asked = new URLSearchParams(location.search).get('s');
  let set: StorySet = storySet(asked);
  if (!asked && !pickStories('today', items).length) set = 'all';
  let scenes: HTMLElement[] = [];
  let bars: HTMLElement[] = [];
  let at = 0;
  let paused = false;
  let held = false;
  let sound = store.get<boolean>('pl-sound', false);
  let voice = false; // a Persian voice exists (the device's own, the cloud one, or one downloaded to the device)
  const offer = voiceSupported(); // without one, turning the sound on offers the download
  let lines: Line[] = [];
  let elapsed = 0;
  let waited = 0;
  let loading = false;
  let last = 0;
  let raf = 0;

  const speaker = new Speaker({
    end: () => voiced() && next(),
    fail(msg) {
      toast(msg);
      voice = false; // videos keep their sound; the rest of the scenes go back to the clock
      refreshSoundBtn();
    },
  });
  /** This scene ends when the narration does. */
  const voiced = () => sound && voice && lines.length > 0 && !hasAudio(scenes[at]);

  // ---------- the set being played ----------
  function use(next: StorySet) {
    set = next;
    scenes = pickStories(set, items).map((i) => i.el);
    // Past BARS_MAX the segments would be slivers: one bar for the whole set, the «۵ / ۶۰» beside it says where.
    const one = scenes.length > BARS_MAX;
    barBox.innerHTML = '<span><i></i></span>'.repeat(one ? 1 : scenes.length);
    barBox.classList.toggle('many', scenes.length > 24);
    bars = $$(':scope > span', barBox);
    $('[data-pl-name]', player)!.textContent = TEXT[set].name;
    $('[data-pl-count]', player)!.textContent = fmtNum(scenes.length);
    $('[data-pl-total]', player)!.textContent = fmtNum(scenes.length);
    $$<HTMLAnchorElement>('[data-pl-set]', player).forEach((a) => (a.hidden = a.dataset.plSet === set || !offersSet(storySet(a.dataset.plSet), items)));
    refreshSoundBtn();
  }
  function switchTo(next: StorySet) {
    use(next);
    history.replaceState(history.state, '', next === 'today' ? location.pathname : `${location.pathname}?s=${next}`);
    scenes.length ? show(0) : finish();
  }

  // ---------- media: the next scenes load ahead, videos far away let go of their download ----------
  function attach(m: MediaEl, preload?: 'auto' | 'metadata', urgent = false) {
    if (m instanceof HTMLVideoElement) {
      if (m.dataset.poster && !m.getAttribute('poster')) m.poster = m.dataset.poster;
      if (preload && m.preload !== 'auto') m.preload = preload;
    }
    if (!m.dataset.src) return;
    m.setAttribute('fetchpriority', urgent ? 'high' : 'low');
    m.src = m.dataset.src;
    m.removeAttribute('data-src');
  }
  function detach(v: HTMLVideoElement) {
    const src = v.getAttribute('src');
    if (!src) return;
    v.pause();
    v.dataset.src = src;
    v.removeAttribute('src');
    v.preload = 'none';
    v.load(); // stops the download
  }
  function prepare() {
    scenes.forEach((s, k) => {
      const d = k - at;
      const m = mediaOf(s);
      if (!m) return;
      if (m instanceof HTMLVideoElement) {
        if (d >= -1 && d <= 1) attach(m, d === 1 ? 'auto' : d ? 'metadata' : 'auto', d === 0);
        else detach(m);
      } else if (d >= -1 && d <= 2) attach(m, undefined, d === 0);
    });
  }
  const still = (s: HTMLElement) => {
    const m = mediaOf(s);
    return m instanceof HTMLVideoElement ? m.poster : (m?.getAttribute('src') ?? '');
  };
  /** The current picture or video isn't showing yet. */
  function stalled() {
    const m = mediaOf(scenes[at]);
    if (!m || !m.isConnected || m.hasAttribute('data-blocked')) return false;
    if (m instanceof HTMLVideoElement) return !m.error && m.readyState < 3;
    return !m.complete;
  }
  function playVideo(v: HTMLVideoElement) {
    const loud = sound && hasAudio(scenes[at]);
    v.muted = !loud;
    v.play().then(
      () => loud && soundBtn.classList.remove('is-armed'),
      (e: DOMException) => {
        if (v.muted || e.name !== 'NotAllowedError') return v.setAttribute('data-blocked', '');
        // The browser wants a tap before sound (iOS, when the show moved on by itself): play silent until then.
        v.muted = true;
        soundBtn.classList.add('is-armed');
        v.play().catch(() => v.setAttribute('data-blocked', ''));
      },
    );
  }
  // Any tap brings the sound back (taps count as permission to play it).
  player.addEventListener('pointerup', (e) => {
    if (!soundBtn.classList.contains('is-armed') || !sound || soundBtn.contains(e.target as Node)) return;
    const v = videoOf(scenes[at]);
    if (v && hasAudio(scenes[at])) v.muted = false;
    soundBtn.classList.remove('is-armed');
  });

  // ---------- the clock ----------
  function duration() {
    const s = scenes[at];
    const seconds = Number(s.dataset.seconds) || 8;
    if (voiced()) return Math.max(seconds, lines.reduce((n, l) => n + l.text.length, 0) / 14) * 1000;
    const v = videoOf(s);
    // A clip that's long enough sets the pace (its sound shouldn't start over); a short one loops for the reading time.
    if (sound && v && hasAudio(s) && Number.isFinite(v.duration) && v.duration >= 6) return Math.min(v.duration, VIDEO_MAX) * 1000;
    return seconds * 1000;
  }
  function tick(t: number) {
    const dt = Math.min(t - last, 100);
    last = t;
    if (!paused && !held && !document.hidden) {
      // Like a video buffering: the bar waits while the picture is still on its way.
      const wait = waited < WAIT_MAX && stalled();
      if (wait) waited += dt;
      else elapsed += dt;
      if (wait !== loading) player.classList.toggle('is-loading', (loading = wait));
    }
    const p = Math.min(1, elapsed / duration());
    // With narration the voice decides when the scene ends; the bar only estimates.
    setBar(at, voiced() ? Math.min(p, 0.97) : p);
    if (p >= 1 && !voiced()) return next();
    raf = requestAnimationFrame(tick);
  }
  /** Scene i is p of the way through: its own segment, or its share of the single bar. */
  function setBar(i: number, p: number) {
    if (bars.length > 1) bars[i]?.style.setProperty('--p', String(p));
    else bars[0]?.style.setProperty('--p', String(scenes.length ? (i + p) / scenes.length : 0));
  }
  function startClock() {
    cancelAnimationFrame(raf);
    elapsed = 0;
    waited = 0;
    last = performance.now();
    raf = requestAnimationFrame(tick);
  }

  // ---------- sound: the video's own, or narration ----------
  function linesOf(s: HTMLElement): Line[] {
    const texts = [$('h2', s)?.textContent ?? '', s.dataset.lede ?? ''];
    return (s.dataset.say ?? '0').split(',').map(Number).map((i) => ({ text: texts[i]?.trim() ?? '', post: Number(s.dataset.id), i })).filter((l) => l.text);
  }
  function speak() {
    if (voiced() && !paused) speaker.start(lines);
  }
  function refreshSoundBtn() {
    soundBtn.hidden = !voice && !offer && !scenes.some(hasAudio);
  }
  // Runs from a tap, so iOS lets the audio start.
  function setSound(on: boolean) {
    if (on && !voice && offer && !hasAudio(scenes[at])) {
      // No Persian voice yet: offer the download, and come back with the sound on from the sheet's own tap.
      if (!paused) setPaused(true);
      openVoice(() => {
        voice = true;
        setPaused(false);
        setSound(true);
      });
      return;
    }
    sound = on;
    store.set('pl-sound', on);
    soundBtn.classList.remove('is-armed');
    soundBtn.setAttribute('aria-pressed', String(on));
    soundBtn.setAttribute('aria-label', on ? 'بی‌صدا' : 'صدا');
    const s = scenes[at];
    const v = videoOf(s);
    if (v && hasAudio(s)) {
      v.muted = !on;
      if (on && !paused) v.play().catch(() => {});
    }
    speaker.stop();
    if (voiced()) {
      speak();
      elapsed = 0;
    }
  }

  // ---------- scenes ----------
  function show(i: number) {
    if (i >= scenes.length) return finish();
    at = Math.max(0, i);
    end.hidden = true;
    const s = scenes[at];
    every.forEach((x) => {
      const on = x === s;
      x.classList.toggle('on', on);
      if (on) x.removeAttribute('aria-hidden');
      else x.setAttribute('aria-hidden', 'true');
      if (!on) videoOf(x)?.pause();
    });
    if (bars.length > 1) bars.forEach((b, k) => b.style.setProperty('--p', k < at ? '1' : '0'));
    setBar(at, 0);
    prepare();
    const v = videoOf(s);
    if (v) {
      if (v.currentTime) v.currentTime = 0;
      if (!paused) playVideo(v);
    }
    backdrop.style.backgroundImage = still(s) ? `url("${still(s)}")` : '';
    pos.textContent = fmtNum(at + 1);
    markSeen(Number(s.dataset.id));
    history.replaceState(history.state, '', `#${s.dataset.id}`);
    lines = linesOf(s);
    speaker.stop();
    speak();
    // The on-device voice makes the next scene's first sentence while this one plays.
    if (sound && voice && scenes[at + 1] && !hasAudio(scenes[at + 1])) speaker.warm(linesOf(scenes[at + 1]));
    startClock();
  }
  const next = () => show(at + 1);
  const prev = () => show(at - 1);

  function finish() {
    cancelAnimationFrame(raf);
    speaker.stop();
    player.classList.remove('is-loading');
    loading = false;
    every.forEach((s) => s.classList.remove('on'));
    $$<HTMLVideoElement>('video', player).forEach((v) => v.pause());
    bars.forEach((b) => b.style.setProperty('--p', '1'));
    const t = TEXT[set];
    $('[data-pl-end-title]', player)!.textContent = scenes.length ? t.done : t.empty;
    $('[data-pl-end-text]', player)!.hidden = !scenes.length;
    $('[data-pl-restart]', player)!.hidden = !scenes.length;
    end.hidden = false;
    at = scenes.length;
    history.replaceState(history.state, '', location.pathname + location.search);
  }

  function setPaused(on: boolean) {
    paused = on;
    player.classList.toggle('is-paused', on);
    pauseBtn.setAttribute('aria-pressed', String(on));
    pauseBtn.setAttribute('aria-label', on ? 'پخش' : 'مکث');
    const v = videoOf(scenes[at]);
    if (on) {
      v?.pause();
      if (speaker.state !== 'idle') speaker.pause();
    } else {
      v?.play().catch(() => {});
      if (voiced()) speaker.state === 'paused' ? speaker.resume() : speak();
    }
  }

  function close() {
    const fromHere = document.referrer.startsWith(location.origin) && history.length > 1;
    if (fromHere) history.back();
    else location.href = $<HTMLAnchorElement>('[data-pl-close]', player)!.href;
  }

  // ---------- touch: tap sides, hold to pause, swipe ----------
  const taps = $('[data-pl-taps]', player)!;
  let down: { x: number; y: number } | null = null;
  let holdTimer = 0;
  taps.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY };
    holdTimer = window.setTimeout(() => {
      held = true;
      player.classList.add('is-held');
      videoOf(scenes[at])?.pause();
    }, 220);
  });
  const release = (e: PointerEvent) => {
    clearTimeout(holdTimer);
    if (!down) return;
    const dx = e.clientX - down.x;
    const dy = e.clientY - down.y;
    down = null;
    if (held) {
      held = false;
      player.classList.remove('is-held');
      if (!paused) videoOf(scenes[at])?.play().catch(() => {});
      return;
    }
    if (e.type === 'pointercancel') return;
    if (dy > 90 && Math.abs(dy) > Math.abs(dx)) return close();
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) return dx > 0 ? next() : prev();
    if (at >= scenes.length) return;
    const r = taps.getBoundingClientRect();
    (e.clientX - r.left) / r.width < 0.66 ? next() : prev();
  };
  taps.addEventListener('pointerup', release);
  taps.addEventListener('pointercancel', release);
  taps.addEventListener('contextmenu', (e) => e.preventDefault());

  $('[data-pl-next]', player)!.addEventListener('click', () => (at < scenes.length ? next() : undefined));
  $('[data-pl-prev]', player)!.addEventListener('click', () => (at >= scenes.length ? scenes.length && show(scenes.length - 1) : prev()));
  pauseBtn.addEventListener('click', () => setPaused(!paused));
  soundBtn.addEventListener('click', () => (sound && soundBtn.classList.contains('is-armed') ? setSound(true) : setSound(!sound)));
  $('[data-pl-restart]', player)!.addEventListener('click', () => show(0));
  $$<HTMLAnchorElement>('[data-pl-set]', player).forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault();
      switchTo(storySet(a.dataset.plSet));
    }),
  );
  $('[data-pl-close]', player)!.addEventListener('click', (e) => {
    e.preventDefault();
    close();
  });
  // Opening a story, saving or sharing pauses the show.
  player.addEventListener('click', (e) => (e.target as Element).closest('[data-pl-open], [data-save], [data-share]') && !paused && setPaused(true));

  document.addEventListener(
    'keydown',
    (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || $('dialog[open]')) return;
      const act: Record<string, () => void> = {
        ArrowLeft: () => at < scenes.length && next(),
        ArrowRight: prev,
        ' ': () => setPaused(!paused),
        k: () => setPaused(!paused),
        m: () => setSound(!sound),
        Escape: close,
      };
      const fn = act[e.key];
      if (!fn) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      fn();
    },
    true,
  );
  document.addEventListener('visibilitychange', () => document.hidden && !paused && at < scenes.length && setPaused(true));

  // ---------- start ----------
  use(set);
  soundBtn.setAttribute('aria-pressed', String(sound));
  canSpeakPersian().then((ok) => {
    voice = ok;
    refreshSoundBtn();
  });
  // Browsers only allow sound after a tap: a remembered "sound on" waits for the first one.
  if (sound) {
    sound = false;
    soundBtn.classList.add('is-armed');
    player.addEventListener(
      'pointerup',
      (e) => {
        soundBtn.classList.remove('is-armed');
        if (!sound && !soundBtn.hidden && !soundBtn.contains(e.target as Node)) setSound(true);
      },
      { once: true },
    );
  }
  const fromHash = scenes.findIndex((s) => s.dataset.id === location.hash.slice(1));
  scenes.length ? show(Math.max(0, fromHash)) : finish();
  if (!store.get('pl-hint', false)) {
    const hint = $('[data-pl-hint]', player)!;
    hint.hidden = false;
    setTimeout(() => (hint.hidden = true), 4000);
    store.set('pl-hint', true);
  }
}
