// «سینمای خبر» (src/pages/cinema/index.astro): the published films of a list (a day's bulletin, the week's best) played
// back to back. Two <video> elements take turns — the next film loads while one plays, so there's no gap — and
// between films a card says what's next, with a countdown, over that story's picture. A film that isn't published yet
// is listed with a way to make it (the story page's «ویدیو» → «فیلم» → «انتشار برای همه»).
import { $, $$, BASE, fmtNum, store, track } from './core';

type Item = { id: number; title: string; short: string; href: string; date: string; thumb: string; imp: number };
type List = { key: string; label: string; items: Item[] };
type Shape = 'h' | 'v';
const NEXT_CARD = 3.5;

export function initCinema() {
  const found = $('[data-cinema]');
  if (!found) return;
  const root: HTMLElement = found;
  const lists = JSON.parse($('[data-cin-data]', root)!.textContent || '[]') as List[];
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
  const toggle = $('[data-cin-toggle]', root)!;

  let shape: Shape = store.get<Shape>('cin-shape', matchMedia('(pointer: coarse)').matches && innerHeight > innerWidth ? 'v' : 'h');
  let list = lists[0];
  let have: Record<string, string[]> = {};
  let queue: Item[] = [];
  let at = -1;
  let front = 0; // which <video> is on screen
  let playing = false;
  let timer = 0;
  let countdown = 0;

  const filmUrl = (id: number) => `${BASE}/media/films/${id}-${shape}.mp4`;
  const hasFilm = (id: number) => have[id]?.includes(shape);

  async function load() {
    const ids = [...new Set(lists.flatMap((l) => l.items.map((i) => i.id)))];
    try {
      const res = await fetch(`${BASE}/media/films/?ids=${ids.join(',')}`);
      have = res.ok ? await res.json() : {};
    } catch {
      have = {};
    }
    render();
  }

  function render() {
    queue = list.items.filter((i) => hasFilm(i.id));
    listEl.innerHTML = '';
    list.items.forEach((it) => {
      const li = document.createElement('li');
      const k = queue.indexOf(it);
      li.className = `cin-item${k < 0 ? ' is-missing' : ''}${k >= 0 && k === at ? ' is-now' : ''}`;
      li.innerHTML = `<button type="button" class="cin-item-btn" ${k < 0 ? 'disabled' : ''}>${it.thumb ? `<img src="${it.thumb}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<span class="cin-noimg"></span>'}<span class="cin-item-text"><b></b><small></small></span></button>${k < 0 ? `<a class="btn sm" href="${it.href}#film">ساختن فیلم</a>` : ''}`;
      $('b', li)!.textContent = it.title;
      $('small', li)!.textContent = k >= 0 ? `فیلم ${fmtNum(k + 1)} از ${fmtNum(queue.length)}` : 'هنوز فیلم ندارد';
      if (k >= 0) $('.cin-item-btn', li)!.addEventListener('click', () => play(k));
      listEl.append(li);
    });
    empty.hidden = queue.length > 0;
    start.hidden = !queue.length;
    if (at < 0) {
      kicker.textContent = 'سینمای خبر';
      cardTitle.textContent = list.label;
      cardSub.textContent = queue.length ? `${fmtNum(queue.length)} فیلم کوتاه، پشت سر هم` : 'هنوز فیلمی منتشر نشده';
      cardBg.style.backgroundImage = queue[0]?.thumb ? `url("${queue[0].thumb}")` : '';
    }
    stage.dataset.shape = shape;
    for (const b of $$<HTMLButtonElement>('[data-cin-shape]', root)) b.setAttribute('aria-pressed', String(b.dataset.cinShape === shape));
  }

  function setPlaying(on: boolean) {
    playing = on;
    toggle.dataset.state = on ? 'playing' : 'idle';
  }

  function showCard(it: Item, k: number, then: () => void, seconds: number) {
    clearInterval(countdown);
    card.hidden = false;
    card.classList.add('is-next');
    start.hidden = true;
    kicker.textContent = k === 0 ? `${list.label}` : `بعدی · ${fmtNum(k + 1)} از ${fmtNum(queue.length)}`;
    cardTitle.textContent = it.title;
    cardSub.textContent = new Intl.DateTimeFormat('fa-IR', { day: 'numeric', month: 'long' }).format(new Date(it.date));
    cardBg.style.backgroundImage = it.thumb ? `url("${it.thumb}")` : '';
    ring.hidden = false;
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
    if (!queue[k]) return;
    clearTimeout(timer);
    at = k;
    const it = queue[k];
    track('cinema');
    // The next card, then the film: from the element that already loaded it, else this one.
    const next = videos[1 - front].dataset.id === String(it.id) ? 1 - front : front;
    const v = videos[next];
    if (v.dataset.id !== String(it.id)) {
      v.dataset.id = String(it.id);
      v.src = filmUrl(it.id);
    }
    videos.forEach((x) => x.pause());
    setPlaying(true);
    render();
    now.textContent = `${fmtNum(k + 1)} / ${fmtNum(queue.length)} · ${it.short}`;
    // The first play happens in the tap (iOS starts sound only there); the card follows over the first second.
    const go = () => {
      card.hidden = true;
      card.classList.remove('is-next');
      ring.hidden = true;
      videos.forEach((x, i) => (x.hidden = i !== next));
      front = next;
      v.currentTime = 0;
      void v.play().catch(() => setPlaying(false));
      preload(k + 1);
      $$('.cin-item', listEl).forEach((li) => li.classList.toggle('is-now', li.querySelector('small')?.textContent?.startsWith(`فیلم ${fmtNum(k + 1)} `) ?? false));
    };
    v.muted = false;
    void v.play().then(() => v.pause()).catch(() => {});
    showCard(it, k, go, k === 0 ? 2.2 : NEXT_CARD);
  }

  for (const v of videos) {
    v.addEventListener('ended', () => {
      if (at + 1 < queue.length) play(at + 1);
      else {
        setPlaying(false);
        at = -1;
        card.hidden = false;
        ring.hidden = true;
        kicker.textContent = 'پایان';
        cardTitle.textContent = `${list.label}: همه‌ی فیلم‌ها دیده شد`;
        cardSub.textContent = 'تا خبرهای بعدی';
        start.hidden = false;
        $('span', start)!.textContent = 'از اول';
      }
    });
    v.addEventListener('play', () => setPlaying(true));
    v.addEventListener('pause', () => !v.ended && v === videos[front] && setPlaying(false));
  }
  start.addEventListener('click', () => play(0));
  toggle.addEventListener('click', () => {
    const v = videos[front];
    if (at < 0) return play(0);
    if (v.paused) void v.play();
    else v.pause();
  });
  $('[data-cin-next]', root)!.addEventListener('click', () => at + 1 < queue.length && play(at + 1));
  $('[data-cin-prev]', root)!.addEventListener('click', () => at > 0 && play(at - 1));
  for (const b of $$<HTMLButtonElement>('[data-cin-shape]', root))
    b.addEventListener('click', () => {
      shape = b.dataset.cinShape as Shape;
      store.set('cin-shape', shape);
      at = -1;
      videos.forEach((v) => (v.pause(), v.removeAttribute('src'), delete v.dataset.id));
      card.hidden = false;
      render();
    });
  for (const t of $$<HTMLButtonElement>('[data-cin-list]', root))
    t.addEventListener('click', () => {
      list = lists.find((l) => l.key === t.dataset.cinList) ?? lists[0];
      $$('[data-cin-list]', root).forEach((x) => x.setAttribute('aria-selected', String(x === t)));
      at = -1;
      videos.forEach((v) => v.pause());
      card.hidden = false;
      $('span', start)!.textContent = 'پخش همه';
      render();
    });
  addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement)?.closest('input, textarea')) return;
    if (e.key === ' ') {
      e.preventDefault();
      toggle.click();
    } else if (e.key === 'ArrowLeft') $('[data-cin-next]', root)!.click();
    else if (e.key === 'ArrowRight') $('[data-cin-prev]', root)!.click();
  });
  render();
  void load();
}
