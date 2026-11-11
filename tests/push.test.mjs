// Notifications: encryption against RFC 8291's own example, VAPID signatures, and api/push.js end to end with the push
// services faked (each message is decrypted the way the browser does). node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDecipheriv, createECDH, createPublicKey, hkdfSync, verify } from 'node:crypto';

process.env.KHABAR_MEMORY_STORE = '1';
const server = createECDH('prime256v1');
server.generateKeys();
process.env.VAPID_PUBLIC_KEY = server.getPublicKey().toString('base64url');
process.env.VAPID_PRIVATE_KEY = server.getPrivateKey().toString('base64url');
process.env.VAPID_SUBJECT = 'mailto:test@example.com';
process.env.PUSH_SECRET = 'push-secret';
process.env.SITE_URL = 'https://site.test';
const { b64u, encrypt, validSubscription, vapidHeader } = await import('../api/_push.js');
const push = await import('../api/push.js');

/** A browser: its keys, a subscription, and how it reads a message (RFC 8291, the receiving side). */
function browser(endpoint) {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = Buffer.from('0123456789abcdef');
  const sub = { endpoint, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } };
  const read = (body) => {
    const salt = body.subarray(0, 16);
    const idlen = body[20];
    const asPublic = body.subarray(21, 21 + idlen);
    const hk = (s, ikm, info, n) => Buffer.from(hkdfSync('sha256', ikm, s, info, n));
    const ikm = hk(auth, ecdh.computeSecret(asPublic), Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), asPublic]), 32);
    const d = createDecipheriv('aes-128-gcm', hk(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16), hk(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12));
    const data = body.subarray(21 + idlen);
    d.setAuthTag(data.subarray(-16));
    const plain = Buffer.concat([d.update(data.subarray(0, -16)), d.final()]);
    assert.equal(plain.at(-1), 2, 'last record delimiter');
    return JSON.parse(plain.subarray(0, -1).toString());
  };
  return { sub, read };
}

test('push: encryption matches RFC 8291 Appendix A', () => {
  const out = encrypt(
    b64u.decode('V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24'),
    { p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' },
    { ephemeral: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', salt: b64u.decode('DGv6ra1nlYgDCS1FRnbzlw') },
  );
  assert.equal(
    b64u.encode(out),
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
  );
});

test('push: a VAPID header the push service can verify', () => {
  const h = vapidHeader('https://fcm.googleapis.com/fcm/send/abc', { now: 1_700_000_000_000 });
  const [, jwt, k] = h.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(k, process.env.VAPID_PUBLIC_KEY);
  const [head, claims, sig] = jwt.split('.');
  const c = JSON.parse(b64u.decode(claims).toString());
  assert.deepEqual(c, { aud: 'https://fcm.googleapis.com', exp: 1_700_000_000 + 12 * 3600, sub: 'mailto:test@example.com' });
  const pub = b64u.decode(k);
  const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u.encode(pub.subarray(1, 33)), y: b64u.encode(pub.subarray(33)) }, format: 'jwk' });
  assert.ok(verify('sha256', Buffer.from(`${head}.${claims}`), { key, dsaEncoding: 'ieee-p1363' }, b64u.decode(sig)));
});

test('push: only known push services, well-formed keys', () => {
  const { sub } = browser('https://fcm.googleapis.com/fcm/send/x');
  assert.ok(validSubscription(sub));
  assert.ok(validSubscription({ ...sub, endpoint: 'https://web.push.apple.com/abc' }));
  assert.equal(validSubscription({ ...sub, endpoint: 'https://evil.example/hook' }), null);
  assert.equal(validSubscription({ ...sub, endpoint: 'http://fcm.googleapis.com/x' }), null);
  assert.equal(validSubscription({ ...sub, keys: { ...sub.keys, auth: 'short' } }), null);
});

let ip = 0;
const call = async (fn, body, headers = {}) => {
  const res = await fn(new Request('https://site.test/api/push/', { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.1.0.${++ip}`, ...headers }, body: body ? JSON.stringify(body) : undefined }));
  return { status: res.status, body: await res.json() };
};

test('push: subscribe, then each new story announced once, to whom it concerns', async () => {
  assert.equal((await call(push.GET)).body.key, process.env.VAPID_PUBLIC_KEY);
  const all = browser('https://fcm.googleapis.com/fcm/send/all');
  const topics = browser('https://updates.push.services.mozilla.com/wpush/v2/topics');
  const daily = browser('https://web.push.apple.com/daily');
  const gone = browser('https://fcm.googleapis.com/fcm/send/gone');
  const guest = 'guest-pppppppppppppppp';
  for (const [b, mode, t] of [[all, 'all'], [topics, 'topics', ['رباتیک']], [daily, 'daily'], [gone, 'all']]) {
    assert.equal((await call(push.POST, { action: 'subscribe', guest, sub: b.sub, mode, topics: t })).status, 200);
  }
  assert.equal((await call(push.POST, { action: 'subscribe', guest, sub: { ...all.sub, endpoint: 'https://evil.example/x' } })).status, 400);

  const delivered = new Map();
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.match(init.headers.Authorization, /^vapid t=/);
    assert.equal(init.headers['Content-Encoding'], 'aes128gcm');
    if (url.endsWith('/gone')) return new Response(null, { status: 410 });
    delivered.set(url, init.body);
    return new Response(null, { status: 201 });
  };
  try {
    const story = { id: 900, title: 'ربات تازه', tags: ['رباتیک'], kind: 'story' };
    const other = { id: 901, title: 'تراشه‌ی تازه', tags: ['تراشه'], kind: 'story' };
    const digest = { id: 902, title: 'خلاصه‌ی امروز', tags: [], kind: 'digest' };
    const send = (posts, auth = 'Bearer push-secret') => call(push.POST, { action: 'send', posts }, { authorization: auth });
    assert.equal((await send([story], 'Bearer wrong')).status, 401);
    // The first call only records what is out already.
    assert.equal((await send([{ id: 800, title: 'قدیمی', tags: [], kind: 'story' }])).body.seeded, 1);
    assert.equal(delivered.size, 0);

    const r = await send([story, other, digest]);
    assert.deepEqual({ sent: r.body.sent, removed: r.body.removed, posts: r.body.posts }, { sent: 3, removed: 1, posts: 3 });
    const toAll = all.read(delivered.get(all.sub.endpoint));
    assert.equal(toAll.title, '۳ خبر تازه در فیوچر فوکوس');
    assert.equal(toAll.url, 'https://site.test/');
    const toTopics = topics.read(delivered.get(topics.sub.endpoint));
    assert.deepEqual(toTopics, { title: 'ربات تازه', body: 'رباتیک · فیوچر فوکوس', url: 'https://site.test/p/900/', tag: 'news' });
    assert.equal(daily.read(delivered.get(daily.sub.endpoint)).url, 'https://site.test/p/902/');

    // Announced once: the same stories again send nothing; the gone subscription was dropped.
    delivered.clear();
    const again = await send([story, other, digest]);
    assert.equal(again.body.sent, 0);
    assert.equal(delivered.size, 0);
    const later = await send([{ id: 903, title: 'یکی دیگر', tags: [], kind: 'story' }]);
    assert.equal(later.body.subscribers, 3, 'the 410 one is gone');

    // Unsubscribe, and the browser's replacement subscription keeps the reader's choice.
    const renewed = browser('https://updates.push.services.mozilla.com/wpush/v2/renewed');
    assert.equal((await call(push.POST, { action: 'renew', old: topics.sub.endpoint, sub: renewed.sub })).status, 200);
    assert.equal((await call(push.POST, { action: 'unsubscribe', endpoint: all.sub.endpoint })).status, 200);
    delivered.clear();
    await send([{ id: 904, title: 'ربات دوم', tags: ['رباتیک'], kind: 'story' }]);
    assert.deepEqual([...delivered.keys()], [renewed.sub.endpoint]);
  } finally {
    globalThis.fetch = real;
  }
});
