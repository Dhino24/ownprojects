# Pont — optimiseur de congés payés

Application web mobile (PWA) qui place vos congés payés de façon à **maximiser le nombre de
jours de repos consécutifs obtenus**, à partir des jours fériés français et de votre semaine
de travail.

Aucune dépendance, aucun compte, aucun appel réseau : tout est calculé sur l'appareil et
conservé en local.

## Le principe

Un jour de congé posé ne vaut pas un jour de repos : il **soude** des week-ends et des jours
fériés entre eux. Poser le vendredi 7 mai 2027, au lendemain de l'Ascension, coûte un jour et
en rapporte quatre d'affilée.

L'application cherche donc la répartition du solde qui maximise la somme des longueurs des
blocs de repos obtenus. Le résultat est **exact, pas approché** : tous les placements possibles
sont explorés par programmation dynamique sur la suite des jours travaillés de la période.

À score égal, c'est le plan le plus **étalé** sur l'année qui est retenu — trouvé par dichotomie
sur l'espacement minimal entre deux pauses.

## Ce qu'elle sait faire

- **Jours fériés calculés**, pas codés en dur : Pâques par l'algorithme grégorien, donc valables
  pour n'importe quelle année (vérifié sur 1900–2100).
- **Décompte en jours ouvrés ou ouvrables.** En jours ouvrables, le samedi compte même s'il
  n'est pas travaillé : poser un vendredi coûte 2 jours, un lundi n'en coûte qu'un. Cette
  asymétrie change le plan optimal.
- **Quatre stratégies** : rendement maximum, équilibré, grandes vacances, une seule coupure.
- **Contraintes** : jours imposés et jours interdits, posés d'un appui sur le calendrier ;
  période de référence libre ; semaine de travail quelconque.
- **Règles françaises** optionnelles : congé principal (12 jours ouvrables entre mai et octobre)
  et plafond de congé continu (24 jours ouvrables).
- **Export iCalendar** (.ics) et récapitulatif en texte pour une demande RH.

## Développement

```sh
npm test      # 32 tests, dont une comparaison exhaustive avec une recherche par force brute
npm run build # assemble dist/index.html, fichier unique autonome
npm run serve # http://localhost:8080
node tools/make-icons.mjs  # régénère les icônes PNG
```

`dist/index.html` est versionné volontairement : c'est l'application entière en un seul
fichier, à déposer sur n'importe quel hébergement statique ou à ouvrir directement.

## Structure

| Fichier | Rôle |
| --- | --- |
| `src/dates.js` | dates en UTC pur, formats français |
| `src/holidays.js` | Pâques et les 11 fériés métropolitains |
| `src/engine.js` | le moteur : calendrier, coûts, optimisation, étalement |
| `src/ics.js` | export iCalendar et récapitulatif texte |
| `src/app.js` | interface |
| `build.mjs` | assemblage en un fichier unique (résolution du graphe d'imports) |

Le moteur ne dépend pas du DOM : `src/engine.js` s'utilise tel quel en Node.

```js
import { feriesMap } from './src/holidays.js';
import { buildCalendar, optimiserEtEtaler } from './src/engine.js';

const cal = buildCalendar({
  debut: '2027-01-01', fin: '2027-12-31', feries: feriesMap(2026, 2028),
});
const plan = optimiserEtEtaler(cal, { solde: 25, decompte: 'ouvres', minBloc: 3 });
console.log(plan.totalRepos); // 81
```

## Limites connues

- Jours fériés de **France métropolitaine** uniquement : ni Alsace-Moselle (Vendredi saint,
  26 décembre), ni outre-mer, ni autres pays.
- Les RTT sont traités comme des congés ordinaires : on les ajoute au solde. Les règles propres
  aux RTT (pose à l'initiative de l'employeur, périodes imposées) ne sont pas modélisées.
- Le congé principal est vérifié sur la **durée d'une pause**, sans tenir compte des règles de
  fractionnement qui ouvrent des jours supplémentaires.
