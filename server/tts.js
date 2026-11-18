// GET /api/tts/?id=<post>&i=<paragraph> → MP3 of one paragraph of a story, read by a Persian neural voice.
// GET /api/tts/?day=<YYYY-MM-DD>&k=intro|outro|<id> → one of the morning podcast's host lines (pipeline/daily.py).
// GET /api/tts/?id=<post>&k=clip&n=<n> → a line of the story's 60-second video script; ?vid=<youtube id>&i=<n> → a teaser's.
// GET /api/tts/?week=<YYYY-MM-DD>&k=title|intro|outro|<n> → a line of that week's recap (pipeline/daily.py --weekly).
// Phones without a Persian system voice (every iPhone and iPad) listen through this.
// Needs an Azure Speech resource (free tier: 500K characters a month): AZURE_SPEECH_KEY + AZURE_SPEECH_REGION,
// optionally TTS_VOICE (default fa-IR-DilaraNeural; fa-IR-FaridNeural is the male voice).
// The text never comes from the request: paragraph i of the story's own card.json (0 = title, then the body, then
// "why it matters"), so the CDN can cache every clip for good and the key can't be used to read arbitrary text.
import { configured, fail, json, postId, preflight, redis } from './_lib.js';
import { sayLine } from './_say.js';

const KEY = process.env.AZURE_SPEECH_KEY;
const REGION = process.env.AZURE_SPEECH_REGION;
const VOICE = process.env.TTS_VOICE || 'fa-IR-DilaraNeural';
const xml = (s) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const OPTIONS = preflight;

const source = (u, path) => fetch(new URL(path, process.env.TTS_SOURCE || u.origin)).then((r) => (r.ok ? r.json() : null), () => null);

/** The line to say, always from the site's own files: paragraph i of a story's card.json (said the lexicon's way,
 *  `lex`: server/_say.js), or one of the morning podcast's host lines (?day=YYYY-MM-DD&k=intro|outro|<story id>,
 *  /daily/<day>.json). null: a bad request; '': nothing there. */
export async function textOf(u) {
  const week = u.searchParams.get('week');
  if (week) {
    const k = u.searchParams.get('k') || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(week) || !/^(title|intro|outro|\d{1,2})$/.test(k)) return null;
    const w = await source(u, `/weekly/${week}.json`);
    return ((/^\d/.test(k) ? w?.items?.[Number(k)]?.line : w?.[k]) ?? '').trim();
  }
  const day = u.searchParams.get('day');
  if (day) {
    const k = u.searchParams.get('k') || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^(intro|outro|\d{1,8})$/.test(k)) return null;
    const d = await source(u, `/daily/${day}.json`);
    return ((k === 'intro' || k === 'outro' ? d?.[k] : d?.links?.[k]) ?? '').trim();
  }
  const vid = u.searchParams.get('vid');
  if (vid) {
    // An episode teaser's line (/videos/<id>/card.json, src/scripts/video.ts).
    const n = Number(u.searchParams.get('i'));
    if (!/^[\w-]{11}$/.test(vid) || !Number.isInteger(n) || n < 0 || n > 20) return null;
    const t = await source(u, `/videos/${vid}/card.json`);
    return sayLine(([t?.title, ...(t?.body ?? []), t?.why].filter(Boolean)[n] ?? '').trim(), t?.lex).say;
  }
  const id = postId(u.searchParams.get('id'));
  if (u.searchParams.get('k') === 'clip') {
    // The 60-second video's script (card.json `clip`: hook, three points, why).
    const n = Number(u.searchParams.get('n'));
    if (!id || !Number.isInteger(n) || n < 0 || n > 6) return null;
    const c = await source(u, `/p/${id}/card.json`);
    const lines = c?.clip ? [c.clip.hook, ...(c.clip.points ?? []), c.clip.why] : [];
    return sayLine((lines[n] ?? '').trim(), c?.lex).say;
  }
  const i = Number(u.searchParams.get('i'));
  if (!id || !Number.isInteger(i) || i < 0 || i > 200) return null;
  const card = await source(u, `/p/${id}/card.json`);
  if (!card) return '';
  const line = ([card.title, ...(card.body ?? []), card.why].filter(Boolean)[i] ?? '').trim();
  return sayLine(line, card.lex).say;
}

export async function GET(request) {
  const u = new URL(request.url);
  // ?probe=1: is the cloud voice on? The site only offers "listen" where some Persian voice can actually speak.
  if (u.searchParams.has('probe')) return json(request, { ok: Boolean(KEY && REGION) }, { status: KEY && REGION ? 200 : 501, cache: 300 });
  if (!KEY || !REGION) return fail(request, 501, 'not configured');
  const text = await textOf(u);
  if (text === null) return fail(request, 400, 'bad request');
  if (!text) return fail(request, 404, 'no such paragraph');

  const res = await fetch(`https://${REGION}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': KEY,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
      'User-Agent': 'khabar',
    },
    body: `<speak version="1.0" xml:lang="fa-IR"><voice name="${VOICE}">${xml(text.slice(0, 2500))}</voice></speak>`,
  });
  if (!res.ok) return fail(request, 502, `tts ${res.status}`);
  // What Azure counts against the free 500K characters a month (the CDN serves repeats, so only this reaches Azure):
  // shown on the owner's page, next to the quota.
  if (configured()) await redis(['HINCRBY', 'tts:chars', new Date().toISOString().slice(0, 7), String(Math.min(text.length, 2500))], ['HINCRBY', 'tts:clips', new Date().toISOString().slice(0, 7), '1']).catch(() => {});
  return new Response(res.body, {
    headers: {
      'Content-Type': 'audio/mpeg',
      // The client puts a hash of the text in the URL, so an edited paragraph gets a new address.
      'Cache-Control': 'public, max-age=604800, s-maxage=31536000, immutable',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
