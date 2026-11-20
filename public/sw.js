const CACHE_NAME = 'prime-tracker-v19';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './logo.png',
  './icon.svg',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        ASSETS.map((url) =>
          fetch(url, { cache: 'no-store' }).then((res) => {
            if (res && res.ok) return cache.put(url, res);
          }).catch(() => {})
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.map((k) => {
        if (k !== CACHE_NAME && k !== 'carto-dark-tiles') return caches.delete(k);
      })
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;

  // Never intercept Firebase Firestore API calls
  if (url.hostname.includes('googleapis.com') || url.hostname.includes('firebase')) {
    return;
  }

  // Cache map tiles for fast outdoor rendering
  if (url.hostname.includes('basemaps.cartocdn.com')) {
    e.respondWith(
      caches.open('carto-dark-tiles').then(async (cache) => {
        const cached = await cache.match(e.request);
        if (cached) return cached;
        try {
          const netRes = await fetch(e.request);
          if (netRes && (netRes.status === 200 || netRes.type === 'opaque')) {
            cache.put(e.request, netRes.clone());
          }
          return netRes;
        } catch (_) {
          return cached || Response.error();
        }
      })
    );
    return;
  }

  // Network-first with no-store for HTML navigation (LoveDater pattern: never serves stale app shell)
  if (e.request.mode === 'navigate' || e.request.destination === 'document') {
    e.respondWith(
      fetch(e.request, { cache: 'no-store' })
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
          return response;
        })
        .catch(() => caches.match(e.request, { ignoreSearch: true }) || caches.match('./index.html'))
    );
    return;
  }

  // Network-first for JS/CSS assets with fallback to cache
  e.respondWith(
    fetch(e.request)
      .then((response) => {
        if (response && response.status === 200 && url.origin === self.location.origin) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
