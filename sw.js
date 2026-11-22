// Offline cache: the whole game is a handful of static files.
// Bump VERSION whenever any file changes so phones pick up the update.
const VERSION = 'arterial-v1';
const FILES = ['./', 'index.html', 'style.css', 'manifest.webmanifest', 'js/main.js', 'js/game.js', 'js/render.js',
  'js/maps.js', 'js/rng.js', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))));
  self.clients.claim();
});
// Network first, so updates arrive when online; the cache serves when offline.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).then((r) => {
    const copy = r.clone();
    caches.open(VERSION).then((c) => c.put(e.request, copy));
    return r;
  }).catch(() => caches.match(e.request)));
});
