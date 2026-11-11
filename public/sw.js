// Offline reading on unstable connections.
// Pages: network first (fresh news), then the cached copy, then the offline page.
// Site assets: cache first. Images from Telegram/X: cache first, so pages you read stay complete offline.
// Pictures relayed by the site (/api/img/) count as images. Never cached: the rest of the live API (/api/) and videos
// (too big, and ranged requests).
const VERSION = 'v2';
const PAGES = 'pages-v2'; // also used by src/scripts/core.ts to keep saved stories offline
const ASSETS = `assets-${VERSION}`;
const IMAGES = `images-${VERSION}`;
const SCOPE = new URL(self.registration.scope).pathname;
const OFFLINE = `${SCOPE}offline/`;
const VOICE = 'voice-v1'; // the downloaded Persian voice (src/scripts/voice.ts): never cleared here
const AUDIO = 'audio-v1'; // saved stories' sound for listening offline (src/scripts/offline-audio.ts): never cleared here
const IMAGE_HOSTS = /(^|\.)(twimg\.com|telesco\.pe|ytimg\.com|wsrv\.nl)$/; // wsrv.nl: the image proxy (src/lib/posts.ts)

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(PAGES).then((c) => c.addAll([SCOPE, OFFLINE])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => ![PAGES, ASSETS, IMAGES, VOICE, AUDIO].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function trim(name, max) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

async function networkFirst(req, event) {
  const cache = await caches.open(PAGES);
  // Cache the fresh page even when it arrives after the timeout, so a slow connection gets today's news on the next
  // visit instead of the same stale copy again and again.
  const fresh = fetch(req).then((res) => {
    if (res.ok) {
      cache.put(req, res.clone());
      trim(PAGES, 250);
    }
    return res;
  });
  event.waitUntil(fresh.catch(() => {}));
  try {
    return await Promise.race([fresh, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 6000))]);
  } catch {
    return (await cache.match(req, { ignoreSearch: true })) || (await cache.match(OFFLINE)) || Response.error();
  }
}

async function cacheFirst(req, name, max) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  // Cross-origin images come back opaque (status 0); they are still safe to replay into an <img>.
  if (res.ok || res.type === 'opaque') {
    cache.put(req, res.clone());
    trim(name, max);
  }
  return res;
}

// Cross-origin images are opaque, so a failed one can land in the cache; the page asks to drop it before a retry.
self.addEventListener('message', (e) => {
  if (typeof e.data?.evict === 'string') e.waitUntil(caches.open(IMAGES).then((c) => c.delete(e.data.evict)));
});

/** A kept clip of the cloud voice (the page asks with &off=1 only for those): the whole file, or the bytes an audio
 *  element asks for — it asks in ranges, and Safari only plays a ranged answer. Not kept after all: the network. */
async function keptAudio(req, u) {
  const key = `${self.location.origin}${SCOPE}offline-audio/tts/${u.searchParams.get('id')}/${u.searchParams.get('i')}`;
  const hit = await caches.match(key, { cacheName: AUDIO });
  if (!hit) {
    u.searchParams.delete('off');
    return fetch(u.href, { headers: req.headers.has('range') ? { range: req.headers.get('range') } : {} });
  }
  const range = req.headers.get('range');
  if (!range) return hit;
  const buf = await hit.arrayBuffer();
  const size = buf.byteLength;
  const m = /bytes=(\d*)-(\d*)/.exec(range);
  let start = m?.[1] ? Number(m[1]) : 0;
  let end = m?.[2] ? Number(m[2]) : size - 1;
  if (m && !m[1] && m[2]) [start, end] = [Math.max(0, size - Number(m[2])), size - 1]; // the last N bytes
  end = Math.min(end, size - 1);
  if (!m || start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    headers: { 'Content-Type': hit.headers.get('Content-Type') || 'audio/mpeg', 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes' },
  });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  // The cloud voice lives on the site's API, which on the mirror is another origin.
  if (u.pathname.endsWith('/api/tts/') && u.searchParams.get('off') === '1') return e.respondWith(keptAudio(req, u).catch(() => Response.error()));
  if (req.headers.has('range')) return;
  if (u.origin === location.origin) {
    if (u.pathname.includes('/api/img/')) return e.respondWith(cacheFirst(req, IMAGES, 400).catch(() => Response.error()));
    if (u.pathname.includes('/api/')) return;
    if (req.mode === 'navigate') return e.respondWith(networkFirst(req, e));
    if (u.pathname.includes('/_astro/') || u.pathname.includes('/pagefind/')) return e.respondWith(cacheFirst(req, ASSETS, 200));
    return;
  }
  if (req.destination === 'image' && IMAGE_HOSTS.test(u.hostname)) e.respondWith(cacheFirst(req, IMAGES, 400).catch(() => Response.error()));
});

// ---------- notifications (server/push.js, src/scripts/notify.ts) ----------
self.addEventListener('push', (e) => {
  let m = {};
  try {
    m = e.data?.json() ?? {};
  } catch {}
  const title = m.title || 'خبر تازه';
  e.waitUntil(
    self.registration.showNotification(title, {
      body: m.body || '',
      icon: `${SCOPE}icon-192.png`,
      badge: `${SCOPE}icon-192.png`,
      dir: 'rtl',
      lang: 'fa',
      tag: m.tag || 'news',
      renotify: true,
      data: { url: m.url || SCOPE },
    }),
  );
});

// A tap opens the story: in a tab of the site that is already open, if there is one.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = e.notification.data?.url || SCOPE;
  e.waitUntil(
    (async () => {
      const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const same = tabs.find((c) => c.url === url);
      if (same) return same.focus();
      const tab = tabs.find((c) => new URL(c.url).origin === new URL(url).origin && 'navigate' in c);
      if (tab) return tab.navigate(url).then((c) => (c || tab).focus());
      return self.clients.openWindow(url);
    })(),
  );
});

// The browser replaced the subscription (keys rotated, or it expired): subscribe again and tell the server, so the
// reader's choice (all news, their topics, or the daily summary) carries over. The mirror has no API of its own.
self.addEventListener('pushsubscriptionchange', (e) => {
  e.waitUntil(
    (async () => {
      const old = e.oldSubscription;
      const sub = e.newSubscription || (old && (await self.registration.pushManager.subscribe(old.options)));
      if (!old || !sub) return;
      const body = JSON.stringify({ action: 'renew', old: old.endpoint, sub: sub.toJSON() });
      for (const api of [`${SCOPE}api/push/`, 'https://khabar-ai.vercel.app/api/push/']) {
        const res = await fetch(api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }).catch(() => null);
        if (res?.ok) return;
      }
    })(),
  );
});
