// The source's own video inside a story's film (src/scripts/film.ts): the MP4 comes through the site's relay
// (server/clip.js — readable by the page, so its frames can go on the film's canvas), decoded on the device with
// WebCodecs by mediabunny (already the encoder's packer). Frames are pulled in order as the film is made — the encoder
// waits for each (`seek`), the real-time recorder and the preview take the newest one ready — and the clip's own
// sound comes out as mono PCM at the film's rate, to run low under the narration («صدای محیط», as a newscast does).
// Loaded with the film, only for a story that has a clip; any failure leaves the film to its pictures.
import { ALL_FORMATS, AudioBufferSink, BlobSource, CanvasSink, Input, type WrappedCanvas } from 'mediabunny';

/** The biggest clip fetched (the relay's own limit): a longer one is a full video, not a clip. */
const MAX_BYTES = 40 * 1024 * 1024;
const WAIT = 30000;

export type Footage = {
  /** Seconds of video. */
  duration: number;
  width: number;
  height: number;
  /** The frame shown now (the last one `seek` reached), or null before the first. */
  frame(): CanvasImageSource | null;
  /** Moves on to the frame at clip time `t` (seconds). Waits for it; called again while a call runs, it returns at once. */
  seek(t: number): Promise<void>;
  /** The clip's sound from `from` to `to` (clip seconds), mono at `rate`; null when it has none. */
  sound(from: number, to: number, rate: number): Promise<Float32Array | null>;
};

export async function loadFootage(url: string, maxWidth: number, stop: AbortSignal): Promise<Footage | null> {
  try {
    const timer = new AbortController();
    const t = setTimeout(() => timer.abort(), WAIT);
    stop.addEventListener('abort', () => timer.abort(), { once: true });
    const res = await fetch(url, { signal: timer.signal, referrerPolicy: 'no-referrer' }).finally(() => clearTimeout(t));
    const size = Number(res.headers.get('content-length') ?? 0);
    if (!res.ok || size > MAX_BYTES) return null;
    const blob = await res.blob();
    if (blob.size > MAX_BYTES || stop.aborted) return null;
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) return null;
    const dw = await track.getDisplayWidth();
    const dh = await track.getDisplayHeight();
    const width = Math.min(dw, maxWidth);
    const height = Math.round((dh / dw) * width);
    const duration = await track.computeDuration();
    if (!(duration > 0.5)) return null;
    const sink = new CanvasSink(track, { width, height, fit: 'fill' });
    const audioTrack = await input.getPrimaryAudioTrack().catch(() => null);
    const audible = audioTrack && (await audioTrack.canDecode().catch(() => false)) ? audioTrack : null;

    let gen: AsyncGenerator<WrappedCanvas, void, unknown> | null = null;
    let cur: WrappedCanvas | null = null;
    let next: WrappedCanvas | null = null;
    let at = -1;
    let busy: Promise<void> | null = null;
    let ended = false;
    const restart = async (from: number) => {
      await gen?.return(undefined).catch(() => {});
      gen = sink.canvases(Math.max(0, from));
      cur = next = null;
      ended = false;
    };
    const advance = async (t: number) => {
      // Back in time (the preview loops) or far ahead: start again there; else go on frame by frame.
      if (!gen || t < at - 0.05 || t > at + 1.5) await restart(t);
      while (!ended) {
        if (!next) {
          const r = await gen!.next();
          if (r.done) {
            ended = true;
            break;
          }
          next = r.value;
        }
        if (!cur || next.timestamp <= t + 1e-3) {
          cur = next;
          next = null;
        } else break;
      }
      at = t;
    };
    return {
      duration,
      width,
      height,
      frame: () => cur?.canvas ?? null,
      seek(t: number) {
        if (busy) return busy;
        busy = advance(Math.min(t, duration - 0.04)).catch(() => {}).finally(() => (busy = null));
        return busy;
      },
      async sound(from: number, to: number, rate: number) {
        if (!audible || to <= from) return null;
        try {
          const len = Math.ceil((to - from) * rate);
          const ctx = new OfflineAudioContext(1, len, rate);
          let any = false;
          for await (const { buffer, timestamp } of new AudioBufferSink(audible).buffers(from, to)) {
            const src = ctx.createBufferSource();
            src.buffer = buffer;
            src.connect(ctx.destination);
            src.start(Math.max(0, timestamp - from), Math.max(0, from - timestamp));
            any = true;
          }
          return any ? (await ctx.startRendering()).getChannelData(0) : null;
        } catch {
          return null;
        }
      },
    };
  } catch {
    return null;
  }
}
