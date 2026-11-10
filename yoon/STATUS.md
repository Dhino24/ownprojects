# STATUS — Yoon

_Dernière mise à jour : 10 novembre 2026._

## Réalisé

- Monolithe Fastify + PostgreSQL (migrations `001_init`, `002_zones`), contrat partagé `shared/contract.ts`.
- Auth téléphone + mot de passe (scrypt), sessions en base (cookie httpOnly), rôles vérifiés côté serveur, contrôle d'origine, limitation de débit par session/jeton/numéro.
- Commerçant : inscription/profil boutique, accueil calculé, création en 3 étapes (brouillon local + idempotence + prix figé), liste/filtres/recherche, détail, suivi, annulation, signalement, messages WhatsApp manuels, paiements et récap.
- Client : lien opaque révocable, position GPS / carte / repère / photo / vocal, suivi (dernière position datée, sans ETA), code de remise, paiements séparés avec justificatifs, aide.
- Livreur : validation par l'admin, disponibilité, partage de position (app ouverte), offre 30 s synchronisée serveur, acceptation atomique, étapes, code (5 essais), preuve photo contrôlée, client introuvable (2 tentatives + délai), gains et reversements, historique.
- Admin : vue d'ensemble, attribution / retrait / réattribution avec historique, saisie de position après appel, annulation avec frais et remboursement, nouveau code, vérification des paiements, incidents, livreurs, reversements et ajustements, zones et grilles versionnées, paramètres, récap + export CSV, messages WhatsApp, audit.
- Tâches : expiration des offres (2 s), récap quotidien préparé à `RECAP_HOUR_DAKAR`, purge des médias — rejouables sans doublon.
- PWA : manifeste, icônes, service worker (interface seulement, jamais l'API), pages chargées par rôle.
- Docs : README, docs/ARCHITECTURE.md, docs/PRODUCTION.md, .env.example.

## Tests exécutés

- `npm test` : 23 tests (2 fichiers) — parcours complet + cas listés dans le brief. ✅
- `npm run typecheck` / `npm run build` ✅
- `npm run screens` : parcours complet dans Chromium (GPS simulé) + captures 360/390/1440 px de tous les écrans, sans débordement ni erreur JS ✅

## Reste à faire / pistes

- Adaptateur WhatsApp Business API (après accès et vérification des conditions).
- Adaptateurs API Wave / Orange Money (après accès marchands).
- Adaptateur de stockage objet (S3 compatible) si plusieurs instances.
- Interface en wolof après relecture ; notifications push.
- Tests sur téléphones Android réels et réseau dégradé.

## Blocages externes

Voir docs/PRODUCTION.md §1–2 : hébergement, numéros du service, fournisseur de tuiles, décisions tarifaires et communes du pilote, validations réglementaires.
