// Shared helpers for the guest comments/reactions API (Vercel Functions, Node runtime).
// Storage is Upstash Redis over its REST API (free tier) — connect it from the Vercel dashboard (Storage → Upstash),
// which sets KV_REST_API_URL / KV_REST_API_TOKEN. KHABAR_MEMORY_STORE=1 uses an in-memory store (tests only).
// KV_PREFIX (e.g. "khabar:") namespaces every key, so one database can be shared with another app.
import { createHash } from 'node:crypto';

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const SALT = process.env.HASH_SALT || REDIS_TOKEN || 'khabar';
const PREFIX = process.env.KV_PREFIX || '';

export const REACTIONS = ['like', 'love', 'fire', 'wow', 'haha', 'sad'];
export const MAX_COMMENTS = 300;

// ---------- storage ----------
const mem = { kv: new Map(), now: () => Date.now() };
const memGet = (k, make) => {
  const e = mem.kv.get(k);
  if (e && (!e.exp || e.exp > mem.now())) return e.v;
  if (!make) return undefined;
  const v = make();
  mem.kv.set(k, { v });
  return v;
};
const memory = {
  HINCRBY: (k, f, by) => { const h = memGet(k, () => new Map()); h.set(f, (h.get(f) ?? 0) + Number(by)); return h.get(f); },
  HMGET: (k, ...fs) => { const h = memGet(k); return fs.map((f) => (h?.has(f) ? String(h.get(f)) : null)); },
  SADD: (k, m) => { const s = memGet(k, () => new Set()); const had = s.has(m); s.add(m); return had ? 0 : 1; },
  SREM: (k, m) => (memGet(k)?.delete(m) ? 1 : 0),
  LPUSH: (k, v) => memGet(k, () => []).unshift(v),
  LTRIM: (k, _a, b) => { const l = memGet(k); if (l) l.splice(Number(b) + 1); return 'OK'; },
  LRANGE: (k, a, b) => (memGet(k) ?? []).slice(Number(a), Number(b) + 1),
  LINDEX: (k, i) => (memGet(k) ?? [])[Number(i)] ?? null,
  LREM: (k, _n, v) => { const l = memGet(k) ?? []; const i = l.indexOf(v); if (i < 0) return 0; l.splice(i, 1); return 1; },
  INCR: (k) => { const e = mem.kv.get(k); const v = Number(e && (!e.exp || e.exp > mem.now()) ? e.v : 0) + 1; mem.kv.set(k, { v, exp: e?.exp }); return v; },
  GET: (k) => { const v = memGet(k); return v == null ? null : String(v); },
  SET: (k, v, ...opts) => {
    const o = opts.map(String).map((x) => x.toUpperCase());
    if (o.includes('NX') && memGet(k) !== undefined) return null;
    const ex = o.indexOf('EX');
    mem.kv.set(k, { v, exp: ex >= 0 ? mem.now() + Number(opts[ex + 1]) * 1000 : undefined });
    return 'OK';
  },
  SCARD: (k) => memGet(k)?.size ?? 0,
  HSETNX: (k, f, v) => { const h = memGet(k, () => new Map()); if (h.has(f)) return 0; h.set(f, Number(v)); return 1; },
  EXPIRE: (k, s) => { const e = mem.kv.get(k); if (e) e.exp = mem.now() + Number(s) * 1000; return e ? 1 : 0; },
  HSET: (k, f, v) => { memGet(k, () => new Map()).set(f, v); return 1; },
  ZADD: (k, score, m) => { memGet(k, () => new Map()).set(m, Number(score)); return 1; },
  ZINCRBY: (k, by, m) => { const z = memGet(k, () => new Map()); z.set(m, (z.get(m) ?? 0) + Number(by)); return String(z.get(m)); },
  ZCOUNT: (k, min, max) => [...(memGet(k) ?? new Map()).values()].filter((v) => v >= Number(min) && (max === '+inf' || v <= Number(max))).length,
  ZREMRANGEBYSCORE: (k, _min, max) => { const z = memGet(k); let n = 0; for (const [m, v] of z ?? []) if (v <= Number(max)) { z.delete(m); n++; } return n; },
  ZREVRANGE: (k, a, b) => [...(memGet(k) ?? new Map())].sort((x, y) => y[1] - x[1]).slice(Number(a), Number(b) + 1).flatMap(([m, v]) => [m, String(v)]),
  PFADD: (k, m) => memory.SADD(k, m),
  PFCOUNT: (...ks) => new Set(ks.flatMap((k) => [...(memGet(k) ?? [])])).size,
};
export const _memory = mem; // for tests

export const configured = () => Boolean(REDIS_URL && REDIS_TOKEN) || process.env.KHABAR_MEMORY_STORE === '1';

/** Run several Redis commands in one round trip; returns their results in order. */
export async function redis(...cmds) {
  if (!(REDIS_URL && REDIS_TOKEN)) return cmds.map(([c, ...args]) => memory[c](...args));
  const res = await fetch(`${REDIS_URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    // Every command used here takes a single key as its first argument.
    body: JSON.stringify(PREFIX ? cmds.map(([c, k, ...args]) => [c, PREFIX + k, ...args]) : cmds),
  });
  if (!res.ok) throw new Error(`redis ${res.status}`);
  return (await res.json()).map((r) => {
    if (r.error) throw new Error(r.error);
    return r.result;
  });
}

// ---------- http ----------
const ORIGINS = (process.env.ALLOWED_ORIGINS || '*').split(',').map((s) => s.trim());

function cors(request) {
  const origin = request.headers.get('origin');
  const allow = ORIGINS.includes('*') ? '*' : ORIGINS.includes(origin) ? origin : ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

/** JSON response. `cache` = seconds the Vercel CDN may serve it (GETs only), `stale` = how long after that it may
 *  still serve the old copy while refreshing (default 6× cache). */
export function json(request, body, { status = 200, cache = 0, stale = cache * 6 } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cache ? `public, max-age=0, s-maxage=${cache}, stale-while-revalidate=${stale}` : 'no-store',
      ...cors(request),
    },
  });
}

export const preflight = (request) => new Response(null, { status: 204, headers: cors(request) });
export const fail = (request, status, error) => json(request, { error }, { status });

export async function readBody(request) {
  try {
    const text = await request.text();
    return text.length > 8000 ? null : JSON.parse(text || '{}');
  } catch {
    return null;
  }
}

// ---------- validation & abuse limits ----------
export const hash = (s) => createHash('sha256').update(`${SALT}:${s}`).digest('hex').slice(0, 20);
export const postId = (v) => (/^\d{1,8}$/.test(String(v ?? '')) ? String(Number(v)) : null);
export const guestId = (v) => (typeof v === 'string' && /^[\w-]{16,64}$/.test(v) ? v : null);

function clientIp(request) {
  return (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || request.headers.get('x-real-ip') || 'unknown';
}

/**
 * True when any rule is over its limit. A rule is [kind, max, windowSec, who]; `who` defaults to the caller's IP.
 * Many readers share one IP (VPN exits, mobile carriers, office Wi-Fi), so tight limits are per guest and
 * per-IP ones stay loose. All counters go in one Redis round trip.
 */
export async function limited(request, ...rules) {
  const ip = hash(clientIp(request));
  const keys = rules.map(([kind, , windowSec, who = ip]) => `rl:${kind}:${who}:${Math.floor(Date.now() / 1000 / windowSec)}`);
  const res = await redis(...keys.flatMap((key, i) => [['INCR', key], ['EXPIRE', key, String(rules[i][2])]]));
  return rules.some(([, max], i) => res[i * 2] > max);
}

// ---------- gamification: server-awarded points feed a weekly leaderboard ----------
export const POINTS = { read: 1, react: 1, chat: 1, comment: 5 };
export const week = () => Math.floor((Date.now() / 864e5 + 3) / 7); // weeks since epoch, starting Monday
/** Today's date in Tehran (YYYY-MM-DD): "today" on the site is the readers' calendar day. */
export const day = (at = Date.now()) => new Date(at).toLocaleDateString('en-CA', { timeZone: 'Asia/Tehran' });

// ---------- views: like X/Twitter, a reader counts once per post (and once for the site) per 24 hours ----------
export const VIEW_WINDOW = 86_400;
/**
 * View counts for posts, from `h:uviews`. A post with no count there yet starts from the readers who ever opened it
 * (`v:<id>`): the counter before this one went up on every page load, so it can't be trusted.
 */
export async function postViews(ids) {
  if (!ids.length) return [];
  const [stored] = await redis(['HMGET', 'h:uviews', ...ids]);
  const missing = ids.filter((_, i) => stored[i] == null);
  if (!missing.length) return stored.map(Number);
  const seen = await redis(...missing.map((id) => ['SCARD', `v:${id}`]));
  await redis(...missing.map((id, i) => ['HSETNX', 'h:uviews', id, String(Number(seen[i]) || 0)]));
  return ids.map((id, i) => (stored[i] == null ? Number(seen[missing.indexOf(id)]) || 0 : Number(stored[i])));
}

export const award = (gh, points) => [['ZINCRBY', `lb:${week()}`, String(points), gh]];
/** Remember a guest's display name for the leaderboard (only when they chose one). */
export const nameCmd = (gh, name) => (name && name !== 'مهمان' ? [['HSET', 'names', gh, name]] : []);

const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F‪-‮⁦-⁩]/g;
export const cleanText = (s, max) =>
  String(s ?? '').replace(CONTROL, '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
