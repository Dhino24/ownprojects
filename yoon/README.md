# Yoon — livraison à moto, région de Dakar (pilote)

Application web installable (PWA) pour les quatre profils du MVP : **commerçant**, **client**, **livreur**, **admin**.
« Yoon » est un nom provisoire (`APP_NAME`). Le brief complet est dans [`CLAUDE.md`](CLAUDE.md), les références dans [`docs/reference/`](docs/reference/).

- Monolithe TypeScript : API **Fastify 5** + **PostgreSQL 16** (migrations SQL), interface **React 19 + Vite**, carte **Leaflet / OpenStreetMap**.
- Fonctionne sans aucune API externe : WhatsApp en **mode manuel** (messages préremplis envoyés par un humain) et paiements Wave / Orange Money **vérifiés à la main**.
- Architecture, règles et décisions : [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Mise en production : [`docs/PRODUCTION.md`](docs/PRODUCTION.md). Avancement : [`STATUS.md`](STATUS.md).

## Prérequis

- Node.js ≥ 22, npm ≥ 10
- PostgreSQL ≥ 14 (testé avec 16)

## Installation

```bash
cd yoon
npm ci
cp .env.example .env            # puis ajuster DATABASE_URL ; APP_SECRET obligatoire en production
createuser -P yoon && createdb -O yoon yoon && createdb -O yoon yoon_test   # exemple local
npm run migrate                 # applique server/migrations/*.sql (idempotent)
```

Les variables sont lues depuis l'environnement (aucun fichier `.env` n'est chargé automatiquement en production) ; en local : `set -a; . ./.env; set +a`.

## Démarrage en développement

```bash
npm run seed:demo   # données de DÉMONSTRATION (refusé si NODE_ENV=production)
DEMO_MODE=true npm run dev      # API sur :8787, interface sur http://localhost:5173 (proxy /api)
```

Comptes locaux créés par le seed (mot de passe `yoon-demo-2026`, **uniquement en local**) :

| Profil | Téléphone |
| --- | --- |
| Admin | 77 000 00 01 |
| Commerçant (Boutique Adama) | 77 000 00 10 |
| Commerçant (Chez Khady) | 77 000 00 11 |
| Livreur validé | 77 000 00 20 · 77 000 00 21 |
| Livreur à valider | 77 000 00 22 |

Le client n'a pas de compte : il ouvre le lien `…/c#jeton` reçu sur WhatsApp. En local, ce lien est visible sur la fiche de la livraison côté commerçant (bouton « Ouvrir WhatsApp »).

## Tests

```bash
npm test            # vitest : base yoon_test réinitialisée (TEST_DATABASE_URL pour une autre base)
npm run typecheck   # TypeScript serveur + interface
npm run build       # typecheck + build interface (dist-web) + build serveur (dist-server)
```

Les tests couvrent le parcours complet (création → position → offre → acceptation → retrait → code → paiements séparés → gain → reversement) et : cloisonnement entre boutiques et clients, liens révoqués/expirés, double acceptation, offre expirée et tâche rejouée, mauvais code / blocage / réutilisation, preuve photo contrôlée, client introuvable, justificatif ≠ payé, montant imposé par le serveur, référence réutilisée, payeur commerçant vs client, annulation avant/après attribution, prix figé et versions, absence de GPS, photo invalide, médias non autorisés, idempotence (reprise réseau), récap rejoué, origine refusée, persistance après redémarrage.

### Vérification visuelle (navigateur réel)

```bash
npm run build && npm run seed:demo
SERVE_WEB=true DEMO_MODE=true PUBLIC_URL=http://localhost:8787 npm start &
BASE=http://localhost:8787 npm run screens     # nécessite Playwright (npm i -D playwright si absent)
```

Le script joue le parcours complet dans Chromium (GPS simulé), puis capture chaque écran à 360, 390 et 1440 px dans `screens/` et échoue en cas de débordement horizontal ou d'erreur JavaScript. Il suppose une base de démo fraîche.

## Tester en ligne (Render, gratuit)

Le fichier [`render.yaml`](../render.yaml) à la racine du dépôt décrit un environnement de **test** (mode démo, données fictives) : un service web Node + une base PostgreSQL gratuite.

1. Sur [render.com](https://render.com), se connecter avec GitHub.
2. **New › Blueprint**, choisir ce dépôt et la branche contenant Yoon, puis **Apply**.
3. Attendre la fin du build (5 à 10 min), puis ouvrir l'URL `https://yoon-demo-….onrender.com`.

Les comptes de démo ci-dessus fonctionnent. Limites de l'offre gratuite : le service s'endort après 15 min sans visite (premier chargement ≈ 1 min), les fichiers déposés sont perdus à chaque redémarrage, la base gratuite expire après 30 jours. Ce n'est pas une configuration de production.

## Variables d'environnement

Voir [`.env.example`](.env.example) (commenté). Principales : `DATABASE_URL`, `PUBLIC_URL` (liens clients + contrôle d'origine), `APP_SECRET` (chiffrement des codes, signatures des URL de médias), `STORAGE_DIR`, `OFFER_TTL_SECONDS` (30), `CODE_MAX_ATTEMPTS` (5), `CODE_TTL_HOURS`, `CLIENT_LINK_TTL_HOURS`, `RECAP_HOUR_DAKAR`, `MEDIA_RETENTION_DAYS`, `DEMO_MODE`, `SERVE_WEB`, `TRUST_PROXY`, `VITE_MAP_TILE_URL`.

## Fournisseurs (adaptateurs `server/adapters/`)

| Brique | État | Remarque |
| --- | --- | --- |
| WhatsApp | **Manuel** (actif) | Lien `wa.me` prérempli ; « ouvert » ≠ « envoyé » : l'envoi est confirmé par l'utilisateur. `WHATSAPP_MODE=api` refuse de démarrer tant que l'intégration n'est pas écrite (accès Business API à fournir). |
| Paiements | **Manuel** (actif) | Justificatif → « déclaré · à vérifier » ; confirmation par l'admin (ou le commerçant pour sa propre commande) avec référence et montant exact. API Wave / Orange Money : désactivées, accès marchands non fournis. |
| Carte | Leaflet + tuiles OSM | Remplacer `VITE_MAP_TILE_URL` par un fournisseur avec contrat avant un trafic réel (politique d'usage des tuiles OSM). |
| Médias | Disque local privé | `STORAGE_DIR`, jamais servi en statique ; lecture par URL signée 10 min. Adaptateur S3 à écrire si besoin. |

## Déploiement (résumé)

Un seul processus Node sert l'API et l'interface compilée :

```bash
npm ci && npm run build
NODE_ENV=production SERVE_WEB=true TRUST_PROXY=true APP_SECRET=… DATABASE_URL=… PUBLIC_URL=https://… npm start
```

Derrière un reverse proxy HTTPS (Caddy, Nginx) avec `proxy_buffering off` pour `/api/live` (SSE). Détails, sauvegardes et checklist : [`docs/PRODUCTION.md`](docs/PRODUCTION.md).

## Limites connues

- **Une PWA ne suit pas la position en arrière-plan** de façon fiable : la position du livreur n'est envoyée que lorsque l'application est ouverte (disponible ou en course). Les positions de plus de 3 min sont affichées « périmées ».
- **Pas d'ETA** : aucune heure d'arrivée n'est calculée ni affichée ; seule la dernière position connue l'est. La distance proposée à l'admin est à vol d'oiseau et indicative.
- Les centres de zones (distance indicative) sont approximatifs ; les communes du pilote sont à activer par l'admin.
- Interface en français uniquement ; les messages wolof existent (`server/messages.ts`) mais restent désactivés tant qu'ils ne sont pas relus (`WOLOF_REVIEWED`).
- Pas de notifications push : les écrans se mettent à jour en temps réel (SSE + rafraîchissement périodique) lorsqu'ils sont ouverts ; le livreur doit garder l'application ouverte pour voir une offre de 30 s.
- Le temps réel multi-instances passe par PostgreSQL `LISTEN/NOTIFY` ; la limitation de débit est en mémoire (par instance).
