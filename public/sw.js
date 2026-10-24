// Offline-friendly caching for unstable connections.
// Pages: network first (fresh news), fall back to cache. Static assets & media: cache first.
const VERSION = 'v1';
const PAGES = `pages-${VERSION}`;
const ASSETS = `assets-${VERSION}`;
const MEDIA = `media-${VERSION}`;
const SCOPE = new URL(self.registration.scope).pathname;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(PAGES).then((c) => c.addAll([SCOPE])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => ![PAGES, ASSETS, MEDIA].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

async function networkFirst(req) {
  const cache = await caches.open(PAGES);
  try {
    const res = await Promise.race([fetch(req), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 6000))]);
    if (res.ok) {
      cache.put(req, res.clone());
      trim(PAGES, 150);
    }
    return res;
  } catch {
    return (await cache.match(req)) || (await cache.match(SCOPE)) || Response.error();
  }
}

async function cacheFirst(req, name, max) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && res.status === 200) {
    cache.put(req, res.clone());
    trim(name, max);
  }
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const u = new URL(req.url);
  if (req.method !== 'GET' || u.origin !== location.origin || req.headers.has('range')) return;
  if (req.mode === 'navigate') return e.respondWith(networkFirst(req));
  if (u.pathname.includes('/_astro/')) return e.respondWith(cacheFirst(req, ASSETS, 120));
  if (u.pathname.includes('/media/') && !u.pathname.endsWith('.mp4')) return e.respondWith(cacheFirst(req, MEDIA, 300));
});
