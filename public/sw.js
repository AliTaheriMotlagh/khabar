// Offline reading on unstable connections.
// Pages: network first (fresh news), then the cached copy, then the offline page.
// Site assets: cache first. Images from Telegram/X: cache first, so pages you read stay complete offline.
// Never cached: the live API (/api/) and videos (too big, and ranged requests).
const VERSION = 'v2';
const PAGES = 'pages-v2'; // also used by src/scripts/core.ts to keep saved stories offline
const ASSETS = `assets-${VERSION}`;
const IMAGES = `images-${VERSION}`;
const SCOPE = new URL(self.registration.scope).pathname;
const OFFLINE = `${SCOPE}offline/`;
const IMAGE_HOSTS = /(^|\.)(twimg\.com|telesco\.pe|ytimg\.com)$/;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(PAGES).then((c) => c.addAll([SCOPE, OFFLINE])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => ![PAGES, ASSETS, IMAGES].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function trim(name, max) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

async function networkFirst(req) {
  const cache = await caches.open(PAGES);
  try {
    const res = await Promise.race([fetch(req), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 6000))]);
    if (res.ok) {
      cache.put(req, res.clone());
      trim(PAGES, 250);
    }
    return res;
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

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const u = new URL(req.url);
  if (u.origin === location.origin) {
    if (u.pathname.includes('/api/')) return;
    if (req.mode === 'navigate') return e.respondWith(networkFirst(req));
    if (u.pathname.includes('/_astro/') || u.pathname.includes('/pagefind/')) return e.respondWith(cacheFirst(req, ASSETS, 200));
    return;
  }
  if (req.destination === 'image' && IMAGE_HOSTS.test(u.hostname)) e.respondWith(cacheFirst(req, IMAGES, 400).catch(() => Response.error()));
});
