# Mise en production du pilote — checklist

Aucun paiement réel ni message réel ne doit être déclenché pendant les tests sans autorisation explicite.

## 1. Accès externes à fournir

- [ ] **Serveur** (VPS ou PaaS Node 22) + nom de domaine + certificat HTTPS.
- [ ] **PostgreSQL** managé ou auto-hébergé (≥ 14), avec sauvegardes.
- [ ] **Numéros Wave / Orange Money du service** pour recevoir les frais de course (Admin › Paramètres).
- [ ] **Fournisseur de tuiles cartographiques** avec conditions adaptées (remplace `tile.openstreetmap.org`).
- [ ] (Plus tard) **WhatsApp Business API** : compte vérifié, numéro, modèles approuvés, webhook authentifié — l'adaptateur `api` reste à écrire après vérification des conditions en vigueur.
- [ ] (Plus tard) **API marchands Wave / Orange Money** : non branchées ; la vérification manuelle reste le mode du pilote.
- [ ] Relecture du **wolof** par un locuteur avant d'activer `WOLOF_REVIEWED`.

## 2. Décisions métier à fixer (voir docs/ARCHITECTURE.md)

Communes du pilote, partenaires livreurs, prix par paire de zones, commission, frais d'annulation, délai et frais « client introuvable », politique de paiement avant attribution, comptes destinataires et modalités de reversement.

## 3. Installation

```bash
git clone … && cd yoon
npm ci
npm run build
export NODE_ENV=production DATABASE_URL='postgres://…' PUBLIC_URL='https://yoon.example' \
       APP_SECRET="$(openssl rand -base64 48)" STORAGE_DIR=/var/lib/yoon/media \
       SERVE_WEB=true TRUST_PROXY=true
npm run migrate
npm run admin:create -- "+2217XXXXXXXX" "Prénom Nom"   # mot de passe saisi au clavier (12 caractères min.)
npm start                                                 # ou service systemd équivalent
```

`APP_SECRET` doit rester stable (il chiffre les codes en cours et signe les URL de médias) et ne jamais être commité. `DEMO_MODE=true` et `npm run seed:demo` sont refusés en production.

Ensuite, dans l'admin : activer les zones du pilote → publier une grille tarifaire → renseigner les numéros du service → valider les livreurs.

## 4. Reverse proxy (exemple Caddy)

```
yoon.example {
  reverse_proxy 127.0.0.1:8787 {
    flush_interval -1      # SSE /api/live
  }
}
```

Nginx : `proxy_buffering off;` et `proxy_read_timeout 1h;` sur `/api/live`.

## 5. Sauvegarde et restauration

- Base : `pg_dump -Fc "$DATABASE_URL" > yoon-$(date +%F).dump` chaque nuit, conservation 30 jours hors du serveur (chiffrée).
- Médias : synchronisation quotidienne de `STORAGE_DIR` (ex. `rclone sync` chiffré).
- Restauration testée avant le lancement : `createdb yoon_restore && pg_restore -d yoon_restore yoon-AAAA-MM-JJ.dump`, puis démarrer une instance sur cette base et vérifier une livraison.
- Conservation : médias purgés après `MEDIA_RETENTION_DAYS` (90 j par défaut) pour les livraisons terminées. Durée de conservation des commandes, téléphones et positions à fixer avec un conseil juridique.

## 6. Vérifications avant ouverture

- [ ] `npm test` et `npm run build` passent sur la machine de build.
- [ ] Parcours complet joué sur 2 téléphones Android réels (réseau 3G/4G) avec de **faux** montants, sans transfert réel.
- [ ] HTTPS actif, cookie `Secure`, `PUBLIC_URL` exact (contrôle d'origine et liens clients).
- [ ] Journaux : pas de numéro, code, coordonnée ni jeton (les en-têtes sensibles sont masqués).
- [ ] Sauvegarde et restauration testées.
- [ ] Comptes admin nominatifs, mots de passe forts ; aucun compte de démo.

## 7. Validations réglementaires à identifier (non exhaustif, pas un avis juridique)

- Protection des données personnelles au Sénégal (loi n° 2008-12, Commission de protection des données personnelles — CDP) : déclaration / autorisation du traitement, information des clients, durée de conservation, géolocalisation.
- Statut et assurance des livreurs, cadre du transport de marchandises à moto.
- Encaissement pour le compte de tiers / reversements : conditions des opérateurs Wave et Orange Money, obligations fiscales et comptables.
- Conditions d'utilisation de WhatsApp Business pour les messages sortants.
