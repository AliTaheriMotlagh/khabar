// The story player (/today/): stories one after another, like Instagram's. The page carries the recent stories in
// circles, one per topic (src/lib/time.ts, groupStories), each story in exactly one. Only what this reader hasn't seen
// or opened yet plays: each circle keeps its unseen stories (as they were when the page opened), circles with none are
// left out, the newest first (orderGroups), and after a circle's last story the show moves on to the next circle with
// something unseen. A story counts as seen after a second on screen, or once it's skipped, so coming back picks up
// where the reader left off. Each scene stays for its own data-seconds.
// Two separate switches: «روایت» reads each story's text aloud (the scene lasts as long as the voice), and «صدای ویدیو»
// lets a video play with its own sound for the video's length. With both on, a video scene is read first (the video
// silent), then its clip plays once with its sound. Tap the left side for the next story and the right side for the
// previous one (it's a right-to-left page), swipe sideways for the next or previous circle, hold to pause, swipe down
// or Esc to leave. ?t=<circle> opens a circle; #<id> (kept up to date while playing) opens a story.
import { $, $$, fmtNum, store, toast } from './core';
import { markSeen, unreadTest } from './game';
import { orderGroups, resumeAt, type StoryItem } from '../lib/time';
import { showImage } from './media';
import { Speaker, canSpeakPersian, getReady, type Line } from './speech';
import { openVoice } from './voice-offer';
import { voiceSupported } from './voice';

/** With its sound on, a video plays for its own length, up to this many seconds. */
const VIDEO_MAX = 60;
/** The clock waits for a scene's picture or video at most this long, then moves on without it. */
const WAIT_MAX = 6000;
/** Up to this many scenes each get a segment of the progress bar; a longer circle gets one bar (a phone fits ~40). */
const BARS_MAX = 40;
/** A story on screen this long counts as seen (skipping past it counts right away). */
const SEEN_MS = 1000;

type MediaEl = HTMLImageElement | HTMLVideoElement;
/** A circle: its unseen stories in the order they play (oldest first), and its face. */
type Group = { key: string; name: string; el: HTMLElement; scenes: HTMLElement[]; items: StoryItem[] };
const mediaOf = (s?: HTMLElement) => (s ? $<MediaEl>('.pl-bg img, .pl-bg video', s) : null);
const videoOf = (s?: HTMLElement) => (s ? $<HTMLVideoElement>('.pl-bg video', s) : null);
/** A video (not a GIF) has its own sound. */
const hasAudio = (s?: HTMLElement) => !!videoOf(s) && !s!.hasAttribute('data-gif');

const player = $('[data-player]');
if (player) init(player);

function init(player: HTMLElement) {
  const every = $$('.pl-scene', player);
  // What's unseen now stays in its circle for the whole visit (going back to a story just watched works), and so does
  // a story named in the address (a shared link, a reload mid-story) even if it was seen.
  const fresh = unreadTest();
  const named = location.hash.slice(1);
  const groups: Group[] = $$('[data-pl-group]', player)
    .map((el) => {
      const scenes = every.filter((s) => s.dataset.g === el.dataset.plGroup && (fresh(Number(s.dataset.id)) || s.dataset.id === named));
      const items = scenes.map((s) => ({ id: Number(s.dataset.id), at: Date.parse(s.dataset.date ?? '') }));
      return { key: el.dataset.plGroup!, name: el.dataset.name!, el, scenes, items };
    })
    .filter((g) => g.scenes.length);
  // The order is fixed for the visit, as on the home rail when it was tapped: watching doesn't reshuffle it.
  const queue = orderGroups(groups, fresh);
  const barBox = $('[data-pl-bars]', player)!;
  const end = $('[data-pl-end]', player)!;
  const backdrop = $('[data-pl-backdrop]', player)!;
  const pos = $('[data-pl-pos]', player)!;
  const pauseBtn = $('[data-pl-pause]', player)!;
  const soundBtn = $('[data-pl-sound]', player)!;
  const listenBtn = $('[data-pl-listen]', player)!;
  const face = $<HTMLImageElement>('[data-pl-face]', player)!;

  let g = 0; // the circle playing, in queue
  let scenes: HTMLElement[] = []; // its stories
  let shown: HTMLElement | null = null; // the scene on screen, until it counts as seen
  let seenTimer = 0;
  let endAt = 0; // when the end screen came up
  const watched: HTMLElement[] = []; // this visit's stories, for the recap
  let bars: HTMLElement[] = [];
  let at = 0;
  let paused = false;
  let held = false;
  let sound = false; // videos play with their own sound
  let listen = false; // stories are read aloud
  let voice = false; // a Persian voice exists (the device's own, the cloud one, or one downloaded to the device)
  const offer = voiceSupported(); // without one, turning narration on offers the download
  let lines: Line[] = [];
  // What the current scene is doing: being read aloud (the voice decides when it ends), playing its video's clip with
  // sound after the reading, or just on the clock.
  let phase: 'plain' | 'narrate' | 'clip' = 'plain';
  let barFrom = 0; // where the bar was when the clip started after the reading
  let elapsed = 0;
  let waited = 0;
  let loading = false;
  let last = 0;
  let raf = 0;

  const speaker = new Speaker({
    end() {
      if (phase !== 'narrate') return;
      sound && hasAudio(scenes[at]) ? playClip() : next();
    },
    fail(msg) {
      toast(msg);
      voice = false; // the scenes go back to the clock; videos keep their own sound
      if (phase === 'narrate') {
        phase = 'plain';
        syncVideo();
      }
      refreshButtons();
    },
  });
  /** This scene ends when the narration does. */
  const voiced = () => phase === 'narrate';
  /** Narration is wanted and possible for the current scene. */
  const narrates = () => listen && voice && lines.length > 0;
  /** The current video plays with its own sound (never under the narration). */
  const loud = () => sound && hasAudio(scenes[at]) && phase !== 'narrate';

  // ---------- the circle being played ----------
  function useGroup(k: number) {
    g = k;
    const group = queue[g];
    scenes = group.scenes;
    // Past BARS_MAX the segments would be slivers: one bar for the whole circle, the «۵ از ۶۰» beside it says where.
    const one = scenes.length > BARS_MAX;
    barBox.innerHTML = '<span><i></i></span>'.repeat(one ? 1 : scenes.length);
    barBox.classList.toggle('many', scenes.length > 24);
    bars = $$(':scope > span', barBox);
    $('[data-pl-name]', player)!.textContent = group.name;
    $('[data-pl-count]', player)!.textContent = fmtNum(scenes.length);
    // The circle's face, as on the home rail.
    const img = $<HTMLImageElement>('img', group.el);
    face.hidden = !img;
    face.nextElementSibling?.toggleAttribute('hidden', !!img);
    if (img) showImage(face, img.currentSrc || img.getAttribute('src') || '', img.dataset.alt);
    refreshButtons();
  }
  /** Story i of circle k. */
  function play(k: number, i: number) {
    if (k !== g || !scenes.length) useGroup(k);
    show(i);
  }
  const unseenIn = (k: number, unread = unreadTest()) => queue[k].items.some((i) => unread(i.id));
  /** After a circle's last story: the next circle with something unseen (the ones after it, then from the top, this
   *  one included if it was opened halfway), else the end. */
  function nextGroup() {
    leave();
    const unread = unreadTest();
    for (let d = 1; d <= queue.length; d++) {
      const k = (g + d) % queue.length;
      if (unseenIn(k, unread)) return play(k, resumeAt(queue[k].items, unread));
    }
    finish();
  }
  /** Before a circle's first story: the previous circle's last one. */
  function prevGroup(): void {
    g > 0 ? play(g - 1, queue[g - 1].scenes.length - 1) : show(0);
  }
  /** A sideways swipe: the next or previous circle, where it was left off. */
  function jump(d: 1 | -1) {
    const k = g + d;
    if (k < 0) return show(0);
    if (k >= queue.length) return nextGroup();
    play(k, resumeAt(queue[k].items, unreadTest()));
  }

  // ---------- seen ----------
  function seen(s: HTMLElement) {
    markSeen(Number(s.dataset.id));
    if (!watched.includes(s)) watched.push(s);
  }
  /** The scene on screen is being left: it counts as seen, however short it was up. */
  function leave() {
    clearTimeout(seenTimer);
    if (shown) seen(shown);
    shown = null;
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
    const withSound = loud();
    v.muted = !withSound;
    v.play().then(
      () => withSound && soundBtn.classList.remove('is-armed'),
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
    if (v && loud()) v.muted = false;
    soundBtn.classList.remove('is-armed');
  });
  /** Mutes or unmutes the current video for the phase it's in. */
  function syncVideo() {
    const v = videoOf(scenes[at]);
    if (!v || !hasAudio(scenes[at])) return;
    v.muted = !loud();
    if (!v.muted && !paused && !held) v.play().catch(() => {});
  }

  // ---------- the clock ----------
  function duration() {
    const s = scenes[at];
    const seconds = Number(s.dataset.seconds) || 8;
    if (voiced()) return Math.max(seconds, lines.reduce((n, l) => n + l.text.length, 0) / 14) * 1000;
    const v = videoOf(s);
    const len = v && Number.isFinite(v.duration) ? v.duration : 0;
    // After the reading, the clip plays once with its sound (a very short one loops for a few seconds).
    if (phase === 'clip') return Math.min(Math.max(len || 8, 4), VIDEO_MAX) * 1000;
    // A clip that's long enough sets the pace (its sound shouldn't start over); a short one loops for the reading time.
    if (loud() && len >= 6) return Math.min(len, VIDEO_MAX) * 1000;
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
    setBar(at, voiced() ? Math.min(p, 0.97) : barFrom + (1 - barFrom) * p);
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

  // ---------- sound: narration and the video's own sound, each with its own switch ----------
  /** The story's own text, chosen at build time (src/pages/today/index.astro, sayOf). */
  function linesOf(s: HTMLElement): Line[] {
    const say = JSON.parse(s.dataset.say ?? '[]') as { i: number; text: string }[];
    return say.map(({ i, text }) => ({ text, post: Number(s.dataset.id), i }));
  }
  function speak() {
    if (voiced() && !paused) speaker.start(lines);
  }
  /** After the reading, a video scene plays its clip from the start, this time with its sound. */
  function playClip() {
    barFrom = Math.min(elapsed / duration(), 0.97);
    phase = 'clip';
    elapsed = 0;
    waited = 0;
    const v = videoOf(scenes[at]);
    if (!v) return;
    v.currentTime = 0;
    if (!paused) playVideo(v);
  }
  const press = (btn: HTMLElement, on: boolean, label: string) => {
    btn.classList.remove('is-armed');
    btn.setAttribute('aria-pressed', String(on));
    btn.setAttribute('aria-label', label);
  };
  function refreshButtons() {
    soundBtn.hidden = !every.some(hasAudio);
    // On a scene without a video's sound the switch still works (it's kept for the next videos), shown dimmed.
    soundBtn.classList.toggle('is-na', at < scenes.length && !hasAudio(scenes[at]));
    listenBtn.hidden = !voice && !offer;
  }
  listenBtn.addEventListener('pointerdown', getReady, { once: true });
  // Both run from a tap, so iOS lets the audio start.
  function setSound(on: boolean) {
    sound = on;
    store.set('pl-sound', on);
    press(soundBtn, on, on ? 'بی‌صدا کردن ویدیو' : 'صدای ویدیو');
    // Turned off while the clip plays after the reading: the scene has nothing left to show.
    if (phase === 'clip' && !on) return next();
    syncVideo();
  }
  function setListen(on: boolean) {
    if (on && !voice) {
      if (!offer) return;
      // No Persian voice yet: offer the download, and come back with narration on from the sheet's own tap.
      if (!paused) setPaused(true);
      openVoice(() => {
        voice = true;
        refreshButtons();
        setPaused(false);
        setListen(true);
      });
      return;
    }
    listen = on;
    store.set('pl-listen', on);
    press(listenBtn, on, on ? 'قطع روایت' : 'روایت خبر');
    if (at >= scenes.length) return;
    speaker.stop();
    const was = phase;
    phase = narrates() ? 'narrate' : 'plain';
    if (phase === 'narrate') {
      // Read from the start of the story; the video goes silent under the voice.
      barFrom = 0;
      elapsed = 0;
      speak();
      warmNext();
    } else if (was === 'clip') phase = 'clip';
    syncVideo();
  }
  /** The on-device voice makes the next scene's first sentence while this one plays. */
  function warmNext() {
    if (listen && voice && scenes[at + 1]) speaker.warm(linesOf(scenes[at + 1]));
  }

  // ---------- scenes ----------
  function show(i: number) {
    if (i >= scenes.length) return nextGroup();
    if (i < 0) return prevGroup();
    leave();
    at = i;
    end.hidden = true;
    player.classList.remove('is-done');
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
    lines = linesOf(s);
    phase = narrates() ? 'narrate' : 'plain';
    barFrom = 0;
    refreshButtons();
    const v = videoOf(s);
    if (v) {
      if (v.currentTime) v.currentTime = 0;
      if (!paused) playVideo(v);
    }
    backdrop.style.backgroundImage = still(s) ? `url("${still(s)}")` : '';
    pos.textContent = fmtNum(at + 1);
    shown = s;
    seenTimer = window.setTimeout(() => s === shown && seen(s), SEEN_MS);
    history.replaceState(history.state, '', `${location.pathname}?t=${encodeURIComponent(queue[g].key)}#${s.dataset.id}`);
    speaker.stop();
    speak();
    warmNext();
    startClock();
  }
  const next = () => show(at + 1);
  const prev = () => show(at - 1);

  // ---------- the end: everything new seen, and what this visit showed ----------
  function finish() {
    leave();
    cancelAnimationFrame(raf);
    speaker.stop();
    phase = 'plain';
    player.classList.remove('is-loading');
    player.classList.add('is-done');
    loading = false;
    $('[data-pl-hint]', player)!.hidden = true;
    every.forEach((s) => s.classList.remove('on'));
    $$<HTMLVideoElement>('video', player).forEach((v) => v.pause());
    bars.forEach((b) => b.style.setProperty('--p', '1'));
    const n = watched.length;
    $('[data-pl-end-title]', player)!.textContent = n ? 'همه‌ی خبرهای تازه را دیدید' : 'خبر تازه‌ای نمانده';
    $('[data-pl-end-text]', player)!.hidden = !n;
    $('[data-pl-end-none]', player)!.hidden = !!n;
    pos.parentElement!.hidden = !queue.length; // «۱ از …» with nothing to play
    $('[data-pl-total]', player)!.textContent = fmtNum(n);
    $('[data-pl-min]', player)!.textContent = fmtNum(Math.max(1, Math.round(watched.reduce((m, s) => m + (Number(s.dataset.seconds) || 8), 0) / 60)));
    // The recap: this visit's stories in the order they played.
    const recap = $('[data-pl-recap]', player)!;
    const list = $('ol', recap)!;
    const tiles = new Map($$('[data-pl-recap-id]', list).map((li) => [li.dataset.plRecapId, li]));
    tiles.forEach((li) => (li.hidden = true));
    watched.forEach((s, k) => {
      const li = tiles.get(s.dataset.id);
      if (!li) return;
      li.hidden = false;
      $('[data-pl-recap-n]', li)!.textContent = fmtNum(k + 1);
      list.append(li);
    });
    recap.hidden = !n;
    list.scrollLeft = 0;
    end.hidden = false;
    end.scrollTop = 0;
    endAt = performance.now();
    at = scenes.length;
    history.replaceState(history.state, '', location.pathname);
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
    if (at >= scenes.length) return;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) return jump(dx > 0 ? 1 : -1);
    const r = taps.getBoundingClientRect();
    (e.clientX - r.left) / r.width < 0.66 ? next() : prev();
  };
  taps.addEventListener('pointerup', release);
  taps.addEventListener('pointercancel', release);
  taps.addEventListener('contextmenu', (e) => e.preventDefault());

  $('[data-pl-next]', player)!.addEventListener('click', () => (at < scenes.length ? next() : undefined));
  $('[data-pl-prev]', player)!.addEventListener('click', () => (at >= scenes.length ? scenes.length && show(scenes.length - 1) : prev()));
  pauseBtn.addEventListener('click', () => setPaused(!paused));
  soundBtn.addEventListener('click', () => {
    const on = sound && soundBtn.classList.contains('is-armed') ? true : !sound;
    setSound(on);
    toast(!on ? 'صدای ویدیو خاموش شد' : !hasAudio(scenes[at]) ? 'صدای ویدیوها روشن شد؛ این خبر ویدیوی صدادار ندارد' : phase === 'narrate' ? 'صدای ویدیو روشن شد؛ بعد از روایت پخش می‌شود' : 'صدای ویدیو روشن شد');
  });
  listenBtn.addEventListener('click', () => {
    const was = listen;
    setListen(!listen);
    if (listen !== was) toast(listen ? 'روایت خبرها روشن شد' : 'روایت خبرها خاموش شد');
  });
  // The tap that ends the last story brings up the end screen under the finger: its click must not open what's there.
  end.addEventListener(
    'click',
    (e) => {
      if (performance.now() - endAt > 450) return;
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );
  /** Opens the story with this id, in its circle. */
  function open(id: string | undefined) {
    const k = queue.findIndex((q) => q.scenes.some((s) => s.dataset.id === id));
    if (k < 0) return false;
    play(k, queue[k].scenes.findIndex((s) => s.dataset.id === id));
    return true;
  }
  $$('[data-pl-go]', player).forEach((b) => b.addEventListener('click', () => open(b.dataset.plGo)));
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
        ArrowDown: () => at < scenes.length && jump(1),
        ArrowUp: () => at < scenes.length && jump(-1),
        ' ': () => setPaused(!paused),
        k: () => setPaused(!paused),
        m: () => setSound(!sound),
        l: () => setListen(!listen),
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
  // Browsers only allow sound after a tap: remembered switches wait for the first one (a tap on a switch itself
  // turns that one on through its own click).
  const wantSound = store.get('pl-sound', false);
  // Before the switches were split, «صدا» meant the narration too.
  const wantListen = store.get<boolean | null>('pl-listen', null) ?? wantSound;
  soundBtn.classList.toggle('is-armed', wantSound);
  listenBtn.classList.toggle('is-armed', wantListen);
  canSpeakPersian().then((ok) => {
    voice = ok;
    if (!ok) listenBtn.classList.remove('is-armed');
    else if (wantListen) getReady(); // the first tap turns narration on: have the voice loaded by then
    refreshButtons();
  });
  if (wantSound || wantListen) {
    player.addEventListener(
      'pointerup',
      (e) => {
        const t = e.target as Node;
        soundBtn.classList.remove('is-armed');
        listenBtn.classList.remove('is-armed');
        if (wantSound && !sound && !soundBtn.contains(t)) setSound(true);
        if (wantListen && voice && !listen && !listenBtn.contains(t)) setListen(true);
      },
      { once: true },
    );
  }
  // A story named in the address (a reload, a shared link), else the circle asked for, else the first one, each where
  // this reader left off.
  if (!queue.length) finish();
  else if (!open(named)) {
    const k = Math.max(0, queue.findIndex((q) => q.key === new URLSearchParams(location.search).get('t')));
    play(k, resumeAt(queue[k].items, unreadTest()));
  }
  addEventListener('pagehide', () => clearTimeout(seenTimer));
  if (!store.get('pl-hint', false)) {
    const hint = $('[data-pl-hint]', player)!;
    hint.hidden = false;
    setTimeout(() => (hint.hidden = true), 4000);
    store.set('pl-hint', true);
  }
}
