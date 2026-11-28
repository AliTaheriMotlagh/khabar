// «سینمای خبر» / News cinema (src/components/Cinema.astro): the published films of a list (a day's bulletin, the week's
// best) played back to back. Two <video> elements take turns — the next film loads while one plays, so there's no gap
// — and between films a card says what's next, with a countdown, over that story's picture. Above the controls the
// bulletin's progress, a segment per film (a tap jumps there); beside the theatre the queue with each film's cover,
// length and whether it's been watched (`cin-seen`); a filter by kind of story; only-unseen and autoplay switches;
// speed, sound, full screen, picture-in-picture, share; the lock screen's controls (Media Session). A story without a
// film in the reader's shape plays in the other one; one without any is listed below with a way to make it (its page's
// video sheet opens on the film, #film).
import { $, $$, BASE, fmtNum, store, toast, track } from './core';

type Item = { id: number; title: string; short: string; href: string; make: string; date: string; thumb: string; pic: string; imp: number; type: string | null; status: string | null; clip: boolean };
type List = { key: string; label: string; items: Item[] };
type Shape = 'h' | 'v' | 's';
type Info = { sec: number | null; cover: boolean };
const NEXT_CARD = 3.5;
const RATES = [1, 1.25, 1.5, 0.75];
const SEEN_KEEP = 400;

export function initCinema() {
  const found = $('[data-cinema]');
  if (!found) return;
  const root: HTMLElement = found;
  const EN = root.dataset.lang === 'en';
  const num = (n: number) => (EN ? String(n) : fmtNum(n));
  const L = EN
    ? { next: 'Next', of: 'of', end: 'The end', allSeen: 'all films watched', until: 'Until the next stories', again: 'Play again', films: (n: number) => `${n} short film${n === 1 ? '' : 's'}`, minutes: (m: number) => `${m} min`, none: 'No films yet', seen: 'Watched', now: 'Playing', other: 'vertical only', noFilm: 'no film yet', copied: 'Link copied', onAir: 'On air' }
    : { next: 'بعدی', of: 'از', end: 'پایان', allSeen: 'همه‌ی فیلم‌ها دیده شد', until: 'تا خبرهای بعدی', again: 'از اول', films: (n: number) => `${fmtNum(n)} فیلم کوتاه`, minutes: (m: number) => `${fmtNum(m)} دقیقه`, none: 'هنوز فیلمی منتشر نشده', seen: 'دیده‌شده', now: 'در حال پخش', other: 'فقط عمودی', noFilm: 'هنوز فیلم ندارد', copied: 'نشانی کپی شد', onAir: 'روی آنتن' };
  const data = JSON.parse($('[data-cin-data]', root)!.textContent || '{}') as { lists: List[]; t: { make: string; play: string; title: string } };
  const lists = data.lists;
  const theatre = $('[data-cin-theatre]', root)!;
  const stage = $('[data-cin-stage]', root)!;
  const videos = [$<HTMLVideoElement>('[data-cin-a]', root)!, $<HTMLVideoElement>('[data-cin-b]', root)!];
  const card = $('[data-cin-card]', root)!;
  const cardBg = $('[data-cin-card-bg]', root)!;
  const kicker = $('[data-cin-card-kicker]', root)!;
  const cardTitle = $('[data-cin-card-title]', root)!;
  const cardSub = $('[data-cin-card-sub]', root)!;
  const start = $<HTMLButtonElement>('[data-cin-start]', root)!;
  const ring = $('[data-cin-ring]', root)!;
  const arc = $('[data-cin-ring-arc]', root) as unknown as SVGCircleElement;
  const listEl = $('[data-cin-items]', root)!;
  const empty = $('[data-cin-empty]', root)!;
  const now = $('[data-cin-now]', root)!;
  const time = $('[data-cin-time]', root)!;
  const toggle = $('[data-cin-toggle]', root)!;
  const segs = $('[data-cin-segs]', root)!;
  const onair = $('[data-cin-onair]', root)!;
  const flash = $('[data-cin-flash]', root)!;
  const lower = $('[data-cin-lower]', root)!;
  const unseenBox = $<HTMLInputElement>('[data-cin-unseen]', root)!;
  const autoBox = $<HTMLInputElement>('[data-cin-auto]', root)!;
  const rateBtn = $<HTMLButtonElement>('[data-cin-rate]', root)!;
  const muteBtn = $<HTMLButtonElement>('[data-cin-mute]', root)!;

  let shape: Shape = store.get<Shape>('cin-shape', matchMedia('(pointer: coarse)').matches && innerHeight > innerWidth ? 'v' : 'h');
  let list = lists[0];
  let kind = '';
  let have: Record<string, Partial<Record<Shape, Info>>> = {};
  let queue: Item[] = [];
  let at = -1;
  let front = 0; // which <video> is on screen
  let timer = 0;
  let countdown = 0;
  let rate = store.get<number>('cin-rate', 1);
  let muted = store.get<boolean>('cin-muted', false);
  const seen = new Set<number>(store.get<number[]>('cin-seen', []));
  unseenBox.checked = store.get<boolean>('cin-unseen', false);
  autoBox.checked = store.get<boolean>('cin-auto', true);

  /** The shape this story's film plays in: the reader's, else whichever there is. */
  const shapeOf = (id: number): Shape | null => {
    const h = have[id];
    if (!h) return null;
    return h[shape] ? shape : (['h', 'v', 's'] as Shape[]).find((s) => h[s]) ?? null;
  };
  const filmUrl = (id: number) => `${BASE}/media/films/${id}-${shapeOf(id)}.mp4`;
  const posterOf = (it: Item) => {
    const s = shapeOf(it.id);
    return s && have[it.id]?.[s]?.cover ? `${BASE}/media/films/${it.id}-${s}.jpg` : it.pic || it.thumb;
  };
  const secsOf = (it: Item) => {
    const s = shapeOf(it.id);
    return (s && have[it.id]?.[s]?.sec) || null;
  };
  const clock = (s: number) => {
    const m = Math.floor(s / 60);
    const out = `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    return EN ? out : out.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
  };
  const markSeen = (id: number) => {
    if (seen.has(id)) return;
    seen.add(id);
    store.set('cin-seen', [...seen].slice(-SEEN_KEEP));
  };

  async function load() {
    const ids = [...new Set(lists.flatMap((l) => l.items.map((i) => i.id)))];
    try {
      const res = await fetch(`${BASE}/media/films/?ids=${ids.slice(0, 60).join(',')}&meta=1`);
      const got = res.ok ? ((await res.json()) as Record<string, string[] | Partial<Record<Shape, Info>>>) : {};
      // An older server answers with the shapes alone.
      have = Object.fromEntries(Object.entries(got).map(([id, v]) => [id, Array.isArray(v) ? Object.fromEntries(v.map((s) => [s, { sec: null, cover: false }])) : v]));
    } catch {
      have = {};
    }
    render();
    // A link to one film (/cinema/#<id>): its card, ready to play.
    const want = Number(location.hash.slice(1));
    const k = queue.findIndex((i) => i.id === want);
    if (k >= 0) cueCard(k);
  }

  function render() {
    const items = list.items.filter((i) => !kind || i.type === kind);
    const playable = items.filter((i) => shapeOf(i.id));
    queue = unseenBox.checked && playable.some((i) => !seen.has(i.id)) ? playable.filter((i) => !seen.has(i.id) || (at >= 0 && queue[at]?.id === i.id)) : playable;
    listEl.innerHTML = '';
    queue.forEach((it, k) => {
      const li = document.createElement('li');
      li.className = `cin-item${k === at ? ' is-now' : ''}${seen.has(it.id) ? ' is-seen' : ''}`;
      li.innerHTML = `<button type="button" class="cin-item-btn"><span class="cin-thumb"><img alt="" loading="lazy" referrerpolicy="no-referrer"><span class="cin-dur"></span><span class="cin-eq" aria-hidden="true"><i></i><i></i><i></i></span></span><span class="cin-item-text"><small></small><b></b></span></button>`;
      const img = $<HTMLImageElement>('img', li)!;
      img.src = posterOf(it);
      img.onerror = () => (img.onerror = null, (img.src = it.thumb || ''));
      const secs = secsOf(it);
      $('.cin-dur', li)!.textContent = secs ? clock(secs) : '';
      $('b', li)!.textContent = it.title;
      $('small', li)!.textContent = [k === at ? L.now : seen.has(it.id) ? L.seen : `${num(k + 1)}`, it.type, shapeOf(it.id) !== shape ? L.other : ''].filter(Boolean).join(' · ');
      $('.cin-item-btn', li)!.addEventListener('click', () => play(k));
      listEl.append(li);
    });
    empty.hidden = queue.length > 0;
    start.hidden = !queue.length;
    // The bulletin: one segment per film, as long as the film.
    segs.innerHTML = '';
    queue.forEach((it, k) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `cin-seg${k < at ? ' is-done' : ''}${k === at ? ' is-now' : ''}`;
      b.style.flexGrow = String(secsOf(it) ?? 90);
      b.setAttribute('aria-label', it.title);
      b.innerHTML = '<i></i>';
      b.addEventListener('click', () => play(k));
      segs.append(b);
    });
    // The page's numbers: how many films, how long.
    const total = queue.reduce((s, i) => s + (secsOf(i) ?? 0), 0);
    $('[data-cin-stats]', root)!.textContent = queue.length ? [L.films(queue.length), total ? L.minutes(Math.max(1, Math.round(total / 60))) : ''].filter(Boolean).join(' · ') : L.none;
    if (at < 0) {
      kicker.textContent = data.t.title;
      cardTitle.textContent = list.label;
      cardSub.textContent = queue.length ? [L.films(queue.length), total ? L.minutes(Math.max(1, Math.round(total / 60))) : ''].filter(Boolean).join(' · ') : L.none;
      cardBg.style.backgroundImage = queue[0] ? `url("${posterOf(queue[0])}")` : '';
    }
    stage.dataset.shape = at >= 0 && queue[at] ? (shapeOf(queue[at].id) ?? shape) : shape;
    for (const b of $$<HTMLButtonElement>('[data-cin-shape]', root)) b.setAttribute('aria-pressed', String(b.dataset.cinShape === shape));
    // The stories with no film at all: a way to make one.
    const missing = items.filter((i) => !shapeOf(i.id)).slice(0, 8);
    const box = $('[data-cin-missing]', root)!;
    box.hidden = !missing.length;
    const grid = $('[data-cin-missing-list]', root)!;
    grid.innerHTML = '';
    for (const it of missing) {
      const li = document.createElement('li');
      li.className = 'cin-mcard';
      li.innerHTML = `<a href="${it.make}"><span class="cin-mpic"></span><span class="cin-mtext"><small></small><b></b><span class="btn sm primary"></span></span></a>`;
      if (it.thumb) $<HTMLElement>('.cin-mpic', li)!.style.backgroundImage = `url("${it.thumb}")`;
      $('small', li)!.textContent = [it.type, it.clip ? (EN ? 'has video' : 'ویدیو دارد') : ''].filter(Boolean).join(' · ');
      $('b', li)!.textContent = it.short || it.title;
      $('.btn', li)!.textContent = data.t.make;
      grid.append(li);
    }
  }

  function setPlaying(on: boolean) {
    toggle.dataset.state = on ? 'playing' : 'idle';
    flash.dataset.state = on ? 'playing' : 'idle';
    theatre.toggleAttribute('data-playing', on);
    onair.hidden = !on && at < 0;
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = on ? 'playing' : 'paused';
  }
  function blink() {
    flash.classList.remove('is-on');
    void flash.offsetWidth;
    flash.classList.add('is-on');
  }

  function showCard(it: Item, k: number, then: (() => void) | null, seconds: number) {
    clearInterval(countdown);
    card.hidden = false;
    card.classList.add('is-next');
    lower.hidden = true;
    start.hidden = !!then;
    kicker.textContent = k === 0 ? list.label : `${L.next} · ${num(k + 1)} ${L.of} ${num(queue.length)}`;
    cardTitle.textContent = it.title;
    cardSub.textContent = [it.type, it.status, EN ? new Date(it.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' }) : new Intl.DateTimeFormat('fa-IR', { day: 'numeric', month: 'long' }).format(new Date(it.date))].filter(Boolean).join(' · ');
    cardBg.style.backgroundImage = `url("${posterOf(it)}")`;
    ring.hidden = !then;
    if (!then) return;
    const t0 = performance.now();
    countdown = window.setInterval(() => {
      const p = Math.min(1, (performance.now() - t0) / (seconds * 1000));
      arc.style.strokeDashoffset = String(100 - p * 100);
      if (p >= 1) {
        clearInterval(countdown);
        then();
      }
    }, 50);
  }
  /** A film's card, waiting for «پخش» (a link to it, or the next one with autoplay off). */
  function cueCard(k: number) {
    at = k - 1;
    showCard(queue[k], k, null, 0);
    $('span', start)!.textContent = data.t.play;
    start.onclick = () => play(k);
  }

  function preload(k: number) {
    const it = queue[k];
    const back = videos[1 - front];
    if (!it) return;
    if (back.dataset.id !== String(it.id)) {
      back.dataset.id = String(it.id);
      back.src = filmUrl(it.id);
      back.load();
    }
  }

  function play(k: number) {
    const it = queue[k];
    if (!it) return;
    clearTimeout(timer);
    at = k;
    track('cinema');
    // The film: from the element that already loaded it, else this one.
    const next = videos[1 - front].dataset.id === String(it.id) ? 1 - front : front;
    const v = videos[next];
    if (v.dataset.id !== String(it.id)) {
      v.dataset.id = String(it.id);
      v.src = filmUrl(it.id);
    }
    videos.forEach((x) => x.pause());
    setPlaying(true);
    render();
    now.textContent = it.short || it.title;
    $('[data-cin-onair-text]', root)!.textContent = `${L.onAir} · ${num(k + 1)}/${num(queue.length)}`;
    $('[data-cin-lower-kicker]', root)!.textContent = [it.type, it.status].filter(Boolean).join(' · ');
    $('[data-cin-lower-title]', root)!.textContent = it.title;
    history.replaceState(null, '', `#${it.id}`);
    if ('mediaSession' in navigator)
      navigator.mediaSession.metadata = new MediaMetadata({ title: it.title, artist: data.t.title, artwork: [{ src: new URL(posterOf(it), location.href).href, sizes: '1280x720', type: 'image/jpeg' }] });
    const go = () => {
      card.hidden = true;
      card.classList.remove('is-next');
      ring.hidden = true;
      videos.forEach((x, i) => (x.hidden = i !== next));
      front = next;
      v.currentTime = 0;
      v.playbackRate = rate;
      v.muted = muted;
      void v.play().catch(() => setPlaying(false));
      // The film names its story itself: the strap only shows while paused.
      lower.hidden = true;
      preload(k + 1);
    };
    // The first play happens in the tap (iOS starts sound only there); the card follows over the first second.
    v.muted = muted;
    void v.play().then(() => v.pause()).catch(() => {});
    showCard(it, k, go, k === 0 || !autoBox.checked ? 1.6 : NEXT_CARD);
  }

  function ended() {
    const v = videos[front];
    if (queue[at]) markSeen(queue[at].id);
    if (at + 1 < queue.length) {
      if (autoBox.checked) play(at + 1);
      else {
        setPlaying(false);
        cueCard(at + 1);
      }
      return;
    }
    v.pause();
    setPlaying(false);
    at = -1;
    render();
    card.hidden = false;
    ring.hidden = true;
    lower.hidden = true;
    kicker.textContent = L.end;
    cardTitle.textContent = `${list.label}: ${L.allSeen}`;
    cardSub.textContent = L.until;
    start.hidden = false;
    $('span', start)!.textContent = L.again;
    start.onclick = () => play(0);
  }

  // Progress: the time, the current segment's fill, the film counted as watched three quarters in.
  let raf = 0;
  const tick = () => {
    const v = videos[front];
    const seg = segs.children[at] as HTMLElement | undefined;
    if (v.duration) {
      if (seg) seg.style.setProperty('--p', String(v.currentTime / v.duration));
      time.textContent = `${clock(v.currentTime)} / ${clock(v.duration)}`;
      if (v.currentTime / v.duration > 0.75 && queue[at]) markSeen(queue[at].id);
    }
    raf = !v.paused ? requestAnimationFrame(tick) : 0;
  };
  for (const v of videos) {
    v.addEventListener('ended', () => v === videos[front] && ended());
    v.addEventListener('play', () => {
      if (v !== videos[front]) return;
      setPlaying(true);
      if (!raf) raf = requestAnimationFrame(tick);
    });
    v.addEventListener('pause', () => {
      if (v.ended || v !== videos[front]) return;
      setPlaying(false);
      lower.hidden = false;
    });
    v.addEventListener('error', () => v === videos[front] && at >= 0 && window.setTimeout(ended, 600));
  }

  const playPause = () => {
    const v = videos[front];
    if (at < 0 || !card.hidden) return start.click();
    if (v.paused) void v.play();
    else v.pause();
    blink();
  };
  start.onclick = () => {
    // With «only unseen», from the first one not watched.
    const k = Math.max(0, queue.findIndex((i) => !seen.has(i.id)));
    play(unseenBox.checked ? k : 0);
  };
  toggle.addEventListener('click', playPause);
  $('[data-cin-tap]', root)!.addEventListener('click', playPause);
  $('[data-cin-next]', root)!.addEventListener('click', () => at + 1 < queue.length && play(at + 1));
  $('[data-cin-prev]', root)!.addEventListener('click', () => {
    const v = videos[front];
    // A few seconds in: back to this film's start, as a player does; else the one before.
    if (at >= 0 && v.currentTime > 4) v.currentTime = 0;
    else if (at > 0) play(at - 1);
  });
  const showRate = () => (rateBtn.textContent = `${EN ? rate : fmtNum(rate)}×`);
  showRate();
  rateBtn.addEventListener('click', () => {
    rate = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
    store.set('cin-rate', rate);
    videos.forEach((v) => (v.playbackRate = rate));
    showRate();
  });
  const showMute = () => muteBtn.setAttribute('aria-pressed', String(muted));
  showMute();
  muteBtn.addEventListener('click', () => {
    muted = !muted;
    store.set('cin-muted', muted);
    videos.forEach((v) => (v.muted = muted));
    showMute();
  });
  const pip = $<HTMLButtonElement>('[data-cin-pip]', root)!;
  pip.hidden = !document.pictureInPictureEnabled;
  pip.addEventListener('click', () => {
    if (document.pictureInPictureElement) void document.exitPictureInPicture();
    else void videos[front].requestPictureInPicture?.().catch(() => {});
  });
  $('[data-cin-full]', root)!.addEventListener('click', () => {
    if (document.fullscreenElement) return void document.exitFullscreen();
    if (theatre.requestFullscreen) void theatre.requestFullscreen().catch(() => {});
    else (videos[front] as HTMLVideoElement & { webkitEnterFullscreen?: () => void }).webkitEnterFullscreen?.();
  });
  $('[data-cin-share]', root)!.addEventListener('click', () => {
    const it = queue[at] ?? queue[0];
    const link = new URL(it ? `${location.pathname}#${it.id}` : location.pathname, location.href).href;
    if (navigator.share) void navigator.share({ title: it?.title ?? data.t.title, url: link }).catch(() => {});
    else void navigator.clipboard?.writeText(link).then(() => toast(L.copied));
  });
  unseenBox.addEventListener('change', () => {
    store.set('cin-unseen', unseenBox.checked);
    if (at < 0) render();
  });
  autoBox.addEventListener('change', () => store.set('cin-auto', autoBox.checked));
  const reset = () => {
    at = -1;
    clearInterval(countdown);
    videos.forEach((v) => (v.pause(), v.removeAttribute('src'), delete v.dataset.id));
    card.hidden = false;
    card.classList.remove('is-next');
    ring.hidden = true;
    lower.hidden = true;
    setPlaying(false);
    $('span', start)!.textContent = data.t.play;
    start.onclick = () => play(unseenBox.checked ? Math.max(0, queue.findIndex((i) => !seen.has(i.id))) : 0);
    time.textContent = '';
    now.textContent = '';
    render();
  };
  for (const b of $$<HTMLButtonElement>('[data-cin-shape]', root))
    b.addEventListener('click', () => {
      shape = b.dataset.cinShape as Shape;
      store.set('cin-shape', shape);
      reset();
    });
  for (const t of $$<HTMLButtonElement>('[data-cin-list]', root))
    t.addEventListener('click', () => {
      list = lists.find((l) => l.key === t.dataset.cinList) ?? lists[0];
      $$('[data-cin-list]', root).forEach((x) => x.setAttribute('aria-selected', String(x === t)));
      reset();
    });
  for (const c of $$<HTMLButtonElement>('[data-cin-kind]', root))
    c.addEventListener('click', () => {
      kind = c.dataset.cinKind ?? '';
      $$('[data-cin-kind]', root).forEach((x) => x.setAttribute('aria-pressed', String(x === c)));
      reset();
    });
  if ('mediaSession' in navigator) {
    const ms = navigator.mediaSession;
    ms.setActionHandler('play', () => void videos[front].play());
    ms.setActionHandler('pause', () => videos[front].pause());
    ms.setActionHandler('nexttrack', () => at + 1 < queue.length && play(at + 1));
    ms.setActionHandler('previoustrack', () => at > 0 && play(at - 1));
  }
  addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement)?.closest('input, textarea, select, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === ' ' || k === 'k') {
      e.preventDefault();
      playPause();
    } else if (k === 'arrowleft') $(EN ? '[data-cin-prev]' : '[data-cin-next]', root)!.click();
    else if (k === 'arrowright') $(EN ? '[data-cin-next]' : '[data-cin-prev]', root)!.click();
    else if (k === 'f') $('[data-cin-full]', root)!.click();
    else if (k === 'm') muteBtn.click();
  });
  render();
  void load();
}
