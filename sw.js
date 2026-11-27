/* TQI Charts Service Worker: Netzwerk zuerst (immer aktuell), Cache nur als Offline-Rückfall. Börsendaten werden nie abgefangen. */
const C = 'tqi-charts-v5';
self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== self.location.origin) return;
  // immer beim Server nachfragen (304, wenn unverändert): nach einem Update keine Mischung aus alten und neuen Dateien
  e.respondWith(fetch(u.href, { cache: 'no-cache', credentials: 'same-origin' }).then(r => { if (r && r.ok) { const cp = r.clone(); caches.open(C).then(c => c.put(e.request, cp)); } return r; })
    .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html'))));
});
