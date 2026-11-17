/* FORM CLUB V9 service worker. Scope: /v9/ only, so V7/V8 pages are never intercepted.
   - App shell is precached; pages are network-first with an offline fallback.
   - Static V9 files use stale-while-revalidate.
   - /api/ requests are never cached: QR tokens, notifications and reports are personal and short-lived. */
const VERSION = 'v9.0.4';
const PREFIX = 'formclub-v9-';
const SHELL = PREFIX + 'shell-' + VERSION;
const RUNTIME = PREFIX + 'runtime-' + VERSION;
const SHELL_FILES = [
  '/v9/index.html',
  '/v9/v9.css',
  '/v9/v9-core.js',
  '/v9/v9.js',
  '/v9/manifest.webmanifest',
  '/v9/vendor/qrcode.js',
  '/v9/vendor/jsQR.js',
  '/v9/icons/icon.svg',
  '/v9/icons/icon-192.png',
  '/v9/icons/apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL).then(cache => cache.addAll(SHELL_FILES)));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith(PREFIX) && k !== SHELL && k !== RUNTIME).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// The page asks the waiting worker to take over after the user accepts the update banner.
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    if (!url.pathname.startsWith('/v9/')) return;
    event.respondWith((async () => {
      try {
        // The static server has no directory index, so /v9/ is served as /v9/index.html.
        const response = await fetch(url.pathname === '/v9/' ? '/v9/index.html' : request);
        if (response.ok) return response;
        throw Error('HTTP ' + response.status);
      } catch {
        return (await caches.match('/v9/index.html')) || new Response('<h1>Çevrimdışı</h1><p>FORM CLUB açılamadı.</p>', { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
    })());
    return;
  }

  if (!SHELL_FILES.includes(url.pathname) || url.search) return;
  event.respondWith((async () => {
    const cached = await caches.match(request, { ignoreSearch: true });
    const network = fetch(request).then(async response => {
      if (response.ok && !/no-store|private/i.test(response.headers.get('Cache-Control') || '')) {
        const cache = await caches.open(SHELL_FILES.includes(url.pathname) ? SHELL : RUNTIME);
        await cache.put(request, response.clone());
      }
      return response;
    });
    if (cached) { event.waitUntil(network.catch(() => {})); return cached; }
    return network;
  })());
});
