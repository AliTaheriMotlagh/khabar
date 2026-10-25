// The on-device Persian voice (src/scripts/voice.ts), off the main thread: downloads the sherpa-onnx WebAssembly
// runtime and a Persian model into Cache Storage in parts (a dropped connection resumes where it stopped,
// a blocked mirror falls through to the next one, and every file is checked against its SHA-256), loads it on the
// first paragraph, and turns text into WAV, one request at a time.
// Messages in:  { t: 'init', cache, bases, files, config } first, then { t: 'download' } · { t: 'say', id, text, urgent } · { t: 'bump', id }
// Messages out: { t: 'progress', loaded, total } · { t: 'downloaded' } · { t: 'audio', id, wav } · { t: 'dropped', id }
//               { t: 'fail', msg, id? } (a failed download or model load fails every pending request)
type Pack = { name: string; size: number; sha256: string };
type Job = { id: number; text: string };
type Emscripten = {
  _malloc(n: number): number;
  _free(p: number): void;
  lengthBytesUTF8(s: string): number;
  stringToUTF8(s: string, p: number, n: number): void;
  HEAP32: Int32Array;
  HEAPF32: Float32Array;
  _SherpaOnnxOfflineTtsGenerate(tts: number, text: number, sid: number, speed: number): number;
  _SherpaOnnxDestroyOfflineTtsGeneratedAudio(h: number): void;
};
declare function importScripts(...urls: string[]): void;
declare function createOfflineTts(m: unknown, config: unknown): { handle: number };

const scope = self as unknown as { Module?: unknown; postMessage(m: unknown, transfer?: Transferable[]): void; onmessage: ((e: MessageEvent) => void) | null };
const post = (m: unknown, transfer: Transferable[] = []) => scope.postMessage(m, transfer);
/** Each file is stored in parts this big, so an interrupted download keeps what it already has. */
const PART = 8 * 1024 * 1024;
/** Paragraphs waiting beyond this are dropped, oldest first (the reader skipped ahead). */
const QUEUE_MAX = 6;

let cacheName = '';
let bases: string[] = [];
let files: Pack[] = [];
let config: unknown; // sherpa-onnx's OfflineTts config for the model in the package
// Stored under the first mirror's address whichever mirror served them: parts from different mirrors are the same bytes.
const partKey = (f: Pack, k: number) => `${bases[0]}${f.name}?part=${k}`;
const doneKey = (f: Pack) => `${bases[0]}${f.name}?done`;

// ---------- download ----------
async function download() {
  const cache = await caches.open(cacheName);
  const total = files.reduce((s, f) => s + f.size, 0);
  let before = 0; // bytes of the files already complete
  let shown = 0;
  const progress = (loaded: number, force = false) => {
    if (!force && performance.now() - shown < 150) return;
    shown = performance.now();
    post({ t: 'progress', loaded, total });
  };
  for (const f of files) {
    if (!(await cache.match(doneKey(f)))) {
      let error: unknown;
      for (const base of bases) {
        try {
          await fetchFile(cache, f, base, (n, force) => progress(before + n, force));
          error = null;
          break;
        } catch (e) {
          error = e;
        }
      }
      if (error) throw error;
    }
    before += f.size;
  }
  progress(total, true);
}

/** Fetches what is missing of one file from one mirror, storing it part by part, then checks the whole file. */
async function fetchFile(cache: Cache, f: Pack, base: string, progress: (loaded: number, force?: boolean) => void) {
  let k = 0;
  while (k * PART < f.size && (await cache.match(partKey(f, k)))) k++;
  const offset = k * PART;
  progress(offset, true);
  if (offset < f.size) {
    const res = await fetch(base + f.name, offset ? { headers: { Range: `bytes=${offset}-` } } : {});
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    // A server that ignores Range sends the whole file: skip what is already stored.
    let skip = res.status === 206 ? 0 : offset;
    let buf = new Uint8Array(Math.min(PART, f.size - k * PART));
    let at = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      let chunk = value;
      if (skip) {
        const n = Math.min(skip, chunk.length);
        skip -= n;
        chunk = chunk.subarray(n);
      }
      while (chunk.length && k * PART < f.size) {
        const n = Math.min(buf.length - at, chunk.length);
        buf.set(chunk.subarray(0, n), at);
        at += n;
        chunk = chunk.subarray(n);
        if (at === buf.length) {
          await cache.put(partKey(f, k), new Response(buf));
          k++;
          buf = new Uint8Array(Math.max(0, Math.min(PART, f.size - k * PART)));
          at = 0;
        }
      }
      progress(k * PART + at);
    }
    if (k * PART < f.size) throw new Error('incomplete');
  }
  const parts = Math.ceil(f.size / PART);
  await cache.put(doneKey(f), new Response(JSON.stringify({ size: f.size, parts })));
  // Code and model run on the reader's device: any mirror's copy must be exactly the pinned file.
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', await read(cache, f)));
  if ([...hash].map((b) => b.toString(16).padStart(2, '0')).join('') !== f.sha256) {
    for (let i = 0; i < parts; i++) await cache.delete(partKey(f, i));
    await cache.delete(doneKey(f));
    throw new Error('corrupt');
  }
}

async function read(cache: Cache, f: Pack) {
  const meta = await cache.match(doneKey(f)).then((r) => r?.json() as Promise<{ size: number; parts: number }> | undefined);
  if (!meta) throw new Error('missing');
  const out = new Uint8Array(meta.size);
  let at = 0;
  for (let k = 0; k < meta.parts; k++) {
    const part = await cache.match(partKey(f, k));
    if (!part) throw new Error('missing');
    const b = new Uint8Array(await part.arrayBuffer());
    out.set(b, at);
    at += b.length;
  }
  return out;
}

// ---------- the model ----------
let M: Emscripten | null = null;
let tts = 0;
let loading: Promise<void> | null = null;

function load() {
  loading ??= (async () => {
    const cache = await caches.open(cacheName);
    const [main, glue, wasm, data] = await Promise.all(files.map((f) => read(cache, f)));
    await new Promise<void>((resolve, reject) => {
      scope.Module = {
        wasmBinary: wasm,
        getPreloadedPackage: () => data.buffer,
        locateFile: (p: string) => p,
        print() {},
        printErr() {},
        onRuntimeInitialized: resolve,
        onAbort: (what: unknown) => reject(new Error(String(what))),
      };
      const js = (b: Uint8Array) => URL.createObjectURL(new Blob([b as BlobPart], { type: 'text/javascript' }));
      importScripts(js(main), js(glue));
    });
    M = scope.Module as Emscripten;
    tts = createOfflineTts(M, config).handle;
    if (!tts) throw new Error('model');
  })();
  return loading;
}

/** Synthesises one piece of text into a 16-bit mono WAV. */
function speak(text: string) {
  const m = M!;
  const n = m.lengthBytesUTF8(text) + 1;
  const p = m._malloc(n);
  m.stringToUTF8(text, p, n);
  const h = m._SherpaOnnxOfflineTtsGenerate(tts, p, 0, 1);
  m._free(p);
  if (!h) throw new Error('generate');
  const count = m.HEAP32[h / 4 + 1];
  const rate = m.HEAP32[h / 4 + 2];
  const at = m.HEAP32[h / 4] / 4;
  const wav = new DataView(new ArrayBuffer(44 + count * 2));
  const str = (o: number, s: string) => [...s].forEach((c, i) => wav.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  wav.setUint32(4, 36 + count * 2, true);
  str(8, 'WAVEfmt ');
  wav.setUint32(16, 16, true);
  wav.setUint16(20, 1, true);
  wav.setUint16(22, 1, true);
  wav.setUint32(24, rate, true);
  wav.setUint32(28, rate * 2, true);
  wav.setUint16(32, 2, true);
  wav.setUint16(34, 16, true);
  str(36, 'data');
  wav.setUint32(40, count * 2, true);
  for (let i = 0; i < count; i++) wav.setInt16(44 + i * 2, Math.max(-1, Math.min(1, m.HEAPF32[at + i])) * 32767, true);
  m._SherpaOnnxDestroyOfflineTtsGeneratedAudio(h);
  return wav.buffer;
}

// ---------- the queue: the paragraph being waited for first, the ones read ahead after it ----------
const queue: Job[] = [];
let busy = false;

async function pump() {
  if (busy) return;
  busy = true;
  try {
    await load();
    while (queue.length) {
      const job = queue.shift()!;
      try {
        const wav = speak(job.text);
        post({ t: 'audio', id: job.id, wav }, [wav]);
      } catch (e) {
        post({ t: 'fail', id: job.id, msg: String((e as Error).message ?? e) });
      }
      // Let 'say' and 'bump' messages in between paragraphs.
      await new Promise((r) => setTimeout(r));
    }
  } catch (e) {
    queue.length = 0;
    loading = null;
    post({ t: 'fail', msg: String((e as Error).message ?? e) });
  }
  busy = false;
}

scope.onmessage = (e: MessageEvent) => {
  const m = e.data;
  if (m.t === 'init') {
    cacheName = m.cache;
    bases = m.bases;
    files = m.files;
    config = m.config;
  } else if (m.t === 'download') {
    download().then(
      () => post({ t: 'downloaded' }),
      (err) => post({ t: 'fail', msg: String(err?.message ?? err) }),
    );
  } else if (m.t === 'say') {
    const job = { id: m.id, text: m.text };
    m.urgent ? queue.unshift(job) : queue.push(job);
    while (queue.length > QUEUE_MAX) post({ t: 'dropped', id: queue.pop()!.id });
    pump();
  } else if (m.t === 'bump') {
    const i = queue.findIndex((j) => j.id === m.id);
    if (i > 0) queue.unshift(...queue.splice(i, 1));
  }
};

export {}; // a module, so its names stay out of the page scripts' global scope
