// Web Push without dependencies: VAPID (RFC 8292) to say who sends, and the payload encrypted for the browser
// (RFC 8291, "aes128gcm"). Keys: VAPID_PUBLIC_KEY (65-byte uncompressed P-256 point) and VAPID_PRIVATE_KEY (its 32-byte
// secret), both base64url — `node scripts/vapid.mjs` makes a pair; VAPID_SUBJECT is a mailto: or https: contact.
import { createCipheriv, createECDH, createPrivateKey, hkdfSync, randomBytes, sign } from 'node:crypto';

export const b64u = {
  encode: (buf) => Buffer.from(buf).toString('base64url'),
  decode: (s) => Buffer.from(String(s), 'base64url'),
};

/** The push services browsers use. The server only ever posts to these: a subscription is an address a stranger gives
 *  us, and anything else would let them make the site send requests wherever they like. */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /\.push\.services\.mozilla\.com$/, /^web\.push\.apple\.com$/, /\.notify\.windows\.com$/, /^push\.api\.chrome\.google\.com$/];

/** A browser's subscription, checked: an https endpoint at a known push service, and well-formed keys. */
export function validSubscription(sub) {
  try {
    const u = new URL(sub?.endpoint);
    if (u.protocol !== 'https:' || sub.endpoint.length > 1000 || !PUSH_HOSTS.some((h) => h.test(u.hostname))) return null;
    const p256dh = b64u.decode(sub.keys?.p256dh);
    const auth = b64u.decode(sub.keys?.auth);
    if (p256dh.length !== 65 || p256dh[0] !== 4 || auth.length !== 16) return null;
    return { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } };
  } catch {
    return null;
  }
}

/** An environment value as set in the dashboard: pasted keys often carry a newline or quotes, which would break the
 *  signature (a key served with a newline isn't one a browser can subscribe with either). */
export const env = (name) => (process.env[name] ?? '').trim().replace(/^(["'])(.*)\1$/, '$2');
export const vapidConfigured = () => Boolean(env('VAPID_PUBLIC_KEY') && env('VAPID_PRIVATE_KEY'));
const FALLBACK_SUBJECT = 'https://khabar-ai.vercel.app/';
/** VAPID's contact: Apple's push service turns away anything but a mailto: or https: URL (403 BadJwtToken), so a
 *  malformed one (a bare address, "mailto: x", a localhost URL) is replaced by the site's own address. */
export function vapidSubject(raw = env('VAPID_SUBJECT')) {
  const s = raw.replace(/\s+/g, '');
  if (/^mailto:[^@\s]+@[^@\s]+\.[^@\s]+$/i.test(s)) return s;
  if (/^[^@\s:/]+@[^@\s]+\.[^@\s]+$/.test(s)) return `mailto:${s}`;
  try {
    const u = new URL(s);
    if (u.protocol === 'https:' && !/^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(u.hostname)) return u.href;
  } catch {}
  return FALLBACK_SUBJECT;
}

/** `Authorization: vapid t=<JWT>, k=<public key>` for one push service (the JWT's audience is its origin). */
export function vapidHeader(endpoint, { publicKey = env('VAPID_PUBLIC_KEY'), privateKey = env('VAPID_PRIVATE_KEY'), subject = vapidSubject(), now = Date.now() } = {}) {
  const pub = b64u.decode(publicKey);
  const key = createPrivateKey({ key: { kty: 'EC', crv: 'P-256', d: privateKey, x: b64u.encode(pub.subarray(1, 33)), y: b64u.encode(pub.subarray(33, 65)) }, format: 'jwk' });
  const head = b64u.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject }));
  const sig = sign('sha256', Buffer.from(`${head}.${claims}`), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${head}.${claims}.${b64u.encode(sig)}, k=${publicKey}`;
}

const hkdf = (salt, ikm, info, length) => Buffer.from(hkdfSync('sha256', ikm, salt, info, length));

/** The body of a push message: `payload` encrypted for the subscription's keys, in one aes128gcm record (RFC 8291).
 *  `ephemeral` and `salt` are for the RFC's test vector only — normally fresh for every message. */
export function encrypt(payload, keys, { ephemeral, salt = randomBytes(16) } = {}) {
  const uaPublic = b64u.decode(keys.p256dh);
  const auth = b64u.decode(keys.auth);
  const ecdh = createECDH('prime256v1');
  if (ephemeral) ecdh.setPrivateKey(b64u.decode(ephemeral));
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const secret = ecdh.computeSecret(uaPublic);
  const ikm = hkdf(auth, secret, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32);
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  // One record, the last: the content, then the 0x02 delimiter.
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

/** Sends one message. Resolves to the push service's status: 201 delivered, 404/410 the subscription is gone. With
 *  `detail`, to { status, reason }: what the service said when it refused (Apple: {"reason":"BadJwtToken"}). */
export async function sendPush(sub, payload, { ttl = 6 * 3600, urgency = 'normal', topic, detail = false } = {}) {
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: vapidHeader(sub.endpoint),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(ttl),
      Urgency: urgency,
      // A newer message with the same topic replaces one still waiting on an offline phone.
      ...(topic && { Topic: topic }),
    },
    body: encrypt(JSON.stringify(payload), sub.keys),
    signal: AbortSignal.timeout(10_000),
  });
  if (!detail) return res.status;
  const reason = res.ok ? '' : (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 120);
  return { status: res.status, reason };
}
