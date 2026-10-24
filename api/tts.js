// GET /api/tts/?id=<post>&i=<paragraph> → MP3 of one paragraph of a story, read by a Persian neural voice.
// Phones without a Persian system voice (every iPhone and iPad) listen through this.
// Needs an Azure Speech resource (free tier: 500K characters a month): AZURE_SPEECH_KEY + AZURE_SPEECH_REGION,
// optionally TTS_VOICE (default fa-IR-DilaraNeural; fa-IR-FaridNeural is the male voice).
// The text never comes from the request: paragraph i of the story's own card.json (0 = title, then the body, then
// "why it matters"), so the CDN can cache every clip for good and the key can't be used to read arbitrary text.
import { fail, postId, preflight } from './_lib.js';

const KEY = process.env.AZURE_SPEECH_KEY;
const REGION = process.env.AZURE_SPEECH_REGION;
const VOICE = process.env.TTS_VOICE || 'fa-IR-DilaraNeural';
const xml = (s) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const OPTIONS = preflight;

export async function GET(request) {
  if (!KEY || !REGION) return fail(request, 501, 'not configured');
  const u = new URL(request.url);
  const id = postId(u.searchParams.get('id'));
  const i = Number(u.searchParams.get('i'));
  if (!id || !Number.isInteger(i) || i < 0 || i > 200) return fail(request, 400, 'bad request');

  const card = await fetch(new URL(`/p/${id}/card.json`, process.env.TTS_SOURCE || u.origin)).then((r) => (r.ok ? r.json() : null), () => null);
  if (!card) return fail(request, 404, 'no such story');
  const text = [card.title, ...(card.body ?? []), card.why].filter(Boolean)[i]?.trim();
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
  return new Response(res.body, {
    headers: {
      'Content-Type': 'audio/mpeg',
      // The client puts a hash of the text in the URL, so an edited paragraph gets a new address.
      'Cache-Control': 'public, max-age=604800, s-maxage=31536000, immutable',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
