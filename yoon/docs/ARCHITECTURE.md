# Architecture et décisions

## Vue d'ensemble

```
web/ (React, PWA)  ──HTTP JSON + SSE──▶  server/ (Fastify)  ──▶  PostgreSQL
                                           ├─ domain/   règles métier (transactions)
                                           ├─ routes/   un module par rôle, autorisation à chaque route
                                           ├─ adapters/ WhatsApp, paiements, stockage médias
                                           └─ jobs.ts   expiration des offres, récap quotidien, purge
shared/contract.ts : états, transitions, libellés — contrat unique partagé par l'API et l'interface.
```

Monolithe modulaire, un seul processus. Pas de microservice, pas d'ORM : SQL explicite, contraintes en base.

## États séparés

| Objet | États |
| --- | --- |
| Livraison (`orders.status`) | `awaiting_location → ready → offered → assigned → at_pickup → picked_up → in_delivery → delivered`, plus `incident`, `cancelled` |
| Offre (`offers.status`) | `pending → accepted / refused / expired / withdrawn` |
| Paiement commande / course / frais (`payment_obligations`) | `due → declared → confirmed`, `rejected`, `waived` — une ligne par obligation, payeur et destinataire explicites |
| Gain livreur (`earnings`) | `pending → paid` (reversé, lié à un `payout`) |

### Transitions et acteurs (`shared/contract.ts`)

| Transition | De | Vers | Acteurs |
| --- | --- | --- | --- |
| Position reçue | awaiting_location | ready | client, admin (saisie après appel) |
| Offre envoyée | ready | offered | admin |
| Offre close (refus, expiration, retrait) | offered | ready | livreur, système, admin |
| Offre acceptée | offered | assigned | livreur |
| Au retrait / récupéré / départ | assigned → at_pickup → picked_up → in_delivery | | livreur |
| Remise par code | picked_up, in_delivery | delivered | livreur |
| Incident (preuve photo, client introuvable) | assigned…in_delivery | incident | livreur |
| Reprise / validation photo | incident | état précédent / delivered | admin |
| Annulation gratuite | avant attribution | cancelled | commerçant, admin |
| Annulation avec frais | assigned, at_pickup | cancelled | commerçant, admin |
| Annulation tardive | picked_up, in_delivery, incident | cancelled | admin |

Chaque transition écrit un `delivery_events` (historique) ; les actions sensibles écrivent aussi `audit_log`.

## Garanties contre les doublons

- **Double attribution** : index unique partiel « une offre `pending` par commande », « une offre `pending` par livreur », « une offre `accepted` par commande », « une course active par livreur » ; acceptation dans une transaction avec `SELECT … FOR UPDATE` et contrôle d'échéance côté serveur.
- **Double paiement comptabilisé** : une obligation par (commande, type) ; une référence de transfert ne confirme qu'une obligation (`unique(method, reference)` sur les confirmées) ; confirmation conditionnelle à l'état.
- **Double gain** : `unique(order_id, kind)` pour les gains de course et d'annulation ; insertion `on conflict do nothing`.
- **Double remise** : code à usage unique sous verrou ; une seule preuve `accepted` par commande.
- **Reprise réseau** : création de commande avec en-tête `Idempotency-Key` (le brouillon conserve la clé) ; reversement avec montant attendu.
- **Tâches rejouées** : `job_runs` (clé unique par tâche et date) ; expiration d'offres idempotente ; messages avec `dedupe_key`.

## Identification du client (choix documenté)

Pas de compte ni de mot de passe. À la création, le serveur génère un **jeton aléatoire de 192 bits** ; seul son SHA-256 est stocké. Le lien est `PUBLIC_URL/c#<jeton>` : le jeton est dans le **fragment**, donc jamais envoyé dans les URL de requête ni dans les journaux. L'interface le lit, le conserve sur le téléphone et l'envoie dans l'en-tête `X-Client-Token`. Le lien est limité à une livraison, expire (`CLIENT_LINK_TTL_HOURS`) et est **révocable** : « Nouveau lien » côté commerçant invalide le précédent. Limite : quiconque détient le lien voit la livraison (comme un lien de suivi WhatsApp) ; c'est pourquoi le code de remise n'est utile qu'à la réception.

## Code de remise

4 chiffres aléatoires (`crypto.randomInt`), chiffrés en base (AES-256-GCM dérivé d'`APP_SECRET`), visibles seulement par le client autorisé. Usage unique, expiration (`CODE_TTL_HOURS`), **5 essais** puis blocage (HTTP 423) ; endpoint limité à 10 requêtes/min. Secours : preuve photo avec motif (et nom du tiers éventuel) → incident bloquant → décision de l'admin. Aucune remise n'est validée sans code ou décision humaine.

## Temps réel

`pg_notify` à chaque changement (envoyé seulement au commit) → bus `LISTEN` → SSE `/api/live` filtré par destinataire (boutique, livreur, admin, ou jeton client). Le flux ne transporte qu'un signal « à rafraîchir » ; les données sont relues via les routes autorisées. Filet de sécurité : rafraîchissement périodique (10–20 s), au retour du réseau et au focus.

## Offres de 30 s

`expires_at` fixé par le serveur ; l'interface reçoit `expires_at` et `server_now` pour un compte à rebours calé sur l'horloge serveur. L'acceptation revérifie l'échéance en base. Un balayage toutes les 2 s (et à chaque lecture admin/livreur) remet les courses expirées « à attribuer ». Pas de dispatch automatique : l'admin propose au suivant.

## Paiements

Deux obligations distinctes dès la confirmation : **commande → commerçant** (payée par le client) et **course → service** (payée par le commerçant ou le client selon le choix enregistré). Le client ne peut jamais envoyer de montant ; la confirmation exige le montant exact de l'obligation et une référence. Le commerçant peut confirmer la réception de sa propre commande (il voit son compte) ; seul l'admin confirme ce qui revient au service.

## Médias

Upload multipart (6 Mo photo, 3 Mo audio), **type détecté par signature** (JPEG, PNG, WebP, WebM, Ogg, MP4/M4A), stockage privé hors racine web, droits vérifiés par rôle et par livraison. Lecture par URL signée HMAC de 10 min générée uniquement par une route autorisée. Purge quotidienne après `MEDIA_RETENTION_DAYS` pour les livraisons terminées.

## Carte et géolocalisation

Leaflet + OpenStreetMap (léger, sans clé). Le client consent explicitement (bouton) ; refus ou absence de GPS → placement manuel sur la carte et repère écrit/photo/vocal. Les positions hors région de Dakar sont refusées. Le livreur ne partage sa position que si l'application est ouverte et qu'il est disponible ou en course ; l'offre ne montre que la **zone** du client, l'adresse précise n'apparaît qu'après acceptation et disparaît une fois la course terminée.

## Hypothèses et décisions provisoires (à valider)

| Sujet | Choix par défaut | Où le changer |
| --- | --- | --- |
| Communes du pilote | aucune active en production (9 dans la démo) | Admin › Zones & tarifs |
| Prix par paire de zones | aucun en production ; démo = exemples de la maquette | Admin › nouvelle version de grille |
| Part livreur / commission | démo 80 % / 20 % | grille (`courier_share_bps`) |
| Frais d'annulation après attribution | démo 500 F, 100 % au livreur | grille |
| Client introuvable : délai, frais | 10 min (PDF), démo 1 000 F | grille |
| Paiement de la course avant attribution | non exigé | Admin › Paramètres |
| Comptes de réception du service | à renseigner | Admin › Paramètres |
| Modalités de reversement | manuel, solde complet par livreur | — |
| Une seule course active par livreur | oui (pas de livraison groupée) | contrainte SQL |
| Code : 5 essais, 72 h ; lien client : 72 h | | variables d'environnement |
