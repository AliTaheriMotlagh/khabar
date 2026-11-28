// «پادکست خبر»'s player (src/pages/podcast/): both hosts drawn in a little studio (src/scripts/anchor.ts) — the one
// speaking lit and moving with the sound itself (a Web Audio analyser on the episode), the other listening — the line
// being said as a caption, the stories as chapters, the transcript lit as it goes; lock-screen controls (Media
// Session). The sound is the runner's (scripts/podcast.mjs → /media/podcast/<day>.mp3); before it's made, the
// transcript can be read.
import { $, $$, BASE, fmtNum, track } from './core';
import { drawAnchor, drawCohost, faceAt } from './anchor';

type Line = { who: 'g' | 'p'; text: string; id?: number; at?: number; end?: number };
type Ep = { day: string; title: string; label: string; ids: number[]; lines: Line[]; audio?: { seconds: number }; stories: { id: number; title: string; href: string }[] };
const NAMES = { g: 'غلام', p: 'پریسا' };
const SPEEDS = [1, 1.25, 1.5, 0.85];
const clock = (s: number) => `${fmtNum(Math.floor(s / 60))}:${fmtNum(Math.floor(s % 60)).padStart(2, '۰')}`;

export function initPodcast() {
  const found = $('[data-podcast]');
  const json = $('[data-pod-data]');
  if (!found || !json) return;
  const root: HTMLElement = found;
  const eps = JSON.parse(json.textContent || '[]') as Ep[];
  const canvas = $<HTMLCanvasElement>('[data-pod-canvas]', root)!;
  const ctx = canvas.getContext('2d')!;
  const audio = $<HTMLAudioElement>('[data-pod-audio]', root)!;
  const play = $<HTMLButtonElement>('[data-pod-play]', root)!;
  const seek = $<HTMLInputElement>('[data-pod-seek]', root)!;
  const caption = $('[data-pod-caption]', root)!;
  const linesEl = $('[data-pod-lines]', root)!;
  const chapters = $('[data-pod-chapters]', root)!;
  const speedBtn = $<HTMLButtonElement>('[data-pod-speed]', root)!;
  let ep = eps[0];
  let analyser: AnalyserNode | null = null;
  let buf: Float32Array<ArrayBuffer> | null = null;
  let level = 0;
  let current = -1;
  let speed = 0;

  function load(e: Ep) {
    ep = e;
    audio.pause();
    current = -1;
    const has = !!e.audio && e.lines.some((l) => l.at != null);
    $('[data-pod-soon]', root)!.hidden = has;
    play.disabled = !has;
    if (has) audio.src = `${BASE}/media/podcast/${e.day}.mp3`;
    else audio.removeAttribute('src');
    $('[data-pod-title]', root)!.textContent = `${e.title} · ${e.label}`;
    $('[data-pod-len]', root)!.textContent = e.audio ? clock(e.audio.seconds) : '—';
    linesEl.innerHTML = '';
    let story: number | undefined;
    e.lines.forEach((l, i) => {
      if (l.id && l.id !== story) {
        story = l.id;
        const s = e.stories.find((x) => x.id === l.id);
        if (s) {
          const h = document.createElement('li');
          h.className = 'pod-story';
          h.innerHTML = `<a></a>`;
          $('a', h)!.textContent = s.title;
          ($('a', h) as HTMLAnchorElement).href = s.href;
          linesEl.append(h);
        }
      }
      const li = document.createElement('li');
      li.className = `pod-line who-${l.who}`;
      li.dataset.i = String(i);
      li.innerHTML = '<b></b><span></span>';
      $('b', li)!.textContent = NAMES[l.who];
      $('span', li)!.textContent = l.text;
      if (l.at != null) li.addEventListener('click', () => go(l.at!));
      linesEl.append(li);
    });
    chapters.innerHTML = '';
    for (const s of e.stories) {
      const first = e.lines.find((l) => l.id === s.id && l.at != null);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = s.title;
      b.disabled = !first;
      b.addEventListener('click', () => first && go(first.at!));
      chapters.append(b);
    }
    caption.textContent = has ? 'برای شنیدن، پخش را بزنید.' : '';
    for (const t of $$<HTMLButtonElement>('[data-pod-ep]', root)) t.setAttribute('aria-selected', String(t.dataset.podEp === e.day));
    session();
  }

  function go(at: number) {
    audio.currentTime = at;
    if (audio.paused) void start();
  }

  async function start() {
    // The analyser joins on the first tap (an audio context starts only from one).
    if (!analyser) {
      try {
        const ac = new AudioContext();
        const src = ac.createMediaElementSource(audio);
        analyser = ac.createAnalyser();
        analyser.fftSize = 1024;
        buf = new Float32Array(analyser.fftSize);
        src.connect(analyser);
        analyser.connect(ac.destination);
        void ac.resume();
      } catch {}
    }
    await audio.play().catch(() => {});
    track('playlist');
  }

  function lineAt(t: number) {
    const ls = ep.lines;
    for (let i = ls.length - 1; i >= 0; i--) if (ls[i].at != null && ls[i].at! <= t) return i;
    return -1;
  }

  function frame(now: number) {
    requestAnimationFrame(frame);
    if (document.hidden) return;
    const t = now / 1000;
    const at = audio.currentTime;
    const i = audio.paused ? current : lineAt(at);
    const line = ep.lines[i];
    const speaking = !audio.paused && !!line && at <= (line.end ?? Infinity);
    if (analyser && buf && speaking) {
      analyser.getFloatTimeDomainData(buf);
      let s = 0;
      for (const v of buf) s += v * v;
      const rms = Math.min(1, Math.sqrt(s / buf.length) * 5);
      level += (rms > level ? 0.6 : 0.25) * (rms - level);
    } else level *= 0.8;
    // The word being said: its place in the line, by time.
    const words = line?.text.split(/\s+/) ?? [];
    const w = line && line.end ? words[Math.min(words.length - 1, Math.floor(((at - line.at!) / (line.end - line.at!)) * words.length))] ?? '' : '';
    draw(t, line?.who ?? null, speaking, w);
    if (i !== current) {
      current = i;
      caption.textContent = line ? `${NAMES[line.who]}: ${line.text}` : caption.textContent;
      caption.dataset.who = line?.who ?? '';
      $$('.pod-line', linesEl).forEach((li) => li.classList.toggle('is-now', li.dataset.i === String(i)));
      $(`.pod-line[data-i="${i}"]`, linesEl)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    if (!audio.paused && audio.duration) {
      seek.value = String(Math.round((at / audio.duration) * 1000));
      $('[data-pod-at]', root)!.textContent = clock(at);
    }
  }

  function draw(t: number, who: 'g' | 'p' | null, speaking: boolean, word: string) {
    const W = canvas.width;
    const H = canvas.height;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#141c44');
    g.addColorStop(1, '#0a0f24');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // A soft light on whoever speaks.
    const light = (x: number, on: boolean) => {
      const r = ctx.createRadialGradient(x, H * 0.45, 0, x, H * 0.45, 360);
      r.addColorStop(0, on ? 'rgb(255 209 102 / .28)' : 'rgb(120 140 255 / .1)');
      r.addColorStop(1, 'rgb(0 0 0 / 0)');
      ctx.fillStyle = r;
      ctx.fillRect(0, 0, W, H);
    };
    const gx = W * 0.7;
    const px = W * 0.3;
    light(gx, who === 'g' && speaking);
    light(px, who === 'p' && speaking);
    const size = 470;
    const gFace = faceAt(t, who === 'g' ? level : 0, who === 'g' ? word : '', false, who === 'g' && speaking);
    const pFace = faceAt(t + 1.7, who === 'p' ? level : 0, who === 'p' ? word : '', false, who === 'p' && speaking);
    // The listener looks at the speaker.
    if (who === 'g') pFace.look = 0.8;
    if (who === 'p') gFace.look = -0.8;
    drawCohost(ctx, px - size / 2, H * 0.82 - size * 0.86, size, pFace);
    drawAnchor(ctx, gx - size / 2, H * 0.82 - size * 0.86, size, gFace);
    // The desk, in front of them.
    const desk = ctx.createLinearGradient(0, H * 0.8, 0, H);
    desk.addColorStop(0, '#26306a');
    desk.addColorStop(1, '#141a40');
    ctx.fillStyle = desk;
    ctx.beginPath();
    ctx.roundRect(W * 0.04, H * 0.8, W * 0.92, H * 0.3, 30);
    ctx.fill();
    ctx.fillStyle = '#ffd166';
    ctx.fillRect(W * 0.04, H * 0.8, W * 0.92, 4);
    // Name plates on the desk.
    const plate = (x: number, name: string, on: boolean) => {
      ctx.font = '800 30px "Vazirmatn Variable", system-ui, sans-serif';
      ctx.direction = 'rtl';
      ctx.textAlign = 'center';
      const tw = ctx.measureText(name).width + 50;
      ctx.fillStyle = on ? '#ffd166' : 'rgb(255 255 255 / .12)';
      ctx.beginPath();
      ctx.roundRect(x - tw / 2, H * 0.86, tw, 50, 25);
      ctx.fill();
      ctx.fillStyle = on ? '#141a33' : '#fff';
      ctx.fillText(name, x, H * 0.86 + 35);
    };
    plate(gx, 'غلام', who === 'g' && speaking);
    plate(px, 'پریسا', who === 'p' && speaking);
    ctx.font = '600 18px "Vazirmatn Variable", system-ui, sans-serif';
    ctx.fillStyle = 'rgb(255 255 255 / .5)';
    ctx.textAlign = 'center';
    ctx.fillText('مجری‌ها و صداها با هوش مصنوعی · متن از خود خبرها', W / 2, H - 18);
  }

  function session() {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: `${ep.title} · ${ep.label}`, artist: 'غلام و پریسا', album: 'پادکست خبر', artwork: [{ src: `${BASE}/podcast-cover.png`, sizes: '1400x1400', type: 'image/png' }] });
    navigator.mediaSession.setActionHandler('play', () => void start());
    navigator.mediaSession.setActionHandler('pause', () => audio.pause());
    navigator.mediaSession.setActionHandler('seekbackward', () => (audio.currentTime -= 10));
    navigator.mediaSession.setActionHandler('seekforward', () => (audio.currentTime += 10));
  }

  play.addEventListener('click', () => (audio.paused ? void start() : audio.pause()));
  audio.addEventListener('play', () => (play.dataset.state = 'playing'));
  audio.addEventListener('pause', () => (play.dataset.state = 'idle'));
  seek.addEventListener('input', () => audio.duration && (audio.currentTime = (Number(seek.value) / 1000) * audio.duration));
  speedBtn.addEventListener('click', () => {
    speed = (speed + 1) % SPEEDS.length;
    audio.playbackRate = SPEEDS[speed];
    speedBtn.textContent = `${fmtNum(SPEEDS[speed])}×`;
  });
  for (const t of $$<HTMLButtonElement>('[data-pod-ep]', root)) t.addEventListener('click', () => load(eps.find((e) => e.day === t.dataset.podEp) ?? eps[0]));
  load(ep);
  requestAnimationFrame(frame);
}
