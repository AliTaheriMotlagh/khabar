// Reading text aloud, used by "listen" on a story, the morning brief and the daily news player.
// The device's own Persian voice when it has one (some Android phones and desktops); otherwise a Persian neural voice
// from /api/tts, one cached MP3 per paragraph, when the server has a key; otherwise the voice the reader downloaded
// to this device (src/scripts/voice.ts), made a sentence at a time while the previous one plays — iPhones and iPads
// ship no Persian voice at all. A downloaded voice the reader picked in the voice sheet goes before the other two, and so
// do a voice of the device the reader picked by name (any language) and a speech service they connected themselves
// (src/scripts/tts-remote.ts). The audio element keeps playing with the screen locked. start() and resume() must
// run straight from a tap: iOS only lets audio begin inside the gesture, so nothing on that path awaits (the
// on-device voice first plays a moment of silence in the tap, which unlocks the element for the clips that follow).
import { SITE } from '../site';
import { remoteAudio, remoteClip, remoteConfig } from './tts-remote';
import { cloudSrc, keptRemote } from './offline-audio';
import { store } from './core';
import type { Line } from '../lib/lines';
import { chosenVoice, prepareVoice, sentences, voiceClip, voicePreferred, voiceReady, voiceState } from './voice';

/** One paragraph to read: `i` is its index in the story's card.json (0 = title, then the body, then "why"). */
export type { Line } from '../lib/lines';
export type SpeechState = 'idle' | 'loading' | 'playing' | 'paused';
type Events = { line?(n: number): void; state?(s: SpeechState): void; end?(): void; fail?(msg: string): void };

const synth = 'speechSynthesis' in window ? speechSynthesis : null;
synth?.getVoices(); // starts loading the voice list, so it's ready by the first tap
const isPersian = (s: string) => /[؀-ۿ]/.test(s);
const voiceFor = (lang: string) => synth?.getVoices().find((v) => v.lang.toLowerCase().replace('_', '-').startsWith(lang));
/** Every voice of this device and browser, Persian ones first (the voice sheet lists them). */
export const deviceVoices = () => (synth?.getVoices() ?? []).slice().sort((a, b) => Number(b.lang.startsWith('fa')) - Number(a.lang.startsWith('fa')) || a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name));
/** The device voice the reader picked by name ('dev:<voiceURI>'), when this device still has it. */
export const chosenDeviceVoice = () => {
  const c = chosenVoice();
  return c.startsWith('dev:') ? synth?.getVoices().find((v) => v.voiceURI === c.slice(4)) : undefined;
};
/** The reader picked the speech service they connected. */
const chosenRemote = () => chosenVoice() === 'remote' && !!remoteConfig();
const tag = (s: string) => [...s].reduce((h, c) => (h * 33 + c.charCodeAt(0)) >>> 0, 5381).toString(36);
// The text hash only changes the address (the server reads the text itself), so an edited paragraph isn't served stale.
const clipUrl = (l: Line) => `${SITE.api}/api/tts/?id=${l.post}&i=${l.i}&v=${tag(l.text)}`;
/** 50 ms of silent WAV, played inside the tap while the on-device voice makes its first clip. */
const SILENCE = URL.createObjectURL(new Blob([new Uint8Array([82, 73, 70, 70, 36, 9, 0, 0, 87, 65, 86, 69, 102, 109, 116, 32, 16, 0, 0, 0, 1, 0, 1, 0, 34, 86, 0, 0, 68, 172, 0, 0, 2, 0, 16, 0, 100, 97, 116, 97, 0, 9, 0, 0, ...new Array(2304).fill(0)])], { type: 'audio/wav' }));

export type VoiceSource = 'device' | 'cloud' | 'local' | 'remote';
/** A voice whose sound the page gets as audio (and can keep). */
export type Recordable = 'cloud' | 'local' | 'remote';
let cloudOk = false;
let checked: Promise<void> | null = null;
/** Which Persian voice this device has now: its own, the cloud one (/api/tts has a key), the downloaded one, or none.
 *  Checked ahead of time, never inside the tap that starts playback. */
export async function persianVoice(): Promise<VoiceSource | null> {
  checked ??= (async () => {
    const local = voiceState();
    if (synth) {
      // Chrome fills the voice list a moment after load.
      if (!synth.getVoices().length) await new Promise((r) => (synth.addEventListener('voiceschanged', r, { once: true }), setTimeout(r, 1500)));
      if (voiceFor('fa')) return void (await local);
    }
    try {
      cloudOk = (await fetch(`${SITE.api}/api/tts/?probe=1`)).ok;
      store.set('tts-cloud', cloudOk);
    } catch {
      // Offline: the cloud voice worked last time, and saved stories' clips are kept on the device.
      cloudOk = store.get('tts-cloud', false);
    }
    await local;
  })();
  await checked;
  return hasPersianVoice();
}
/** Synchronous answer, once persianVoice() has resolved: safe to use inside a tap. */
export const hasPersianVoice = (): VoiceSource | null =>
  chosenRemote() ? 'remote' : chosenDeviceVoice() ? 'device' : voicePreferred() ? 'local' : voiceFor('fa') ? 'device' : cloudOk ? 'cloud' : voiceReady() ? 'local' : null;
/** The device's or the server's own Persian voice, which a downloaded one may be preferred over. After persianVoice(). */
export const systemVoice = (): 'device' | 'cloud' | null => (voiceFor('fa') ? 'device' : cloudOk ? 'cloud' : null);
export const canSpeakPersian = async () => (await persianVoice()) !== null;
/** The reader is about to listen: when it's the downloaded voice that will speak, its model starts loading now. */
export const getReady = () => hasPersianVoice() === 'local' && prepareVoice();

/** A voice whose sound the page can keep (the story's video, src/scripts/video.ts): the downloaded one or the cloud
 *  one — the device's own voice only plays aloud. After persianVoice(). */
export const recordableVoice = (): Recordable | null => (chosenRemote() ? 'remote' : voicePreferred() ? 'local' : cloudOk ? 'cloud' : voiceReady() ? 'local' : null);

/** One paragraph's sound as audio files (WAV from the downloaded voice, a sentence each; MP3 from the cloud, the whole
 *  paragraph), each with the sentences it says. */
export async function lineAudio(l: Line, engine: Recordable): Promise<{ texts: string[]; data: ArrayBuffer }[]> {
  if (engine === 'remote') return [{ texts: sentences(l.text), data: await (await remoteAudio(l.text)).arrayBuffer() }];
  if (engine === 'cloud') {
    const res = await fetch(clipUrl(l));
    if (!res.ok) throw new Error(`tts ${res.status}`);
    return [{ texts: sentences(l.text), data: await res.arrayBuffer() }];
  }
  const clip = (text: string): Promise<string> => voiceClip(text, true).catch((e: Error) => (e.message === 'dropped' ? clip(text) : Promise.reject(e)));
  return Promise.all(sentences(l.text).map(async (text) => ({ texts: [text], data: await (await fetch(await clip(text))).arrayBuffer() })));
}

export class Speaker {
  lines: Line[] = [];
  at = 0;
  rate = 1;
  state: SpeechState = 'idle';
  private run = 0; // bumps on every start/pause/stop so a cancelled paragraph's events are ignored
  private engine: VoiceSource = 'cloud';
  private played = false; // the cloud or on-device voice has worked at least once
  private audio = new Audio();
  private pieces: string[] = []; // the on-device voice reads a paragraph in sentences
  private piece = 0;
  private began = 0; // when the device's voice started the paragraph (it can't tell how far it got)
  private error = ''; // what the connected service said when it failed

  constructor(private on: Events = {}) {
    this.audio.preload = 'auto';
    // One voice at a time on a page: another speaker starting (the morning brief, the playlist, a story) stops this one.
    document.addEventListener('speaker-start', (e) => (e as CustomEvent).detail !== this && this.state !== 'idle' && this.stop());
    const silent = () => this.audio.src === SILENCE;
    this.audio.addEventListener('playing', () => {
      if (silent()) return;
      this.played = true;
      this.set('playing');
    });
    this.audio.addEventListener('ended', () => {
      if (silent()) return;
      if (this.engine === 'cloud' || this.engine === 'remote') this.play(this.at + 1);
      else if (this.engine === 'local') this.say(this.piece + 1, this.run);
    });
    this.audio.addEventListener('error', () => this.audio.getAttribute('src') && !silent() && this.failed());
  }

  start(lines: Line[], from = 0) {
    document.dispatchEvent(new CustomEvent('speaker-start', { detail: this }));
    this.halt();
    this.lines = lines;
    this.engine = synth && !lines.some((l) => isPersian(l.text)) ? 'device' : (hasPersianVoice() ?? 'cloud');
    if (this.engine === 'local') {
      this.audio.src = SILENCE;
      this.audio.play().catch(() => {});
    }
    this.play(from);
  }

  /** Gets the on-device voice working on these lines before they are played (the next scene of the player). */
  warm(lines: Line[]) {
    if (hasPersianVoice() !== 'local') return;
    const first = sentences(lines[0]?.text ?? '')[0];
    if (first) voiceClip(first);
  }

  play(n: number): void {
    const mine = ++this.run;
    const line = this.lines[n];
    if (!line) {
      this.halt();
      this.set('idle');
      return this.on.end?.();
    }
    this.at = n;
    this.on.line?.(n);
    if (this.engine === 'local') {
      this.pieces = sentences(line.text);
      return this.say(0, mine);
    }
    if (this.engine === 'cloud') {
      this.set(this.played ? 'playing' : 'loading');
      this.audio.src = cloudSrc(clipUrl(line), line);
      this.audio.playbackRate = this.rate;
      this.audio.play().catch((e: Error) => mine === this.run && e.name !== 'AbortError' && this.failed());
      const next = this.lines[n + 1];
      if (next && cloudSrc(clipUrl(next), next) === clipUrl(next)) fetch(clipUrl(next)).catch(() => {}); // warm the next paragraph
      return;
    }
    if (this.engine === 'remote') {
      if (this.state !== 'playing') this.set('loading');
      keptRemote(line.text).then((b) => (b ? URL.createObjectURL(b) : remoteClip(line.text))).then(
        (url) => {
          if (mine !== this.run) return;
          this.audio.src = url;
          this.audio.playbackRate = this.rate;
          this.audio.play().catch((e: Error) => mine === this.run && e.name !== 'AbortError' && this.failed());
        },
        (e: Error) => mine === this.run && ((this.error = e.message), this.failed()),
      );
      const next = this.lines[n + 1];
      if (next) remoteClip(next.text).catch(() => {});
      return;
    }
    this.set('playing');
    this.began = Date.now();
    const u = new SpeechSynthesisUtterance(line.text);
    const lang = isPersian(line.text) ? 'fa' : 'en';
    u.lang = lang === 'fa' ? 'fa-IR' : 'en-US';
    u.rate = this.rate;
    const v = chosenDeviceVoice() ?? voiceFor(lang);
    if (v) {
      u.voice = v;
      u.lang = v.lang;
    }
    u.onend = () => mine === this.run && this.play(n + 1);
    u.onerror = (e) => {
      if (mine !== this.run || e.error === 'interrupted' || e.error === 'canceled') return;
      this.stop();
      this.on.fail?.('پخش صدا روی این دستگاه ممکن نشد');
    };
    synth!.speak(u);
  }

  /** On-device voice: piece k of the current paragraph, made in the worker; the piece after it is made meanwhile. */
  private say(k: number, mine: number): void {
    if (mine !== this.run) return;
    const text = this.pieces[k];
    if (text === undefined) return this.play(this.at + 1);
    this.piece = k;
    voiceClip(text, true).then(
      (url) => {
        if (mine !== this.run) return;
        this.audio.src = url;
        this.audio.playbackRate = this.rate;
        this.audio.play().catch((e: Error) => mine === this.run && e.name !== 'AbortError' && this.failed());
      },
      // Pushed out of a full queue by read-ahead work: ask again.
      (e: Error) => mine === this.run && (e.message === 'dropped' ? this.say(k, mine) : this.failed()),
    );
    // Between pieces it stays "playing"; starting or resuming shows that the voice is being made.
    if (this.state !== 'playing') this.set('loading');
    const next = this.pieces[k + 1] ?? sentences(this.lines[this.at + 1]?.text ?? '')[0];
    if (next) voiceClip(next);
  }

  pause() {
    this.run++;
    // speechSynthesis.pause() is unreliable on mobile: cancel, and restart the paragraph on resume.
    if (this.engine === 'device') synth?.cancel();
    else this.audio.pause();
    this.set('paused');
  }

  resume() {
    const src = this.audio.getAttribute('src');
    // A clip that was playing goes on from where it stopped.
    if (this.engine !== 'device' && src && this.audio.src !== SILENCE && !this.audio.ended) {
      const mine = ++this.run;
      this.audio.play().catch(() => mine === this.run && this.failed());
      return this.set('playing');
    }
    // Paused while the next sentence was being made: go on with that sentence. Otherwise the paragraph starts again.
    if (this.engine === 'local' && this.pieces.length) return this.say(this.piece, ++this.run);
    this.play(this.at);
  }

  stop() {
    this.halt();
    this.at = 0;
    this.set('idle');
  }

  /** Back (negative) or forward by about this many seconds within the clip playing; past its start or end, to the
   *  sentence or paragraph before or after. The device's own voice can't seek: back restarts the paragraph (or goes to
   *  the one before, right after it started), forward goes to the next one. */
  seek(sec: number) {
    if (this.state === 'idle') return;
    const a = this.audio;
    const clip = this.engine !== 'device' && a.getAttribute('src') && a.src !== SILENCE && Number.isFinite(a.duration);
    if (!clip) return this.step(sec < 0 && Date.now() - this.began > 3000 ? 0 : Math.sign(sec));
    if (sec < 0 && a.currentTime < 1.5) return this.step(-1);
    if (sec > 0 && a.currentTime + sec >= a.duration - 0.2) return this.step(1);
    a.currentTime = Math.max(0, a.currentTime + sec);
  }

  /** To the paragraph before (-1) or after (1), or the start of this one (0). */
  skip(d: number) {
    if (!this.lines.length) return;
    this.play(Math.max(0, Math.min(this.at + d, this.lines.length - (d > 0 ? 0 : 1))));
  }

  /** A sentence of the on-device voice, else a paragraph: before (-1), after (1), or this one again (0). */
  private step(d: number) {
    if (this.engine === 'local' && this.pieces.length) {
      const k = this.piece + d;
      if (k >= 0 && k < this.pieces.length) return this.say(k, ++this.run);
      return this.play(k < 0 ? Math.max(0, this.at - 1) : this.at + 1);
    }
    this.play(Math.max(0, this.at + d));
  }

  setRate(r: number) {
    this.rate = r;
    this.audio.playbackRate = r;
    // A spoken utterance can't change speed midway: restart the current paragraph.
    if (this.engine === 'device' && this.state === 'playing') this.play(this.at);
  }

  private halt() {
    this.run++;
    synth?.cancel();
    this.audio.pause();
    this.audio.removeAttribute('src');
  }

  private set(s: SpeechState) {
    this.state = s;
    this.on.state?.(s);
  }

  private failed() {
    // The device's voice list may only have arrived after the tap. (A service the reader connected says what went wrong
    // instead: they chose it, and need to know it doesn't work.)
    if (!this.played && this.engine !== 'device' && this.engine !== 'remote' && voiceFor('fa')) {
      this.engine = 'device';
      return this.play(this.at);
    }
    if (this.engine === 'cloud' && !this.played && voiceReady()) {
      this.engine = 'local';
      this.audio.src = SILENCE;
      this.audio.play().catch(() => {});
      return this.play(this.at);
    }
    this.stop();
    if (this.engine === 'remote') return this.on.fail?.(`صدای سرویس وصل‌شده: ${this.error || 'پخش نشد'} — در «صدای فارسی» عوضش کنید`);
    if (this.engine === 'local') return this.on.fail?.('صدای فارسی روی این دستگاه اجرا نشد — شاید حافظه کم است؛ صفحه را دوباره باز کنید');
    this.on.fail?.(this.played ? 'پخش صدا قطع شد؛ اتصال اینترنت را بررسی کنید' : 'صدای فارسی فعلاً در دسترس نیست — کمی بعد دوباره امتحان کنید');
  }
}
