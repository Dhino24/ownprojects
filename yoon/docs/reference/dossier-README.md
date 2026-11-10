# Dossier à transmettre à Claude

Ce dossier rassemble le MVP original et le travail d’interface réalisé le 10 novembre 2026.

## Utilisation

1. Décompresser le dossier dans l’espace de travail de Claude Code, ou joindre ses fichiers à un projet Claude.
2. Lui demander de lire `CLAUDE.md`, `reference/MVP-livraison-Senegal.pdf` et `prototype/index.html`.
3. Utiliser le message de démarrage ci-dessous.

> Lis intégralement CLAUDE.md, le PDF du MVP et la maquette HTML joints. Développe l’application complète selon ce brief, en conservant le design et les règles métier. Commence par inspecter le dépôt, puis implémente les parcours de bout en bout avec persistance, authentification, autorisations, tests et documentation. Optimise les tokens et avance sans t’arrêter à un plan. Distingue les intégrations réelles, le fonctionnement manuel du pilote et le mode démonstration. Note les accès externes manquants sans inventer leur fonctionnement.

## Contenu

- `CLAUDE.md` : consignes complètes, périmètre, règles métier, sécurité et critères de validation.
- `reference/MVP-livraison-Senegal.pdf` : document fourni, non modifié.
- `reference/MVP-texte.txt` : extraction du texte pour faciliter la lecture ; consulter le PDF pour le schéma du parcours et la mise en page.
- `prototype/index.html` : source autonome de la maquette, ouvrable dans un navigateur. Les polices Google nécessitent Internet ; les polices système servent de repli.

Aperçu privé : https://yoon-delivery-ecrans-adama.falladamaa.chatgpt.site
L’accès à ce lien peut nécessiter le compte de son propriétaire. Le HTML joint suffit pour que Claude dispose de la référence sans cet accès.

## Portée

La demande actuelle ajoute une application web responsive installable au MVP WhatsApp initial. L’application native et les stores ne font pas partie de ce premier brief. Le mode manuel de vérification des paiements et d’attribution demeure le mode du pilote.

Les tarifs, noms de clients, positions, codes, gains et statistiques de la maquette sont fictifs. Yoon est un nom provisoire. La maquette ne contient ni backend, ni secrets, ni intégrations de paiement opérationnelles.
