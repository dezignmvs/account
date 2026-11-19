const CACHE_NAME = 'khataflow-shell-v1';
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/assets/icons/icon.svg',
  '/assets/logo/logo.svg',
  '/css/style.css',
  '/css/dashboard.css',
  '/css/components.css',
  '/css/responsive.css',
  '/css/print.css',
  '/js/firebase-config.js',
  '/js/firebase.js',
  '/js/utilities.js',
  '/js/database.js',
  '/js/auth.js',
  '/js/router.js',
  '/js/app.js',
  '/js/dashboard.js',
  '/js/parties.js',
  '/js/ledger.js',
  '/js/products.js',
  '/js/inventory.js',
  '/js/sales.js',
  '/js/purchases.js',
  '/js/payments.js',
  '/js/expenses.js',
  '/js/gst.js',
  '/js/reports.js',
  '/js/staff.js',
  '/js/notifications.js',
  '/js/settings.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Let Firebase / Google APIs go directly to network (Firestore handles its own IndexedDB offline cache)
  if (
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('gstatic.com') ||
    url.hostname.includes('firebaseapp.com') ||
    url.hostname.includes('firebasestorage.app')
  ) {
    return;
  }

  // Navigation requests: network-first, fallback to cached index.html
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Static app shell: stale-while-revalidate
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const networkFetch = fetch(request)
          .then((response) => {
            if (response && response.status === 200) {
              const copy = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
            }
            return response;
          })
          .catch(() => cached);
        return cached || networkFetch;
      })
    );
  }
});
