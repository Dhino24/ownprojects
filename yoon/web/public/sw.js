// Service worker minimal : met en cache l'interface pour l'ouvrir sur un réseau faible.
// L'API (/api) n'est JAMAIS mise en cache : une action sensible doit toujours être confirmée par le serveur.
const CACHE = 'yoon-shell-v1';
const SHELL = ['/', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (e.request.mode === 'navigate') {
    // Réseau d'abord, page en cache si hors connexion.
    e.respondWith(fetch(e.request).then((r) => {
      const copy = r.clone();
      caches.open(CACHE).then((c) => c.put('/', copy));
      return r;
    }).catch(() => caches.match('/')));
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
    // Fichiers versionnés : cache d'abord.
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => {
      const copy = r.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return r;
    })));
  }
});
