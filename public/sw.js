const CACHE_NAME = 'omnidoc-mobile-pwa-v1';
const APP_SHELL_URLS = ['/', '/index.html', '/manifest.webmanifest', '/apple-touch-icon.png', '/pwa-192.png', '/pwa-512.png', '/favicon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Never intercept or cache authenticated backend API calls or cross-origin requests
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname === '/health') {
    return;
  }

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok && (url.pathname.startsWith('/assets/') || APP_SHELL_URLS.includes(url.pathname))) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        if (req.mode === 'navigate') {
          const shell = await caches.match('/index.html');
          if (shell) return shell;
        }
        throw new Error('Network unavailable');
      })
  );
});
