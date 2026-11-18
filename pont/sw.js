// Mise en cache hors-ligne. L'application ne fait aucun appel réseau une fois
// chargée : tout le calcul est local, le cache suffit donc à la rendre pleinement
// utilisable sans connexion.
const CACHE = 'pont-v2';
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

/** Ce que l'on gère : nos propres fichiers, et rien d'autre. */
function aNous(requete) {
  if (requete.method !== 'GET') return false;
  const url = new URL(requete.url);
  if (url.origin !== self.location.origin) return false;
  // Les points d'entrée injectés par l'hébergeur ne nous appartiennent pas et
  // n'ont pas de sens hors connexion.
  return !url.pathname.startsWith('/.netlify/');
}

// Réseau d'abord, cache en secours : l'utilisateur voit toujours la dernière
// version quand il a du réseau, et l'application reste utilisable sans.
self.addEventListener('fetch', (e) => {
  if (!aNous(e.request)) return;
  e.respondWith(
    fetch(e.request)
      .then((rep) => {
        // On ne met en cache que ce qui est servi normalement : une erreur ou une
        // réponse opaque enregistrée ici resservirait une page cassée hors-ligne.
        if (rep.ok && rep.type === 'basic') {
          const copie = rep.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copie)).catch(() => {});
        }
        return rep;
      })
      .catch(async () => {
        const enCache = await caches.match(e.request);
        if (enCache) return enCache;
        // Repli sur la page d'accueil uniquement pour une navigation : la servir
        // en réponse à un script ou une feuille de style produirait une erreur
        // de syntaxe au lieu d'un échec propre.
        if (e.request.mode === 'navigate') {
          const accueil = await caches.match('index.html');
          if (accueil) return accueil;
        }
        return Response.error();
      }),
  );
});
