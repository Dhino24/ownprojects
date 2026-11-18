// Mise en cache hors-ligne. L'application ne fait aucun appel réseau une fois chargée :
// tout le calcul est local, le cache suffit donc à la rendre pleinement utilisable
// sans connexion.
const CACHE = 'pont-v1';
const FICHIERS = [
  '.', 'index.html', 'styles.css', 'manifest.webmanifest',
  'src/app.js', 'src/engine.js', 'src/holidays.js', 'src/dates.js', 'src/ics.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(FICHIERS))
      .then(() => self.skipWaiting())
      .catch(() => { /* un fichier manquant ne doit pas bloquer l'installation */ }),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((cles) => Promise.all(cles.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Réseau d'abord, cache en secours : l'utilisateur voit toujours la dernière version
// quand il a du réseau, et l'application reste utilisable quand il n'en a pas.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((rep) => {
        const copie = rep.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copie)).catch(() => {});
        return rep;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('index.html'))),
  );
});
