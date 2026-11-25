// The site's small ad slot, set from /admin/ («تبلیغات»), no redeploy needed.
// GET  /api/ads            → the public config (what src/scripts/ads.ts shows), shared for 5 minutes at the edge, so a
//                            page view costs no Redis command: { enabled, provider, label, labelEn, slots, house, adsense,
//                            html, langs }. Disabled (or Redis missing) → { enabled: false }.
// GET  /api/ads?txt=1      → ads.txt (functions/ads.txt.js serves it at /ads.txt): the networks' seller lines.
// GET  /api/ads?admin=1    → the whole config, for the owner (Authorization: Bearer ADMIN_TOKEN).
// POST /api/ads            → { config } saved (owner only); checked field by field, anything else dropped.
// Providers: `house` (the owner's own banner: a picture, a title, a line, a link — drawn by the site, no script from
// elsewhere), `adsense` (Google AdSense: publisher + slot ids; the network's script loads only when a slot is near the
// screen), `html` (any ad network's snippet, e.g. Yektanet/Mediaad: run in a sandboxed frame, never on the page itself,
// so it can't read the reader's data or the site's storage). Views and clicks are counted with the presence beat
// (live.js EVENTS `ad-view`, `ad-click`): no request of their own.
import { configured, fail, json, preflight, redis } from './_lib.js';
import { guard } from './admin.js';

const KEY = 'ads:config';
const SLOTS = ['home', 'story', 'list', 'sidebar', 'video'];
const PROVIDERS = ['house', 'adsense', 'html'];
const OFF = { enabled: false };

const str = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max) : '');
const https = (v) => {
  const s = str(v, 600);
  try {
    return new URL(s).protocol === 'https:' ? s : '';
  } catch {
    return '';
  }
};

/** The config as stored: only known fields, each checked. */
export function clean(c = {}) {
  const provider = PROVIDERS.includes(c.provider) ? c.provider : 'house';
  const slots = Array.isArray(c.slots) ? SLOTS.filter((s) => c.slots.includes(s)) : ['home', 'story'];
  const langs = Array.isArray(c.langs) ? ['fa', 'en'].filter((l) => c.langs.includes(l)) : ['fa', 'en'];
  const client = str(c.adsense?.client, 40);
  const slot = str(c.adsense?.slot, 20);
  return {
    enabled: c.enabled === true,
    provider,
    label: str(c.label, 24) || 'تبلیغ',
    labelEn: str(c.labelEn, 24) || 'Sponsored',
    slots,
    langs,
    house: {
      title: str(c.house?.title, 80),
      text: str(c.house?.text, 160),
      cta: str(c.house?.cta, 30),
      image: https(c.house?.image),
      href: https(c.house?.href),
    },
    adsense: { client: /^ca-pub-\d{10,20}$/.test(client) ? client : '', slot: /^\d{6,14}$/.test(slot) ? slot : '' },
    html: str(c.html, 12000),
    height: Math.min(600, Math.max(60, Number(c.height) || 120)),
    adsTxt: str(c.adsTxt, 6000),
    updated: new Date().toISOString(),
  };
}

/** What readers' pages get: nothing they don't need (no ads.txt), and nothing at all when it can't show. */
export function publicView(c) {
  if (!c?.enabled) return OFF;
  const ready =
    (c.provider === 'house' && c.house?.href && (c.house.title || c.house.image)) ||
    (c.provider === 'adsense' && c.adsense?.client && c.adsense?.slot) ||
    (c.provider === 'html' && c.html);
  if (!ready || !c.slots?.length) return OFF;
  const { adsTxt, updated, ...rest } = c;
  return { ...rest, house: c.provider === 'house' ? c.house : undefined, adsense: c.provider === 'adsense' ? c.adsense : undefined, html: c.provider === 'html' ? c.html : undefined };
}

async function load() {
  if (!configured()) return null;
  const [raw] = await redis(['GET', KEY]);
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export const OPTIONS = preflight;

export async function GET(request) {
  const q = new URL(request.url).searchParams;
  if (q.has('admin')) {
    const denied = await guard(request);
    if (denied) return denied;
    return json(request, { config: (await load()) ?? clean({}), slots: SLOTS, providers: PROVIDERS });
  }
  let config = null;
  try {
    config = await load();
  } catch {}
  if (q.has('txt')) {
    const body = config?.adsTxt ? `${config.adsTxt}\n` : '# No ad network is set up yet (/admin/ → تبلیغات).\n';
    return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600, s-maxage=3600' } });
  }
  return json(request, publicView(config), { cache: 300 });
}

export async function POST(request) {
  const denied = await guard(request);
  if (denied) return denied;
  let body;
  try {
    const text = await request.text();
    body = text.length > 24000 ? null : JSON.parse(text || '{}');
  } catch {}
  if (!body?.config) return fail(request, 400, 'bad request');
  const config = clean(body.config);
  await redis(['SET', KEY, JSON.stringify(config)]);
  // The edge copy (functions/_router.js) of this data centre is dropped, so the owner sees the change at once;
  // other data centres pick it up within 5 minutes.
  try {
    const base = new URL(request.url);
    await globalThis.caches?.default?.delete(new Request(`${base.origin}/api/ads/`));
    await globalThis.caches?.default?.delete(new Request(`${base.origin}/api/ads/?txt=1`));
  } catch {}
  return json(request, { ok: true, config });
}
