// A text-to-speech service the reader connects themselves (the voice sheet, src/scripts/voice-offer.ts): an
// OpenAI-compatible endpoint (OpenAI, or a self-hosted server such as Kokoro-FastAPI or openedai-speech), ElevenLabs,
// Azure Speech, or any address that returns audio for `{text}`. The browser calls it directly with the reader's key: the
// key and the settings stay in this browser's storage and never reach the site's server. One clip per paragraph, the
// next one fetched while the current one plays (src/scripts/speech.ts).
import { store } from './core';

export type RemoteKind = 'openai' | 'elevenlabs' | 'azure' | 'url';
export type Remote = { kind: RemoteKind; url?: string; key?: string; model?: string; voice?: string; region?: string };

export const REMOTE_KINDS: { kind: RemoteKind; name: string }[] = [
  { kind: 'openai', name: 'سازگار با OpenAI' },
  { kind: 'elevenlabs', name: 'ElevenLabs' },
  { kind: 'azure', name: 'Azure Speech' },
  { kind: 'url', name: 'آدرس دلخواه' },
];
/** What an empty field means, per service (also the fields' placeholders). */
export const REMOTE_DEFAULTS: Record<RemoteKind, Partial<Remote>> = {
  openai: { url: 'https://api.openai.com/v1', model: 'gpt-4o-mini-tts', voice: 'alloy' },
  elevenlabs: { model: 'eleven_v3', voice: '' },
  azure: { region: 'westeurope', voice: 'fa-IR-DilaraNeural' },
  url: { url: 'https://example.com/tts?text={text}' },
};

const KEY = 'tts-remote';
export const remoteConfig = (): Remote | null => {
  const c = store.get<Remote | null>(KEY, null);
  return c && REMOTE_DEFAULTS[c.kind] ? c : null;
};
export function setRemoteConfig(c: Remote | null) {
  store.set(KEY, c);
  for (const url of clips.values()) url.then((u) => setTimeout(() => URL.revokeObjectURL(u), 60_000), () => {});
  clips.clear();
}

/** Whether a configuration has what its service needs. */
export function remoteMissing(c: Remote): string | null {
  if (c.kind === 'elevenlabs' && !c.key) return 'کلید API لازم است';
  if (c.kind === 'elevenlabs' && !c.voice) return 'شناسه‌ی صدا (Voice ID) لازم است';
  if (c.kind === 'azure' && !c.key) return 'کلید Azure لازم است';
  if (c.kind === 'url' && !c.url?.includes('{text}')) return 'آدرس باید {text} داشته باشد';
  if (c.kind === 'openai' && (c.url || REMOTE_DEFAULTS.openai.url!).includes('api.openai.com') && !c.key) return 'کلید API لازم است';
  return null;
}

const xml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const val = (c: Remote, k: keyof Remote) => (c[k] as string | undefined)?.trim() || (REMOTE_DEFAULTS[c.kind][k] as string | undefined) || '';

function request(c: Remote, text: string): [string, RequestInit] {
  const key = c.key?.trim();
  switch (c.kind) {
    case 'openai':
      return [
        `${val(c, 'url').replace(/\/+$/, '')}/audio/speech`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(key && { Authorization: `Bearer ${key}` }) },
          body: JSON.stringify({ model: val(c, 'model'), voice: val(c, 'voice'), input: text, response_format: 'mp3' }),
        },
      ];
    case 'elevenlabs':
      return [
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(val(c, 'voice'))}?output_format=mp3_44100_128`,
        { method: 'POST', headers: { 'Content-Type': 'application/json', 'xi-api-key': key ?? '' }, body: JSON.stringify({ text, model_id: val(c, 'model') }) },
      ];
    case 'azure': {
      const voice = val(c, 'voice');
      const lang = voice.split('-').slice(0, 2).join('-') || 'fa-IR';
      return [
        `https://${encodeURIComponent(val(c, 'region'))}.tts.speech.microsoft.com/cognitiveservices/v1`,
        {
          method: 'POST',
          headers: { 'Ocp-Apim-Subscription-Key': key ?? '', 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3' },
          body: `<speak version="1.0" xml:lang="${xml(lang)}"><voice name="${xml(voice)}">${xml(text)}</voice></speak>`,
        },
      ];
    }
    case 'url':
      return [val(c, 'url').replaceAll('{text}', encodeURIComponent(text)), { headers: key ? { Authorization: `Bearer ${key}` } : {} }];
  }
}

/** The audio of one piece of text, as bytes. Errors carry a sentence for the reader. */
export async function remoteAudio(text: string, c = remoteConfig()): Promise<Blob> {
  if (!c) throw new Error('هیچ سرویس صدایی وصل نیست');
  const missing = remoteMissing(c);
  if (missing) throw new Error(missing);
  const [url, init] = request(c, text);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45_000);
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: ctrl.signal, referrerPolicy: 'no-referrer', credentials: 'omit' });
  } catch {
    throw new Error('به سرویس وصل نشد — آدرس را بررسی کنید؛ یا سرویس اجازه‌ی اتصال مستقیم از مرورگر (CORS) نمی‌دهد');
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 140);
    throw new Error(
      res.status === 401 || res.status === 403
        ? 'سرویس کلید را نپذیرفت'
        : res.status === 429
          ? 'سهمیه‌ی سرویس تمام شده یا درخواست‌ها زیاد است'
          : `سرویس خطا داد (${res.status})${detail ? `: ${detail}` : ''}`,
    );
  }
  const blob = await res.blob();
  if (/json|text\/(html|plain)/.test(blob.type) || blob.size < 100) throw new Error('پاسخ سرویس صدا نبود');
  return blob;
}

// Recent clips by text: the next paragraph is fetched while this one plays, and a replay costs nothing.
const clips = new Map<string, Promise<string>>();
export function remoteClip(text: string): Promise<string> {
  const known = clips.get(text);
  if (known) return known;
  const clip = remoteAudio(text).then((b) => URL.createObjectURL(b));
  clip.catch(() => clips.delete(text));
  clips.set(text, clip);
  while (clips.size > 8) {
    const [oldest, p] = clips.entries().next().value!;
    clips.delete(oldest);
    p.then((u) => setTimeout(() => URL.revokeObjectURL(u), 60_000), () => {});
  }
  return clip;
}
