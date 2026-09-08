// FitTrack Service Worker — runtime caching (no build-time precache)
const CACHE_NAME = 'fittrack-v4';
const OFFLINE_URL = '/fittrack';

// ── §3.8 Web Push ─────────────────────────────────────────────────────────
// Payload sent by the backend: {type, title, body, link, notification_id}.

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // Malformed payload — still show something rather than drop silently.
    data = { title: 'FitTrack', body: '' };
  }
  const title = data.title || 'FitTrack';
  const link = typeof data.link === 'string' && data.link.startsWith('/') ? data.link : '';
  const options = {
    body: data.body || '',
    icon: '/fittrack/icons/icon-192.png',
    badge: '/fittrack/icons/icon-192.png',
    tag: data.notification_id || undefined,
    // In-app links are app paths (e.g. "/lifting") — open under the /fittrack base.
    data: { url: link ? `/fittrack${link}` : '/fittrack' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  const notification = event.notification;
  const target = (notification.data && notification.data.url) || '/fittrack';
  notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(target);
      }
    })
  );
});

// Install: cache the app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.add(OFFLINE_URL))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: strategy per request type
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and non-same-origin (except CDN assets)
  if (request.method !== 'GET') return;

  // Skip NextAuth routes — never cache auth flows
  if (url.pathname.includes('/api/auth')) return;

  // Navigation: network-first, fallback to cached shell
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match(OFFLINE_URL) || fetch(request))
    );
    return;
  }

  // Static assets (_next/static, icons): stale-while-revalidate
  if (url.pathname.startsWith('/fittrack/_next/static/') || url.pathname.startsWith('/fittrack/icons/')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const fetchPromise = fetch(request).then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        });
        return cached || fetchPromise;
      })
    );
    return;
  }

  // API GETs: network-only (never cache API responses — auth tokens vary per user)
  if (url.pathname.startsWith('/fittrack/api/v1/') || url.pathname.includes('/api/v1/')) {
    event.respondWith(
      fetch(request).catch(() => new Response(null, { status: 503 }))
    );
    return;
  }

  // Everything else: network-first
  event.respondWith(
    fetch(request).catch(() => caches.match(request).then((cached) => cached || new Response(null, { status: 503 })))
  );
});
