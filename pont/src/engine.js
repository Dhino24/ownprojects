// Moteur d'optimisation des congés payés.
//
// Idée : l'année est une suite de jours « travaillés » et de jours « déjà au repos »
// (week-ends + fériés). Poser un congé ne crée pas 1 jour de repos mais fusionne des
// blocs : c'est la longueur du bloc de repos obtenu qui compte, pas le nombre de jours
// posés. On cherche donc l'ensemble de congés qui maximise le total de jours de repos
// consécutifs obtenus, sous contrainte du solde disponible.
//
// Résolution exacte par programmation dynamique sur la suite des jours travaillés
// (pas d'heuristique gloutonne) : dp[i][u][k][f] = meilleur gain à partir du i-ème
// jour travaillé, ayant déjà consommé u jours de solde, posé k pauses, et f indiquant
// si l'obligation de congé principal est déjà satisfaite.

import { isoAdd, isoDiff, isoDow } from './dates.js';

const NEG = -1 << 29;

/** Semaine de travail par défaut : lundi → vendredi. Index 0 = dimanche. */
export const SEMAINE_STANDARD = [false, true, true, true, true, true, false];

/**
 * Construit la fenêtre de calcul : la période de référence, élargie d'une marge de
 * part et d'autre pour que les blocs de repos à cheval sur les bords soient mesurés
 * correctement (un congé fin décembre s'étend sur le 1er janvier suivant).
 */
export function buildCalendar({ debut, fin, semaine = SEMAINE_STANDARD, feries, marge = 40 }) {
  const start = isoAdd(debut, -marge);
  const end = isoAdd(fin, marge);
  const days = [];
  const index = new Map();
  const n = isoDiff(start, end) + 1;
  for (let k = 0; k < n; k++) {
    const iso = isoAdd(start, k);
    const dow = isoDow(iso);
    const ferie = feries.get(iso) || null;
    const travaille = semaine[dow] && !ferie;
    index.set(iso, k);
    days.push({
      iso, dow, ferie, travaille,
      weekend: !semaine[dow],
      dansPeriode: iso >= debut && iso <= fin,
    });
  }
  return { days, index, start, end, debut, fin };
}

/**
 * Index des jours travaillés, et sommes préfixes du décompte en jours ouvrables
 * (tous les jours sauf dimanche et fériés — définition légale française).
 */
function prepare(cal) {
  const { days } = cal;
  const W = [];
  for (let k = 0; k < days.length; k++) if (days[k].travaille) W.push(k);
  const ouvrablePrefix = new Int32Array(days.length + 1);
  for (let k = 0; k < days.length; k++) {
    const estOuvrable = days[k].dow !== 0 && !days[k].ferie;
    ouvrablePrefix[k + 1] = ouvrablePrefix[k] + (estOuvrable ? 1 : 0);
  }
  return { W, ouvrablePrefix };
}

/**
 * Fonction de coût d'une pause (i..j) exprimée en index de jours travaillés.
 *  - 'ouvres'    : on décompte les jours réellement travaillés posés.
 *  - 'ouvrables' : le décompte court du 1er jour d'absence au dernier jour ouvrable
 *                  précédant la reprise. Poser un vendredi coûte donc 2 jours
 *                  (vendredi + samedi) ; poser un lundi n'en coûte qu'un.
 */
function coutFn(prep, decompte) {
  const { W, ouvrablePrefix } = prep;
  if (decompte === 'ouvrables') {
    return (i, j) => ouvrablePrefix[W[j + 1]] - ouvrablePrefix[W[i]];
  }
  return (i, j) => j - i + 1;
}

/**
 * @typedef {Object} Options
 * @property {number} solde            Jours de congés disponibles (dans l'unité de decompte).
 * @property {'ouvres'|'ouvrables'} decompte  Jours ouvrés (lun-ven) ou ouvrables (lun-sam).
 * @property {number} [minBloc]        Longueur minimale, en jours de repos, d'une pause retenue.
 * @property {number} [maxPauses]      Nombre maximal de pauses.
 * @property {number} [maxParPause]    Plafond de jours décomptés sur une seule pause.
 * @property {Object} [congePrincipal] {min, debut, fin} — pause obligatoire sur la période.
 * @property {Set<string>} [imposes]   Jours que l'on doit poser (ISO).
 * @property {Set<string>} [interdits] Jours que l'on ne peut pas poser (ISO).
 */

/** Liste, pour chaque jour travaillé i, les pauses candidates (i..j) valides. */
function candidats(cal, prep, opt) {
  const { days } = cal;
  const { W } = prep;
  const M = W.length;
  const minBloc = opt.minBloc ?? 1;
  const maxParPause = opt.maxParPause ?? Infinity;
  const interdits = opt.interdits ?? new Set();
  const cp = opt.congePrincipal;

  const poseable = new Uint8Array(M);
  for (let i = 0; i < M; i++) {
    const d = days[W[i]];
    poseable[i] = d.dansPeriode && !interdits.has(d.iso) ? 1 : 0;
  }

  const coutDe = coutFn(prep, opt.decompte);

  const parDepart = [];
  for (let i = 0; i < M; i++) {
    const liste = [];
    if (poseable[i] && i >= 1) {
      for (let j = i; j < M - 1; j++) {
        if (!poseable[j]) break;
        const cout = coutDe(i, j);
        if (cout > maxParPause || cout > opt.solde) break;
        const gain = W[j + 1] - W[i - 1] - 1;
        if (gain >= minBloc) {
          let principal = 0;
          if (cp && cout >= cp.min
            && days[W[i]].iso >= cp.debut && days[W[j]].iso <= cp.fin) principal = 1;
          liste.push({ j, cout, gain, principal });
        }
      }
    }
    parDepart.push(liste);
  }
  return { parDepart, poseable };
}

/**
 * Optimise le placement des congés.
 * @returns {{faisable: boolean, pauses: Array, totalRepos: number, soldeUtilise: number, raison?: string}}
 */
export function optimiser(cal, opt) {
  const prep = prepare(cal);
  const { W } = prep;
  const M = W.length;
  const { days } = cal;
  const B = Math.max(0, Math.floor(opt.solde));
  const imposes = opt.imposes ?? new Set();

  const forced = new Uint8Array(M);
  for (let i = 0; i < M; i++) if (imposes.has(days[W[i]].iso)) forced[i] = 1;
  // Sommes préfixes pour tester d'un coup qu'un intervalle ne contient aucun jour imposé.
  const forcedPrefix = new Int32Array(M + 1);
  for (let i = 0; i < M; i++) forcedPrefix[i + 1] = forcedPrefix[i] + forced[i];
  const aucunImpose = (a, b) => forcedPrefix[Math.min(b, M)] - forcedPrefix[Math.min(a, M)] === 0;

  // Nombre minimal de jours travaillés entre deux pauses. 1 = deux pauses peuvent
  // être séparées par une seule journée de travail (au-dessous, elles fusionneraient).
  const ecart = Math.max(1, Math.floor(opt.espacementMin ?? 1));

  const { parDepart } = candidats(cal, prep, opt);
  const K = Math.max(1, Math.min(opt.maxPauses ?? B, B));
  const S = opt.congePrincipal ? 2 : 1;
  const needPrincipal = S === 2;

  const dimU = B + 1, dimK = K + 1, dimS = S;
  const horizon = M + 1 + ecart;
  const size = (horizon + 1) * dimU * dimK * dimS;
  const dp = new Int32Array(size).fill(NEG);
  const choix = new Int16Array(size).fill(-2);
  const at = (i, u, k, f) => ((i * dimU + u) * dimK + k) * dimS + f;

  // Bords : plus aucun jour travaillé à traiter.
  for (let i = M; i <= horizon; i++) {
    for (let u = 0; u <= B; u++) for (let k = 0; k <= K; k++) for (let f = 0; f < S; f++) {
      dp[at(i, u, k, f)] = (needPrincipal && f === 0) ? NEG : 0;
      choix[at(i, u, k, f)] = -1;
    }
  }

  for (let i = M - 1; i >= 0; i--) {
    const liste = parDepart[i];
    for (let u = 0; u <= B; u++) {
      for (let k = 0; k <= K; k++) {
        for (let f = 0; f < S; f++) {
          let best = NEG, bestJ = -2;
          if (k < K) {
            for (let c = 0; c < liste.length; c++) {
              const { j, cout, gain, principal } = liste[c];
              if (u + cout > B) break;              // coûts croissants en j
              // Les jours travaillés qui séparent cette pause de la suivante ne
              // peuvent pas être des jours imposés : on les travaille.
              if (!aucunImpose(j + 1, j + 1 + ecart)) continue;
              const nf = S === 2 ? (f | principal) : 0;
              const suite = dp[at(Math.min(j + 1 + ecart, horizon), u + cout, k + 1, nf)];
              if (suite <= NEG) continue;
              const v = gain + suite;
              if (v > best) { best = v; bestJ = j; }
            }
          }
          if (!forced[i]) {
            const v = dp[at(i + 1, u, k, f)];
            if (v > best) { best = v; bestJ = -1; }
          }
          dp[at(i, u, k, f)] = best;
          choix[at(i, u, k, f)] = bestJ;
        }
      }
    }
  }

  if (dp[at(0, 0, 0, 0)] <= NEG) {
    return { faisable: false, pauses: [], totalRepos: 0, soldeUtilise: 0, raison: 'contraintes' };
  }

  // Reconstruction du chemin optimal.
  const pauses = [];
  let i = 0, u = 0, k = 0, f = 0;
  while (i < M) {
    const j = choix[at(i, u, k, f)];
    if (j === -1) { i += 1; continue; }
    const cand = parDepart[i].find((c) => c.j === j);
    const { cout, gain, principal } = cand;
    pauses.push({
      debutPose: days[W[i]].iso,
      finPose: days[W[j]].iso,
      debutRepos: days[W[i - 1] + 1].iso,
      finRepos: days[W[j + 1] - 1].iso,
      jours: [],      // rempli ci-dessous
      cout, gain, principal: !!principal,
    });
    u += cout; k += 1; f = S === 2 ? (f | principal) : 0;
    i = j + 1 + ecart;
  }

  for (const p of pauses) {
    const a = cal.index.get(p.debutPose), b = cal.index.get(p.finPose);
    for (let t = a; t <= b; t++) if (days[t].travaille) p.jours.push(days[t].iso);
  }

  return {
    faisable: true,
    pauses,
    totalRepos: pauses.reduce((s, p) => s + p.gain, 0),
    soldeUtilise: pauses.reduce((s, p) => s + p.cout, 0),
  };
}

/**
 * Analyse un ensemble quelconque de jours posés : regroupe les jours travaillés
 * consécutifs en pauses, et calcule pour chacune son coût et le repos obtenu.
 * Sert à chiffrer un plan saisi à la main et à recouper un plan optimisé.
 */
export function analyser(cal, joursPoses, decompte) {
  const prep = prepare(cal);
  const { W } = prep;
  const cout = coutFn(prep, decompte);
  const { days } = cal;
  const poses = new Set(joursPoses);

  const indexParIso = new Map();
  for (let i = 0; i < W.length; i++) indexParIso.set(days[W[i]].iso, i);

  const choisis = [...poses]
    .map((iso) => indexParIso.get(iso))
    .filter((i) => i !== undefined)
    .sort((a, b) => a - b);

  const pauses = [];
  let c = 0;
  while (c < choisis.length) {
    const i = choisis[c];
    let j = i;
    while (c + 1 < choisis.length && choisis[c + 1] === j + 1) { j = choisis[++c]; }
    c++;
    if (i < 1 || j > W.length - 2) continue; // hors fenêtre mesurable
    const jours = [];
    for (let t = W[i]; t <= W[j]; t++) if (days[t].travaille) jours.push(days[t].iso);
    pauses.push({
      debutPose: days[W[i]].iso,
      finPose: days[W[j]].iso,
      debutRepos: days[W[i - 1] + 1].iso,
      finRepos: days[W[j + 1] - 1].iso,
      jours,
      cout: cout(i, j),
      gain: W[j + 1] - W[i - 1] - 1,
      principal: false,
    });
  }
  return {
    faisable: true,
    pauses,
    totalRepos: pauses.reduce((s, p) => s + p.gain, 0),
    soldeUtilise: pauses.reduce((s, p) => s + p.cout, 0),
  };
}

/**
 * Lance l'optimisation, avec repli automatique si les contraintes sont trop serrées
 * (typiquement des jours imposés incompatibles avec « minBloc » ou « maxPauses »).
 */
export function optimiserAvecRepli(cal, opt) {
  let r = optimiser(cal, opt);
  if (r.faisable) return { ...r, assoupli: null };

  const paliers = [
    { ...opt, minBloc: 1, maxPauses: undefined, libelle: 'contraintes de forme' },
    { ...opt, minBloc: 1, maxPauses: undefined, congePrincipal: undefined, libelle: 'congé principal' },
    { ...opt, minBloc: 1, maxPauses: undefined, congePrincipal: undefined, maxParPause: undefined, libelle: 'plafond par pause' },
  ];
  for (const p of paliers) {
    r = optimiser(cal, p);
    if (r.faisable) return { ...r, assoupli: p.libelle };
  }
  return { faisable: false, pauses: [], totalRepos: 0, soldeUtilise: 0, assoupli: null, raison: 'impossible' };
}

/**
 * Beaucoup de plans atteignent le même total de repos (tous les vendredis de
 * l'année se valent). Parmi ces plans optimaux, celui qui répartit les pauses sur
 * toute la période est le plus agréable à vivre : on cherche donc, par dichotomie,
 * le plus grand espacement entre pauses qui conserve le score optimal.
 */
export function optimiserEtEtaler(cal, opt) {
  const base = optimiserAvecRepli(cal, opt);
  if (!base.faisable || base.pauses.length < 3) return base;

  const cible = base.totalRepos;
  const nbJoursTravailles = cal.days.filter((d) => d.travaille).length;
  let bas = 1;                                              // connu faisable
  let haut = Math.ceil(nbJoursTravailles / base.pauses.length) + 1; // probablement trop
  let meilleur = base;

  while (bas < haut) {
    const milieu = Math.ceil((bas + haut) / 2);
    const essai = optimiser(cal, { ...opt, espacementMin: milieu });
    if (essai.faisable && essai.totalRepos === cible) {
      meilleur = essai; bas = milieu;
    } else {
      haut = milieu - 1;
    }
  }
  return { ...meilleur, assoupli: base.assoupli ?? null };
}

/** Statistiques d'un plan, pour l'affichage. */
export function statistiques(cal, resultat, opt) {
  const { pauses, totalRepos, soldeUtilise } = resultat;
  const plusLongue = pauses.reduce((m, p) => Math.max(m, p.gain), 0);
  // Jours non travaillés sur la période de référence (base + congés posés).
  const poses = new Set(pauses.flatMap((p) => p.jours));
  let reposPeriode = 0, travailPeriode = 0;
  for (const d of cal.days) {
    if (!d.dansPeriode) continue;
    if (!d.travaille || poses.has(d.iso)) reposPeriode++; else travailPeriode++;
  }
  return {
    nbPauses: pauses.length,
    soldeUtilise,
    reliquat: Math.max(0, Math.floor(opt.solde) - soldeUtilise),
    totalRepos,
    rendement: soldeUtilise > 0 ? totalRepos / soldeUtilise : 0,
    plusLongue,
    reposPeriode,
    travailPeriode,
  };
}

/** Qualifie une pause pour l'affichage. */
export function typePause(gain) {
  if (gain >= 16) return { label: 'Grandes vacances', ton: 'or' };
  if (gain >= 9) return { label: 'Semaine et plus', ton: 'violet' };
  if (gain >= 5) return { label: 'Longue pause', ton: 'bleu' };
  return { label: 'Pont', ton: 'vert' };
}
