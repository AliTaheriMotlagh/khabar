// «Listen» on the English edition: the headline then each paragraph, the paragraph being read lit (`.is-speaking`);
// a tap on a paragraph goes on from there. Two voices: the downloaded one when the reader chose it in Settings
// (src/scripts/en-voice.ts — made on this device a sentence at a time, the next one made while one plays), else the
// device's own English voice (every phone and computer has one, iOS included). Nothing is sent anywhere.
import { $, $$, store, toast, track } from './core';
import { enClip, enSentences, enVoiceOn, enVoiceState, enVoiceSupported, prepareEnVoice } from './en-voice';

// 50 ms of silent WAV (22,050 Hz, as speech.ts): played inside the tap, so iOS lets this element play the clips that follow.
const SILENCE = URL.createObjectURL(new Blob([new Uint8Array([82, 73, 70, 70, 36, 9, 0, 0, 87, 65, 86, 69, 102, 109, 116, 32, 16, 0, 0, 0, 1, 0, 1, 0, 34, 86, 0, 0, 68, 172, 0, 0, 2, 0, 16, 0, 100, 97, 116, 97, 0, 9, 0, 0, ...new Array(2304).fill(0)])], { type: 'audio/wav' }));

/** What a voice should say of a source's text: no quote markers («> »), links, emoji, hashtag signs or bullets
 *  (a voice reads «>» as "greater than"); @handles keep their name. */
export const speakable = (t: string) =>
  t
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/(^|\n)\s*(?:>+|[-•*▪●]+)\s*/g, '$1')
    .replace(/\p{Extended_Pictographic}\uFE0F?/gu, ' ')
    .replace(/[#@](?=\w)/g, '')
    .replace(/\s+/g, ' ')
    .trim();

export function initEnListen() {
  const btn = $<HTMLButtonElement>('[data-en-listen]');
  const synth = window.speechSynthesis;
  const hasSynth = !!synth && typeof SpeechSynthesisUtterance === 'function';
  if (!btn || (!hasSynth && !enVoiceSupported())) return;
  const label = $('[data-listen-label]', btn);
  // A list page names what it reads (/en/today/: each story's headline and summary, back to back); a story page reads
  // its headline, then its text.
  const list = btn.dataset.parts;
  // A paragraph that only repeats the headline (a tweet whose first sentence is the headline) isn't read twice.
  const same = (el: Element | null) => (el?.textContent ?? '').trim().toLowerCase();
  const parts = (list ? $$(list) : [$('.article-head h1'), ...$$('.article .prose > p'), $('.article .en-quote p')]).filter((el, i, all): el is HTMLElement => !!el && (i === 0 || list != null || same(el) !== same(all[0])));
  if (!parts.length) return;
  void enVoiceState().then(() => {
    if (!hasSynth && !enVoiceOn()) return;
    btn.hidden = false;
    prepareEnVoice();
  });
  let at = -1;
  let playing = false;
  let run = 0; // bumped by every stop or jump: a clip that arrives for an older run is not played
  const audio = new Audio();
  audio.preload = 'auto';
  const voice = () => {
    const all = synth.getVoices().filter((v) => /^en(-|_|$)/i.test(v.lang));
    return all.find((v) => /natural|neural|premium|enhanced|samantha|google us english|aria|jenny/i.test(v.name)) ?? all.find((v) => v.default) ?? all[0] ?? null;
  };
  const mark = (i: number) => parts.forEach((el, k) => el.classList.toggle('is-speaking', k === i));
  const set = (on: boolean) => {
    playing = on;
    btn.setAttribute('aria-pressed', String(on));
    btn.classList.toggle('is-playing', on);
    btn.dataset.state = on ? 'playing' : 'idle'; // the icons (.listen[data-state])
    if (label) label.textContent = on ? 'Pause' : at > 0 ? 'Resume' : 'Listen';
    if (!on) mark(-1);
  };
  const halt = () => {
    run++;
    if (hasSynth) synth.cancel();
    audio.pause();
  };
  const textOf = (i: number) => speakable(parts[i]?.textContent ?? '');
  const say = (i: number) => {
    if (i >= parts.length) {
      at = -1;
      return set(false);
    }
    at = i;
    mark(i);
    if (i > 0 && document.documentElement.dataset.focus !== 'on') parts[i].scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (enVoiceOn()) return void sayClips(i, run);
    sayDevice(i);
  };
  const sayDevice = (i: number) => {
    if (!hasSynth) return set(false);
    const u = new SpeechSynthesisUtterance(textOf(i));
    const v = voice();
    if (v) u.voice = v;
    u.lang = v?.lang ?? 'en-US';
    u.rate = 1;
    u.onend = () => playing && say(i + 1);
    u.onerror = () => playing && say(i + 1);
    synth.speak(u);
  };
  // The downloaded voice: each sentence of the paragraph in turn; the next one (and the next paragraph's first) is
  // asked for while this one plays, so a phone that speaks at about real time still has no gap.
  const sayClips = async (i: number, mine: number) => {
    const lines = enSentences(textOf(i));
    const next = enSentences(textOf(i + 1))[0];
    try {
      for (let k = 0; k < lines.length; k++) {
        const clip = enClip(lines[k], true);
        if (lines[k + 1]) void enClip(lines[k + 1]).catch(() => {});
        else if (next) void enClip(next).catch(() => {});
        const url = await clip;
        if (mine !== run) return;
        audio.src = url;
        await audio.play();
        await new Promise<void>((resolve, reject) => {
          audio.onended = () => resolve();
          audio.onerror = () => reject(new Error('audio'));
        });
        if (mine !== run) return;
      }
      if (playing) say(i + 1);
    } catch {
      if (mine !== run || !playing) return;
      // The model didn't load or a clip failed: the device's voice goes on from this paragraph.
      if (hasSynth) sayDevice(i);
      else set(false);
    }
  };
  btn.addEventListener('click', () => {
    if (playing) {
      halt();
      return set(false);
    }
    halt();
    if (enVoiceOn()) {
      audio.src = SILENCE;
      void audio.play().catch(() => {});
    }
    set(true);
    track('listen');
    say(Math.max(0, at));
    // Once: the device's voice is often robotic off Apple devices — say where a better one is.
    if (!enVoiceOn() && enVoiceSupported() && !store.get('en-voice-tip', false)) {
      store.set('en-voice-tip', true);
      setTimeout(() => toast('Tip: a more natural voice can be downloaded in Settings (Aa)'), 1500);
    }
  });
  // Tap a paragraph to go on from there (a story page; a list's headlines are links).
  if (!list) parts.forEach((el, i) =>
    el.addEventListener('click', () => {
      if (!playing) return;
      halt();
      say(i);
    }),
  );
  // The voice was switched in Settings while reading: go on from this paragraph with the new one.
  document.addEventListener('en-voice-change', () => {
    if (!playing) return;
    halt();
    say(Math.max(0, at));
  });
  addEventListener('pagehide', halt);
}
