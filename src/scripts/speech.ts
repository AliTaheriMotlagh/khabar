// Reading text aloud, used by "listen" on a story and by the daily news player.
// The device's own Persian voice when it has one (Android, most desktops); otherwise a Persian neural voice from
// /api/tts, one cached MP3 per paragraph — iPhones and iPads ship no Persian voice at all. The audio element keeps
// playing with the screen locked. start() and resume() must run straight from a tap: iOS only lets audio begin
// inside the gesture, so nothing on that path awaits.
import { SITE } from '../site';

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

export class Speaker {
  lines: Line[] = [];
  at = 0;
  rate = 1;
  state: SpeechState = 'idle';
  private run = 0; // bumps on every start/pause/stop so a cancelled paragraph's events are ignored
  private engine: 'device' | 'cloud' = 'cloud';
  private played = false; // the cloud voice has worked at least once
  private audio = new Audio();

  constructor(private on: Events = {}) {
    this.audio.preload = 'auto';
    this.audio.addEventListener('playing', () => {
      this.played = true;
      this.set('playing');
    });
    this.audio.addEventListener('ended', () => this.engine === 'cloud' && this.play(this.at + 1));
    this.audio.addEventListener('error', () => this.audio.getAttribute('src') && this.cloudFailed());
  }

  start(lines: Line[], from = 0) {
    this.halt();
    this.lines = lines;
    this.engine = voiceFor('fa') || (synth && !lines.some((l) => isPersian(l.text))) ? 'device' : 'cloud';
    this.play(from);
  }

  play(n: number) {
    const mine = ++this.run;
    const line = this.lines[n];
    if (!line) {
      this.halt();
      this.set('idle');
      return this.on.end?.();
    }
    this.at = n;
    this.on.line?.(n);
    if (this.engine === 'cloud') {
      this.set(this.played ? 'playing' : 'loading');
      this.audio.src = clipUrl(line);
      this.audio.playbackRate = this.rate;
      this.audio.play().catch((e: Error) => mine === this.run && e.name !== 'AbortError' && this.cloudFailed());
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

  pause() {
    this.run++;
    // speechSynthesis.pause() is unreliable on mobile: cancel, and restart the paragraph on resume.
    if (this.engine === 'device') synth?.cancel();
    else this.audio.pause();
    this.set('paused');
  }

  resume() {
    if (this.engine === 'cloud' && this.audio.getAttribute('src')) {
      this.run++;
      this.audio.play().catch(() => this.cloudFailed());
      return this.set('playing');
    }
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

  private cloudFailed() {
    // The device's voice list may only have arrived after the tap.
    if (!this.played && voiceFor('fa')) {
      this.engine = 'device';
      return this.play(this.at);
    }
    this.stop();
    this.on.fail?.(this.played ? 'پخش صدا قطع شد؛ اتصال اینترنت را بررسی کنید' : 'صدای فارسی فعلاً در دسترس نیست — کمی بعد دوباره امتحان کنید');
  }
}
