// The sound of saved stories, kept on the device for listening without internet (the /saved/ page). Only for voices
// that come as audio files: the site's cloud voice (/api/tts, kept by story and paragraph) and a service the reader
// connected (src/scripts/tts-remote.ts, kept by its settings and the text). A downloaded voice and the device's own
// work offline already. Cache Storage `audio-v1` (public/sw.js keeps it): the service worker serves a cloud clip from
// it — ranged requests too — when the page asks with `&off=1`, which it does only for clips it knows are kept (`kept`,
// read once at start), so every other request goes to the network untouched.
import { SITE } from '../site';
import { BASE, store } from './core';
import { cardLines, type Card, type Line } from '../lib/lines';
import { remoteAudio, remoteConfig } from './tts-remote';

export const AUDIO_CACHE = 'audio-v1';
const ROOT = `${location.origin}${BASE}/offline-audio/`;
/** Where a cloud clip is kept: by story and paragraph (the server reads the text itself, so that is all it depends on). */
export const ttsKey = (post: number, i: number) => `${ROOT}tts/${post}/${i}`;
const hashOf = (s: string) => [...s].reduce((h, c) => (h * 33 + c.charCodeAt(0)) >>> 0, 5381).toString(36);
/** A connected service's clip: by its settings (another voice is another sound) and the text. */
const remoteKey = (text: string) => {
  const c = remoteConfig();
  return c ? `${ROOT}remote/${hashOf(JSON.stringify({ ...c, key: undefined }))}/${hashOf(text)}` : null;
};

const kept = new Set<string>();
let ready: Promise<void> | null = null;
/** Reads which clips are kept (once; without creating the cache). */
export function loadKept() {
  ready ??= (async () => {
    try {
      if (!('caches' in window) || !(await caches.has(AUDIO_CACHE))) return;
      for (const r of await (await caches.open(AUDIO_CACHE)).keys()) kept.add(r.url);
    } catch {}
  })();
  return ready;
}
loadKept();

/** The address for a cloud clip: the kept copy (through the service worker) when there is one. Synchronous. */
export const cloudSrc = (url: string, l: Line) => (kept.has(ttsKey(l.post, l.i)) && navigator.serviceWorker?.controller ? `${url}&off=1` : url);

/** A connected service's clip from the device, if kept. */
export async function keptRemote(text: string): Promise<Blob | null> {
  const key = remoteKey(text);
  if (!key || !kept.has(key)) return null;
  try {
    return (await (await caches.open(AUDIO_CACHE)).match(key))?.blob() ?? null;
  } catch {
    return null;
  }
}

export type Kind = 'cloud' | 'remote';
const keyOf = (kind: Kind, l: Line) => (kind === 'cloud' ? ttsKey(l.post, l.i) : remoteKey(l.text));

async function card(id: number): Promise<Card> {
  const res = await fetch(`${BASE}/p/${id}/card.json`);
  if (!res.ok) throw new Error(`card ${res.status}`);
  return res.json();
}
const linesCache = new Map<number, Line[]>();
async function linesOf(id: number) {
  if (!linesCache.has(id)) linesCache.set(id, cardLines(await card(id)));
  return linesCache.get(id)!;
}

/** How much of a story's sound is kept: none, some, or all of it. */
export async function storyState(id: number, kind: Kind): Promise<'none' | 'some' | 'all'> {
  await loadKept();
  const lines = await linesOf(id).catch(() => null);
  if (!lines) return 'none';
  const n = lines.filter((l) => {
    const k = keyOf(kind, l);
    return k && kept.has(k);
  }).length;
  return n === 0 ? 'none' : n === lines.length ? 'all' : 'some';
}

/** Keeps every paragraph of a story; what is kept already isn't fetched again. Reports each paragraph done. */
export async function keepStory(id: number, kind: Kind, step: () => void) {
  const lines = await linesOf(id);
  const cache = await caches.open(AUDIO_CACHE);
  for (const l of lines) {
    const key = keyOf(kind, l);
    if (!key) throw new Error('no voice');
    if (!kept.has(key)) {
      let res: Response;
      if (kind === 'cloud') {
        res = await fetch(`${SITE.api}/api/tts/?id=${l.post}&i=${l.i}&v=${hashOf(l.text)}`);
        if (!res.ok) throw new Error(`tts ${res.status}`);
      } else res = new Response(await remoteAudio(l.text), { headers: { 'Content-Type': 'audio/mpeg' } });
      await cache.put(key, res);
      kept.add(key);
    }
    step();
  }
  navigator.storage?.persist?.().catch(() => {});
  store.set('offline-audio', [...new Set([...store.get<number[]>('offline-audio', []), id])].slice(-200));
}

export async function paragraphsOf(id: number) {
  return (await linesOf(id)).length;
}

/** Lets go of every kept clip. */
export async function dropAll() {
  kept.clear();
  store.set('offline-audio', []);
  try {
    await caches.delete(AUDIO_CACHE);
  } catch {}
}

/** Bytes the kept clips take (best effort). */
export async function keptBytes() {
  try {
    if (!(await caches.has(AUDIO_CACHE))) return 0;
    const cache = await caches.open(AUDIO_CACHE);
    let n = 0;
    for (const r of await cache.keys()) n += (await (await cache.match(r))?.blob())?.size ?? 0;
    return n;
  } catch {
    return 0;
  }
}
