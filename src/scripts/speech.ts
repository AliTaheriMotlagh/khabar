// Reading text aloud, used by "listen" on a story, the morning brief and the daily news player.
// The device's own Persian voice when it has one (some Android phones and desktops); otherwise a Persian neural voice
// from /api/tts, one cached MP3 per paragraph, when the server has a key; otherwise the voice the reader downloaded
// to this device (src/scripts/voice.ts), made a sentence at a time while the previous one plays — iPhones and iPads
// ship no Persian voice at all. The audio element keeps playing with the screen locked. start() and resume() must
// run straight from a tap: iOS only lets audio begin inside the gesture, so nothing on that path awaits (the
// on-device voice first plays a moment of silence in the tap, which unlocks the element for the clips that follow).
import { SITE } from '../site';
import { prepareVoice, sentences, voiceClip, voiceReady, voiceState } from './voice';

/** One paragraph to read: `i` is its index in the story's card.json (0 = title, then the body, then "why"). */
export type Line = { text: string; post: number; i: number };
export type SpeechState = 'idle' | 'loading' | 'playing' | 'paused';
type Events = { line?(n: number): void; state?(s: SpeechState): void; end?(): void; fail?(msg: string): void };

const synth = 'speechSynthesis' in window ? speechSynthesis : null;
synth?.getVoices(); // starts loading the voice list, so it's ready by the first tap
const isPersian = (s: string) => /[؀-ۿ]/.test(s);
const voiceFor = (lang: string) => synth?.getVoices().find((v) => v.lang.toLowerCase().replace('_', '-').startsWith(lang));
const tag = (s: string) => [...s].reduce((h, c) => (h * 33 + c.charCodeAt(0)) >>> 0, 5381).toString(36);
// The text hash only changes the address (the server reads the text itself), so an edited paragraph isn't served stale.
const clipUrl = (l: Line) => `${SITE.api}/api/tts/?id=${l.post}&i=${l.i}&v=${tag(l.text)}`;
/** 50 ms of silent WAV, played inside the tap while the on-device voice makes its first clip. */
const SILENCE = URL.createObjectURL(new Blob([new Uint8Array([82, 73, 70, 70, 36, 9, 0, 0, 87, 65, 86, 69, 102, 109, 116, 32, 16, 0, 0, 0, 1, 0, 1, 0, 34, 86, 0, 0, 68, 172, 0, 0, 2, 0, 16, 0, 100, 97, 116, 97, 0, 9, 0, 0, ...new Array(2304).fill(0)])], { type: 'audio/wav' }));

export type VoiceSource = 'device' | 'cloud' | 'local';
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
      if (voiceFor('fa')) return;
    }
    try {
      cloudOk = (await fetch(`${SITE.api}/api/tts/?probe=1`)).ok;
    } catch {}
    await local;
  })();
  await checked;
  return hasPersianVoice();
}
/** Synchronous answer, once persianVoice() has resolved: safe to use inside a tap. */
export const hasPersianVoice = (): VoiceSource | null => (voiceFor('fa') ? 'device' : cloudOk ? 'cloud' : voiceReady() ? 'local' : null);
export const canSpeakPersian = async () => (await persianVoice()) !== null;
/** The reader is about to listen: when it's the downloaded voice that will speak, its model starts loading now. */
export const getReady = () => hasPersianVoice() === 'local' && prepareVoice();

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

  constructor(private on: Events = {}) {
    this.audio.preload = 'auto';
    const silent = () => this.audio.src === SILENCE;
    this.audio.addEventListener('playing', () => {
      if (silent()) return;
      this.played = true;
      this.set('playing');
    });
    this.audio.addEventListener('ended', () => {
      if (silent()) return;
      if (this.engine === 'cloud') this.play(this.at + 1);
      else if (this.engine === 'local') this.say(this.piece + 1, this.run);
    });
    this.audio.addEventListener('error', () => this.audio.getAttribute('src') && !silent() && this.failed());
  }

  start(lines: Line[], from = 0) {
    this.halt();
    this.lines = lines;
    this.engine = voiceFor('fa') || (synth && !lines.some((l) => isPersian(l.text))) ? 'device' : cloudOk || !voiceReady() ? 'cloud' : 'local';
    if (this.engine === 'local') {
      this.audio.src = SILENCE;
      this.audio.play().catch(() => {});
    }
    this.play(from);
  }

  /** Gets the on-device voice working on these lines before they are played (the next scene of the player). */
  warm(lines: Line[]) {
    if (voiceFor('fa') || cloudOk || !voiceReady()) return;
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
      this.audio.src = clipUrl(line);
      this.audio.playbackRate = this.rate;
      this.audio.play().catch((e: Error) => mine === this.run && e.name !== 'AbortError' && this.failed());
      const next = this.lines[n + 1];
      if (next) fetch(clipUrl(next)).catch(() => {}); // warm the next paragraph
      return;
    }
    this.set('playing');
    const u = new SpeechSynthesisUtterance(line.text);
    const lang = isPersian(line.text) ? 'fa' : 'en';
    u.lang = lang === 'fa' ? 'fa-IR' : 'en-US';
    u.rate = this.rate;
    const v = voiceFor(lang);
    if (v) u.voice = v;
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
    // The device's voice list may only have arrived after the tap.
    if (!this.played && voiceFor('fa')) {
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
    if (this.engine === 'local') return this.on.fail?.('صدای فارسی روی این دستگاه اجرا نشد — شاید حافظه کم است؛ صفحه را دوباره باز کنید');
    this.on.fail?.(this.played ? 'پخش صدا قطع شد؛ اتصال اینترنت را بررسی کنید' : 'صدای فارسی فعلاً در دسترس نیست — کمی بعد دوباره امتحان کنید');
  }
}
