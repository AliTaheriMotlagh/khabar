// The daily player (/today/): the day's stories one after another, like a video. Each scene stays for its own
// data-seconds, or with narration on, for as long as the voice takes. Tap the left side for the next story and the
// right side for the previous one (it's a right-to-left page), hold to pause, swipe down or Esc to leave.
import { $, $$, fmtNum, store, toast } from './core';
import { Speaker, type Line } from './speech';

const player = $('[data-player]');
if (player) init(player);

function init(player: HTMLElement) {
  const scenes = $$('.pl-scene', player);
  const bars = $$('[data-pl-bars] > span', player);
  const end = $('[data-pl-end]', player)!;
  const backdrop = $('[data-pl-backdrop]', player)!;
  const pos = $('[data-pl-pos]', player)!;
  const pauseBtn = $('[data-pl-pause]', player)!;
  const soundBtn = $('[data-pl-sound]', player)!;
  if (!scenes.length) return;

  let at = 0;
  let paused = false;
  let held = false;
  let sound = store.get<boolean>('pl-sound', false);
  let elapsed = 0;
  let duration = 1;
  let last = 0;
  let raf = 0;

  const speaker = new Speaker({
    end: () => sound && next(),
    fail(msg) {
      toast(msg);
      setSound(false);
    },
  });

  // ---------- media: only the current scene and the next one load ----------
  function load(i: number) {
    const s = scenes[i];
    if (!s) return;
    $$<HTMLImageElement | HTMLVideoElement>('[data-src]', s).forEach((m) => {
      if (m instanceof HTMLVideoElement && m.dataset.poster) m.poster = m.dataset.poster;
      m.src = m.dataset.src!;
      m.removeAttribute('data-src');
    });
  }
  const still = (s: HTMLElement) => {
    const m = $<HTMLImageElement | HTMLVideoElement>('img, video', s);
    return m instanceof HTMLVideoElement ? m.poster : m?.src ?? '';
  };

  // ---------- the clock ----------
  function tick(t: number) {
    if (!paused && !held && !document.hidden) elapsed += Math.min(t - last, 100);
    last = t;
    const p = Math.min(1, elapsed / duration);
    // With narration the voice decides when the scene ends; the bar only estimates.
    bars[at]?.style.setProperty('--p', String(sound ? Math.min(p, 0.97) : p));
    if (p >= 1 && !sound) return next();
    raf = requestAnimationFrame(tick);
  }
  function startClock() {
    cancelAnimationFrame(raf);
    elapsed = 0;
    last = performance.now();
    const s = scenes[at];
    const seconds = Number(s.dataset.seconds) || 8;
    duration = (sound ? Math.max(seconds, linesOf(s).reduce((n, l) => n + l.text.length, 0) / 14) : seconds) * 1000;
    raf = requestAnimationFrame(tick);
  }

  // ---------- narration ----------
  function linesOf(s: HTMLElement): Line[] {
    const texts = [$('h2', s)?.textContent ?? '', s.dataset.lede ?? ''];
    return (s.dataset.say ?? '0').split(',').map(Number).map((i) => ({ text: texts[i]?.trim() ?? '', post: Number(s.dataset.id), i })).filter((l) => l.text);
  }
  function speak() {
    if (sound && !paused) speaker.start(linesOf(scenes[at]));
  }
  // Runs from a tap, so iOS lets the audio start.
  function setSound(on: boolean) {
    sound = on;
    store.set('pl-sound', on);
    soundBtn.setAttribute('aria-pressed', String(on));
    soundBtn.setAttribute('aria-label', on ? 'قطع روایت صوتی' : 'روایت صوتی');
    if (on) speak();
    else speaker.stop();
    startClock();
  }

  // ---------- scenes ----------
  function show(i: number) {
    if (i >= scenes.length) return finish();
    at = Math.max(0, i);
    end.hidden = true;
    scenes.forEach((s, k) => {
      const on = k === at;
      s.classList.toggle('on', on);
      s.toggleAttribute('aria-hidden', !on);
      const v = $<HTMLVideoElement>('video', s);
      if (v && !on) v.pause();
    });
    bars.forEach((b, k) => b.style.setProperty('--p', k < at ? '1' : '0'));
    load(at);
    load(at + 1);
    const v = $<HTMLVideoElement>('video', scenes[at]);
    if (v && !paused) v.play().catch(() => {});
    backdrop.style.backgroundImage = still(scenes[at]) ? `url("${still(scenes[at])}")` : '';
    pos.textContent = fmtNum(at + 1);
    history.replaceState(history.state, '', `#${scenes[at].dataset.id}`);
    speaker.stop();
    speak();
    startClock();
  }
  const next = () => show(at + 1);
  const prev = () => show(at - 1);

  function finish() {
    cancelAnimationFrame(raf);
    speaker.stop();
    scenes.forEach((s) => s.classList.remove('on'));
    $$<HTMLVideoElement>('video', player).forEach((v) => v.pause());
    bars.forEach((b) => b.style.setProperty('--p', '1'));
    end.hidden = false;
    at = scenes.length;
    history.replaceState(history.state, '', location.pathname);
  }

  function setPaused(on: boolean) {
    paused = on;
    player.classList.toggle('is-paused', on);
    pauseBtn.setAttribute('aria-pressed', String(on));
    pauseBtn.setAttribute('aria-label', on ? 'پخش' : 'مکث');
    const v = scenes[at] && $<HTMLVideoElement>('video', scenes[at]);
    if (on) {
      v?.pause();
      if (sound) speaker.pause();
    } else {
      v?.play().catch(() => {});
      if (sound) speaker.state === 'paused' ? speaker.resume() : speak();
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
      $<HTMLVideoElement>('video', scenes[at] ?? player)?.pause();
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
      if (!paused) $<HTMLVideoElement>('video', scenes[at] ?? player)?.play().catch(() => {});
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
  $('[data-pl-prev]', player)!.addEventListener('click', () => (at >= scenes.length ? show(scenes.length - 1) : prev()));
  pauseBtn.addEventListener('click', () => setPaused(!paused));
  soundBtn.addEventListener('click', () => setSound(!sound));
  $('[data-pl-restart]', player)!.addEventListener('click', () => show(0));
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
  document.addEventListener('visibilitychange', () => document.hidden && !paused && setPaused(true));

  // ---------- start ----------
  soundBtn.setAttribute('aria-pressed', String(sound));
  // Browsers only allow sound after a tap: a remembered "narration on" waits for the first one.
  if (sound) {
    sound = false;
    soundBtn.classList.add('is-armed');
    player.addEventListener(
      'pointerup',
      (e) => {
        soundBtn.classList.remove('is-armed');
        if (!sound && !soundBtn.contains(e.target as Node)) setSound(true);
      },
      { once: true },
    );
  }
  const fromHash = scenes.findIndex((s) => s.dataset.id === location.hash.slice(1));
  show(fromHash > 0 ? fromHash : 0);
  if (!store.get('pl-hint', false)) {
    const hint = $('[data-pl-hint]', player)!;
    hint.hidden = false;
    setTimeout(() => (hint.hidden = true), 4000);
    store.set('pl-hint', true);
  }
}
