# Yoon — Mission de développement complet

## Instruction de départ

Tu es mon développeur senior full-stack et responsable technique. Construis une application de livraison utilisable de bout en bout à partir du MVP et de la maquette joints. Je veux du code fonctionnel, une base de données persistante, une authentification, des autorisations par rôle, des tests utiles et une documentation de lancement. Ne t’arrête pas à un plan, des écrans ou des données fictives. Avance par étapes exécutables jusqu’au produit testable.

Communique en français, avec des points d’avancement concis. Optimise les tokens : inspection ciblée du dépôt, décisions courtes, pas de réécriture des fichiers non concernés, pas de répétition intégrale des spécifications. Évite les agents multiples par défaut ; n’en utilise que pour des tâches indépendantes dont le bénéfice justifie le coût. Maintiens un fichier STATUS.md pour reprendre sans relire toute la conversation.

## Sources et priorité

1. Ce brief précise la demande actuelle : développer l’application complète correspondant aux parcours dessinés.
2. `reference/MVP-livraison-Senegal.pdf` est la référence métier originale, à lire entièrement.
3. `prototype/index.html` est la référence de direction visuelle et des écrans, à ouvrir et inspecter avant implémentation.
4. Aperçu privé : https://yoon-delivery-ecrans-adama.falladamaa.chatgpt.site — s’il est inaccessible, utiliser le fichier HTML joint ; ne pas bloquer sur l’authentification ChatGPT.

Le PDF prévoit initialement un service WhatsApp sans application dédiée. La demande actuelle étend explicitement ce périmètre à l’application dessinée, sans transformer les autres fonctions « plus tard » en obligations du lancement. Construire d’abord une application web responsive installable (PWA) couvrant les quatre rôles, utilisable sur téléphone. Une application native et sa publication sur les stores constituent une phase ultérieure, sauf demande explicite.

WhatsApp reste un canal opérationnel essentiel : préserver les messages, repères et échanges utiles. Le fonctionnement métier doit rester utilisable si les accès API WhatsApp ou paiement ne sont pas encore disponibles.

En cas de contradiction : conserver les règles métier du PDF ; utiliser la maquette pour le visuel ; appliquer les clarifications de ce brief. Documenter une décision non définie plutôt que la présenter comme validée. Ne pas reprendre automatiquement les incohérences ou raccourcis de démonstration.

## Ce que la maquette fournit — et ne fournit pas

Elle fournit une direction « Dakar futuriste sobre » : vert profond, citron, fonds clairs, cartes arrondies, hiérarchie nette, transitions discrètes, parcours courts et navigation mobile basse.

Elle contient des écrans commerçant, client, livreur et admin, ainsi que les formulaires et états illustratifs. Elle n’est pas une application de production : variables en mémoire, données fictives, profils librement commutables, carte SVG illustrative, code client fixe, notifications et paiements simulés, temporisation figée. Aucun de ces mécanismes ne doit devenir une preuve de fonctionnement réel.

Le HTML est une référence visuelle, pas une architecture à conserver. Réimplémenter avec des composants maintenables et des contrôles de sécurité côté serveur. Le sélecteur de quatre profils appartient à la démonstration ; un utilisateur réel n’accède qu’aux rôles autorisés.

## Périmètre métier

- Région de Dakar : Dakar, Pikine, Guédiawaye, Rufisque, Keur Massar. Prévoir un sous-ensemble de zones activables pour le pilote.
- Une course transporte un colis ou repas du point A au point B, par moto/scooter.
- Prix fixe par paire de zones, affiché avant confirmation ; aucun prix calculé au kilomètre.
- Tarifs, commission et rémunération livreur configurables, versionnés et figés sur chaque commande lors de la confirmation.
- Les tarifs et gains du HTML sont des exemples, pas des décisions métier validées. Seed de démonstration distinct de la configuration réelle.
- Paiement mobile Wave ou Orange Money uniquement. Pas de cash.
- Paiement de la commande au commerçant ; paiement de la livraison au service, par le commerçant ou par le client selon le choix enregistré. Distinguer les deux obligations et leurs destinataires : ne pas supposer un encaissement unique pour les deux.
- Le livreur ne manipule pas les fonds de la commande. Un gain de course, une commission et un reversement sont des objets différents.
- Position client reçue avant proposition au livreur. Repère textuel, photo et note vocale complètent cette position.
- Attribution manuelle par l’admin à un livreur disponible et proche. Présenter les données de position avec leur fraîcheur ; ne pas prétendre connaître une proximité réelle sans données récentes.
- Offre valable 30 secondes, acceptation atomique. Refus ou expiration : course de nouveau attribuable, puis proposition au suivant par l’admin. Ne pas ajouter un moteur autonome de dispatch : l’attribution automatique est hors périmètre initial.
- Preuve de remise : code client à 4 chiffres ; procédure photo en secours selon le PDF, avec motif, trace et contrôle admin. Ne pas permettre une remise silencieuse non autorisée à un tiers.
- Client introuvable : tracer deux tentatives de contact, puis annulation et frais de déplacement selon une politique configurable. Le message du PDF évoque 10 minutes : rendre le délai configurable et signaler qu’il doit être validé.
- Annulation gratuite avant attribution ; frais minimum après attribution, montant à définir. Enregistrer raison, acteur, heure et éventuelle décision de remboursement.
- Réclamations traitées manuellement ; récapitulatif quotidien avec paiements et gains.
- Français au lancement ; structure i18n et possibilité de notes vocales en wolof. Les formulations wolof doivent être relues par un locuteur avant affichage en production.

Ne pas ajouter : cash, autres régions, livraison groupée, optimisation avancée des tournées, fidélité, notation, crédit, assurance ou marketplace de produits.

## Parcours à réaliser

### Commerçant

1. Connexion et profil boutique, téléphone, zone et lieu de retrait.
2. Accueil : indicateurs calculés à partir des commandes réelles, livraisons en cours, action principale « Nouvelle livraison ».
3. Création en trois étapes : client/téléphone/montant ; retrait/destination/payeur ; prix et récapitulatif avant confirmation.
4. Demande de localisation au client, puis attente explicite de sa réponse.
5. Liste avec filtres, détail, suivi, annulation autorisée, signalement et historique.
6. Paiements, justificatifs et récap quotidien, avec libellés précis : reçu, déclaré, à vérifier, reversé.

### Client

1. Accès sécurisé à sa livraison depuis une invitation ou un lien temporaire scoped à une commande. Choisir et documenter le mécanisme d’identification sans lui imposer un onboarding lourd.
2. Partage volontaire de position ; traitement du refus GPS ; saisie manuelle sur carte ou repère ; ajout photo et note vocale.
3. Suivi du statut, dernière position connue du livreur et heure de mise à jour ; ETA seulement si réellement calculée, sinon estimation explicitement étiquetée.
4. Paiement Wave/Orange Money selon les destinataires réels et dépôt des justificatifs.
5. Code unique de remise, visible au client autorisé, à donner seulement à réception.
6. Contact du livreur, confirmation et aide.

### Livreur

1. Connexion, validation du profil par l’admin et disponibilité.
2. Proposition montrant retrait, zone, rémunération et délai réel restant, synchronisé avec le serveur.
3. Acceptation/refus ; gérer expiration et acceptation concurrente.
4. Fiche de course : repères, photo, note vocale, contact et ouverture d’itinéraire.
5. États : accepté, arrivé au retrait, colis récupéré, en livraison, remis ou incident.
6. Saisie du code, erreurs compréhensibles, limitation des tentatives, preuve alternative contrôlée.
7. Gains et historique des reversements.
8. Réseau faible : indiquer hors connexion, conserver un brouillon si possible, permettre la reprise ; ne jamais afficher comme validée une action sensible non confirmée par le serveur.

### Admin

1. Accès réservé, vue des commandes et des livreurs disponibles.
2. Attribution, expiration, refus et réattribution avec historique.
3. Gestion des zones, tarifs et paramètres de partage des frais.
4. Vérification manuelle des paiements et suivi des reversements.
5. Gestion des incidents, annulations et ajustements, avec audit.
6. Récapitulatif quotidien et export CSV des données autorisées.

## Design et expérience

Conserver la direction visuelle de la maquette ; ne pas livrer un dashboard générique différent. Nom provisoire : Yoon, modifiable en configuration. Couleurs de référence : #183d35, #d5f680, #f5f7f2, #ffffff ; typographies Manrope et DM Sans ou équivalents locaux.

Références d’inspiration (pas des dépendances obligatoires) :
- https://github.com/shadcn-ui/ui
- https://github.com/magicuidesign/magicui
- https://github.com/DavidHDev/react-bits

Vérifier versions, licences et pertinence dans leur documentation officielle avant installation. Éviter d’installer trois bibliothèques pour quelques effets. Donner priorité à la vitesse et à la lisibilité.

- Mobile d’abord, particulièrement Android d’entrée/milieu de gamme ; desktop admin confortable.
- Actions principales accessibles au pouce, zones tactiles d’au moins 44 px, texte lisible, contraste contrôlé, labels explicites, navigation clavier et focus visibles.
- Un CTA principal par étape. Messages courts ; distinguer les erreurs réparables des blocages.
- Transitions brèves, respect de la réduction des animations. Aucune animation décorative permanente coûteuse.
- États vide, chargement, succès, erreur, hors ligne, accès interdit et session expirée pour chaque parcours pertinent.
- Carte réelle choisie et documentée ; consentement GPS, fallback manuel, permissions refusées et réseau indisponible.
- Pas de faux compte à rebours, faux suivi temps réel ou faux montant sur le parcours de production.
- Dates, heures et récapitulatifs en fuseau Africa/Dakar ; montants en FCFA/XOF, entiers ; numéros normalisés et validés.

## Architecture attendue

S’il existe déjà un dépôt, inspecte-le et conserve les choix cohérents. Sinon, propose brièvement une stack simple puis implémente-la : frontend TypeScript à composants, backend/API, base relationnelle persistante et migrations, stockage privé des médias, mécanisme de mises à jour de suivi, tâches différées durables pour expiration d’offres et récapitulatifs.

Choisir les versions supportées au moment de l’implémentation à partir des documentations officielles. Ne pas surarchitecturer : un monolithe modulaire suffit. Éviter microservices et dépendances redondantes. Un seul contrat métier partagé entre interfaces et intégrations.

Entités minimales : utilisateurs, rôles/autorisations, boutiques, profils livreurs, disponibilité/positions datées, zones, tarifs versionnés, commandes, localisation client, offres d’attribution, événements de livraison, obligations de paiement, paiements/justificatifs, gains/commissions, reversements, preuves de remise, incidents, notifications et audit.

Séparer état de livraison, état d’offre, état de paiement commande, état de paiement livraison et état de reversement. Documenter les transitions autorisées et les acteurs qui peuvent les déclencher. Utiliser transactions, contraintes et clés d’idempotence pour empêcher double attribution, double paiement comptabilisé, double gain et double remise. Les réessais de tâches ou webhooks ne doivent pas créer de doublons.

## Intégrations et modes de fonctionnement

Prévoir des adaptateurs distincts pour WhatsApp, paiements, carte et médias. Configurer un mode de développement sans secrets avec données de démonstration explicitement identifiées, et un mode réel sans simulation silencieuse.

WhatsApp : tant que les accès Business/API ne sont pas disponibles, proposer un message prérempli à ouvrir et envoyer explicitement par l’utilisateur ou l’opérateur. Ne jamais marquer le message « envoyé » sur la seule ouverture d’un lien. Avec API, vérifier les conditions actuelles, modèles requis, webhooks authentifiés, livraison et réessais.

Paiements : la vérification manuelle est une fonctionnalité complète du premier lancement, pas un mock. Un justificatif déposé signifie « à vérifier », pas « payé ». L’admin confirme après contrôle du transfert réellement reçu et renseigne la référence. Les API automatiques sont préparées derrière des adaptateurs, désactivées sans accès validés. Un retour navigateur ne suffit jamais comme confirmation de paiement.

Géolocalisation : ne collecter que ce qui est nécessaire à la course et à la disponibilité choisie. Ne pas promettre un suivi continu en arrière-plan sur tous les téléphones avec une PWA ; tester et documenter les limites de la plateforme. Les positions périmées doivent être visibles comme telles.

## Sécurité et confidentialité

Autorisations côté serveur à chaque lecture/écriture : commerçant sur ses commandes, client sur sa livraison, livreur sur les courses autorisées, admin selon ses droits. Le frontend ne constitue jamais une barrière d’accès.

Authentification éprouvée, sessions sûres, validation serveur, limitations de débit, gestion des secrets hors du dépôt, journalisation sans exposer téléphones, coordonnées ou codes. Stockage privé des photos/vocaux et URLs temporaires, contrôle taille/type, stratégie de conservation/suppression configurable.

Le code de remise doit être aléatoire, lié à une commande, à usage unique, protégé côté serveur, avec durée de validité et limite d’essais. Un code à quatre chiffres exige ces limites. Les liens clients doivent être opaques, limités à une livraison, expirables et révocables.

Le pilote reçoit une configuration de conservation, de sauvegarde et de restauration documentée. Identifier les validations réglementaires nécessaires au lancement sans prétendre fournir un avis juridique.

## Tests et définition de terminé

Réaliser un parcours bout en bout : commerçant crée → client donne sa position → admin propose → livreur accepte → retrait → livraison par code → paiements vérifiés séparément → gain et reversement visibles.

Tester aussi : droits entre deux boutiques/clients ; double acceptation ; offre expirée ; mauvais code et réutilisation ; montant modifié côté client ; justificatif sans validation ; paiement du commerçant vs paiement du client ; annulation avant/après attribution ; absence de GPS ; photo invalide ; reprise réseau ; tâche rejouée ; médias non autorisés.

Critères de livraison :
- Données toujours présentes après rechargement et redémarrage du backend.
- Écrans fidèles, vérifiés au minimum à 360, 390 et 1440 px, sans débordement bloquant.
- Tous les CTA ont un comportement réel ou un état d’indisponibilité expliqué ; aucune simulation cachée en mode réel.
- Tests de règles métier, autorisations et parcours critique passants ; build et vérification TypeScript réussis.
- Seed de démonstration reproductible, comptes de test documentés seulement pour le mode local, jamais identifiants de production committés.
- README : installation, migrations, démarrage, tests, variables, configuration des providers, déploiement et limites connues.
- `.env.example` sans secrets, migrations et scripts utiles inclus.
- Checklist de mise en production avec accès externes restant à fournir et commandes exactes ; pas de paiement ni message réel pendant les tests sans autorisation explicite.

## Façon de travailler

1. Lire ce brief, le PDF et le HTML, puis inspecter le dépôt existant.
2. Résumer en quelques lignes les choix techniques et les hypothèses métier ; noter ce qui reste à confirmer, sans bloquer les travaux indépendants.
3. Construire un premier parcours vertical persistant, puis compléter les autres rôles et les cas d’erreur.
4. Brancher les intégrations disponibles ; livrer le mode manuel utilisable pour celles dont l’accès manque.
5. Tester, corriger, documenter et fournir un résultat exécutable. Ne pas déclarer « terminé » sur la base d’un simple mock visuel ou d’un build seul.
6. À chaque étape, mettre à jour STATUS.md : réalisé, tests exécutés, reste à faire, blocages externes.

Questions ouvertes à conserver dans la configuration et la documentation : communes exactes du pilote ; partenaires livreurs ; prix par zone ; commission ; frais d’annulation ; délai d’incident ; politique de paiement avant attribution ; comptes destinataires et modalités de reversement. Ne pas inventer une décision définitive.

Commence maintenant par inspecter les fichiers joints et le dépôt, puis passe à l’implémentation.
