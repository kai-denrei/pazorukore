// sw.js — PazoruKore service worker (hand-rolled; no Workbox, to keep the no-build discipline).
// Strategy (per the mobile-pwa resource matrix, tuned for a static ES-module app + a no-store dev server):
//   • navigations      → NetworkFirst, fall back to cached index, then offline.html
//   • same-origin JS/CSS/JSON → NetworkFirst (fresh when online; the cache is the offline fallback)
//   • Google Fonts     → CacheFirst (rarely change; 1-year-ish via the runtime cache)
// NetworkFirst keeps active development fresh (network wins when online) while still working offline.
// We do NOT skipWaiting unconditionally — the page shows an update toast and posts SKIP_WAITING on consent.

const VERSION = 'pk-92dbe33e';           // bumped per build by scripts/bust.sh → a new build installs a
                                         // fresh SW and drops all old caches on activate (so the offline
                                         // shell never goes stale). The hex suffix is the cache-bust token.
const SHELL = `${VERSION}-shell`;
const RUNTIME = `${VERSION}-runtime`;

// minimal app shell — fast install. The module graph is runtime-cached on first online use.
const SHELL_ASSETS = [
  './', './index.html', './styles.css', './offline.html', './manifest.json',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    await Promise.allSettled(SHELL_ASSETS.map((u) => c.add(new Request(u, { cache: 'reload' }))));
    // stay in "waiting" until the page asks us to take over (consent-gated update)
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    if (self.registration.navigationPreload) { try { await self.registration.navigationPreload.enable(); } catch (_) {} }
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin !== location.origin) {
    if (/fonts\.(googleapis|gstatic)\.com$/.test(url.host)) e.respondWith(cacheFirst(req, RUNTIME));
    return; // other cross-origin: let the network handle it
  }
  if (req.mode === 'navigate') { e.respondWith(navigateFirst(e)); return; }
  e.respondWith(networkFirst(req, RUNTIME));
});

async function navigateFirst(e) {
  try {
    const preload = await e.preloadResponse;
    if (preload) { putCache(SHELL, e.request, preload.clone()); return preload; }
    const net = await fetch(e.request);
    putCache(SHELL, e.request, net.clone());
    return net;
  } catch (_) {
    const shell = await caches.open(SHELL);
    return (await shell.match(e.request)) || (await shell.match('./index.html')) ||
           (await shell.match('./offline.html')) || new Response('offline', { status: 503 });
  }
}

async function networkFirst(req, cacheName) {
  try {
    const net = await fetch(req);
    putCache(cacheName, req, net.clone());
    return net;
  } catch (_) {
    const runtime = await caches.open(cacheName);
    const hit = await runtime.match(req);
    if (hit) return hit;
    const shell = await caches.open(SHELL);
    return (await shell.match(req)) || new Response('offline', { status: 503 });
  }
}

async function cacheFirst(req, cacheName) {
  const c = await caches.open(cacheName);
  const hit = await c.match(req);
  if (hit) return hit;
  try {
    const net = await fetch(req);
    if (net && (net.ok || net.type === 'opaque')) c.put(req, net.clone());
    return net;
  } catch (_) { return hit || new Response('', { status: 504 }); }
}

async function putCache(name, req, res) {
  try { if (res && (res.ok || res.type === 'opaque')) { const c = await caches.open(name); await c.put(req, res); } } catch (_) {}
}
