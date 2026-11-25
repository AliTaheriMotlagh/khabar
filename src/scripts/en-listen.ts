// «Listen» on the English edition: the device's own English voice (every phone and computer has one, iOS included),
// the headline then each paragraph, the paragraph being read lit (`.is-speaking`) and the word being said when the
// browser reports word boundaries. A tap on a paragraph goes on from there. Nothing is downloaded or sent anywhere.
import { $, $$, track } from './core';

export function initEnListen() {
  const btn = $<HTMLButtonElement>('[data-en-listen]');
  const synth = window.speechSynthesis;
  if (!btn || !synth || typeof SpeechSynthesisUtterance !== 'function') return;
  const label = $('[data-listen-label]', btn);
  const parts = [$('.article-head h1'), ...$$('.article .prose > p'), $('.article .en-quote p')].filter((el): el is HTMLElement => !!el);
  if (!parts.length) return;
  btn.hidden = false;
  let at = -1;
  let playing = false;
  const voice = () => {
    const all = synth.getVoices().filter((v) => /^en(-|_|$)/i.test(v.lang));
    return all.find((v) => /natural|neural|premium|enhanced|samantha|google us english|aria|jenny/i.test(v.name)) ?? all.find((v) => v.default) ?? all[0] ?? null;
  };
  const mark = (i: number) => parts.forEach((el, k) => el.classList.toggle('is-speaking', k === i));
  const set = (on: boolean) => {
    playing = on;
    btn.setAttribute('aria-pressed', String(on));
    btn.classList.toggle('is-playing', on);
    if (label) label.textContent = on ? 'Pause' : at > 0 ? 'Resume' : 'Listen';
    if (!on) mark(-1);
  };
  const say = (i: number) => {
    if (i >= parts.length) {
      at = -1;
      return set(false);
    }
    at = i;
    mark(i);
    if (i > 0 && document.documentElement.dataset.focus !== 'on') parts[i].scrollIntoView({ block: 'center', behavior: 'smooth' });
    const u = new SpeechSynthesisUtterance(parts[i].textContent ?? '');
    const v = voice();
    if (v) u.voice = v;
    u.lang = v?.lang ?? 'en-US';
    u.rate = 1;
    u.onend = () => playing && say(i + 1);
    u.onerror = () => playing && say(i + 1);
    synth.speak(u);
  };
  btn.addEventListener('click', () => {
    if (playing) {
      synth.cancel();
      return set(false);
    }
    synth.cancel();
    set(true);
    track('listen');
    say(Math.max(0, at));
  });
  parts.forEach((el, i) =>
    el.addEventListener('click', () => {
      if (!playing) return;
      synth.cancel();
      say(i);
    }),
  );
  addEventListener('pagehide', () => synth.cancel());
}
