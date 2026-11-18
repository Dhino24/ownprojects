import test from 'node:test';
import assert from 'node:assert/strict';

import { paques, feriesFrance, feriesMap } from '../src/holidays.js';
import { isoDow, isoAdd, isoDiff, jourNom } from '../src/dates.js';
import {
  buildCalendar, optimiser, optimiserEtEtaler, analyser, statistiques, SEMAINE_STANDARD,
} from '../src/engine.js';

/* ------------------------------------------------------------------ fériés */

test('Pâques tombe aux dates connues', () => {
  assert.equal(paques(2027), '2027-03-28');
  assert.equal(paques(2026), '2026-04-05');
  assert.equal(paques(2025), '2025-04-20');
  assert.equal(paques(2024), '2024-03-31');
  assert.equal(paques(2000), '2000-04-23');
  assert.equal(paques(2038), '2038-04-25');
});

test('Pâques est toujours un dimanche, sur 200 ans', () => {
  for (let y = 1900; y < 2100; y++) assert.equal(isoDow(paques(y)), 0, `${y}`);
});

test('les 11 fériés français 2027 sont corrects', () => {
  const f = feriesFrance(2027);
  assert.equal(f.length, 11);
  assert.deepEqual(f.map((x) => x.iso), [
    '2027-01-01', '2027-03-29', '2027-05-01', '2027-05-06', '2027-05-08',
    '2027-05-17', '2027-07-14', '2027-08-15', '2027-11-01', '2027-11-11',
    '2027-12-25',
  ]);
  // Ascension = jeudi, lundi de Pentecôte = lundi : invariants du calendrier liturgique.
  assert.equal(jourNom(isoDow('2027-05-06')), 'jeudi');
  assert.equal(jourNom(isoDow('2027-05-17')), 'lundi');
  assert.equal(jourNom(isoDow('2027-03-29')), 'lundi');
});

test('Ascension et Pentecôte restent jeudi et lundi sur 200 ans', () => {
  for (let y = 1900; y < 2100; y++) {
    const p = paques(y);
    assert.equal(isoDow(isoAdd(p, 39)), 4, `ascension ${y}`);
    assert.equal(isoDow(isoAdd(p, 50)), 1, `pentecote ${y}`);
  }
});

/* ------------------------------------------------------- moteur : ponts simples */

function calendrier(debut, fin, opts = {}) {
  return buildCalendar({
    debut, fin,
    semaine: opts.semaine ?? SEMAINE_STANDARD,
    feries: opts.feries ?? feriesMap(+debut.slice(0, 4) - 1, +fin.slice(0, 4) + 1),
  });
}

test('un seul jour posé exploite un férié en semaine (mai 2027)', () => {
  // Mai 2027 offre deux ponts à 1 jour de valeur égale : vendredi 7 (après
  // l'Ascension, jeudi 6) et mardi 18 (après la Pentecôte, lundi 17).
  const cal = calendrier('2027-05-01', '2027-05-31');
  const r = optimiser(cal, { solde: 1, decompte: 'ouvres', minBloc: 1 });
  assert.equal(r.faisable, true);
  assert.equal(r.pauses.length, 1);
  assert.equal(r.pauses[0].jours.length, 1);
  assert.equal(r.totalRepos, 4);
  // À score égal, le moteur retient la pause la plus précoce.
  assert.equal(r.pauses[0].jours[0], '2027-05-07');
  assert.equal(r.pauses[0].debutRepos, '2027-05-06');
  assert.equal(r.pauses[0].finRepos, '2027-05-09');
});

test('un vendredi seul, sans férié, rend 3 jours de repos', () => {
  const cal = calendrier('2027-06-01', '2027-06-30');
  const r = optimiser(cal, { solde: 1, decompte: 'ouvres', minBloc: 1 });
  assert.equal(r.totalRepos, 3);
  assert.equal(isoDow(r.pauses[0].jours[0]) === 5 || isoDow(r.pauses[0].jours[0]) === 1, true);
});

test('deux pauses ne peuvent pas être collées (sinon elles fusionnent)', () => {
  const cal = calendrier('2027-06-01', '2027-06-30');
  const r = optimiser(cal, { solde: 2, decompte: 'ouvres', minBloc: 1, maxPauses: 2 });
  // Deux vendredis de semaines différentes : 3 + 3 = 6, mieux que vendredi+lundi collés (5).
  assert.equal(r.totalRepos, 6);
  assert.equal(r.pauses.length, 2);
  for (const p of r.pauses) assert.equal(p.jours.length, 1);
});

/* ------------------------------------------------- décompte en jours ouvrables */

test('en jours ouvrables, poser un vendredi coûte 2 et un lundi 1', () => {
  const cal = calendrier('2027-06-01', '2027-06-30');
  assert.equal(isoDow('2027-06-11'), 5);
  assert.equal(isoDow('2027-06-14'), 1);

  const vendredi = analyser(cal, ['2027-06-11'], 'ouvrables');
  assert.equal(vendredi.pauses[0].cout, 2); // vendredi + samedi
  assert.equal(vendredi.pauses[0].gain, 3); // ven → dim

  const lundi = analyser(cal, ['2027-06-14'], 'ouvrables');
  assert.equal(lundi.pauses[0].cout, 1);
  assert.equal(lundi.pauses[0].gain, 3);   // sam → lun

  // En jours ouvrés, les deux coûtent pareil : c'est tout l'intérêt du réglage.
  assert.equal(analyser(cal, ['2027-06-11'], 'ouvres').pauses[0].cout, 1);
  assert.equal(analyser(cal, ['2027-06-14'], 'ouvres').pauses[0].cout, 1);
});

test('en jours ouvrables, une semaine complète coûte 6', () => {
  const cal = calendrier('2027-06-01', '2027-06-30');
  const semaine = ['2027-06-14', '2027-06-15', '2027-06-16', '2027-06-17', '2027-06-18'];
  const r = analyser(cal, semaine, 'ouvrables');
  assert.equal(r.pauses.length, 1);
  assert.equal(r.pauses[0].cout, 6);
  assert.equal(r.pauses[0].gain, 9); // samedi 12 → dimanche 20
  assert.equal(analyser(cal, semaine, 'ouvres').pauses[0].cout, 5);
});

test('un férié dans la semaine ne se décompte pas', () => {
  // 1er → 5 novembre 2027 : lundi 1er est férié (Toussaint).
  const cal = calendrier('2027-11-01', '2027-11-30');
  const r = analyser(cal, ['2027-11-02', '2027-11-03', '2027-11-04', '2027-11-05'], 'ouvrables');
  assert.equal(r.pauses[0].cout, 5); // mar→sam, le lundi férié exclu
  assert.equal(r.pauses[0].gain, 9); // samedi 30 oct → dimanche 7 nov
  assert.equal(analyser(cal, ['2027-11-02', '2027-11-03', '2027-11-04', '2027-11-05'],
    'ouvres').pauses[0].cout, 4);
});

test('analyser recoupe exactement ce qu’annonce l’optimiseur', () => {
  const cal = calendrier('2027-01-01', '2027-12-31');
  for (const decompte of ['ouvres', 'ouvrables']) {
    for (const solde of [5, 25, 30]) {
      const r = optimiser(cal, { solde, decompte, minBloc: 3 });
      const a = analyser(cal, r.pauses.flatMap((p) => p.jours), decompte);
      assert.equal(a.pauses.length, r.pauses.length, `${decompte}/${solde}`);
      assert.equal(a.totalRepos, r.totalRepos, `${decompte}/${solde} repos`);
      assert.equal(a.soldeUtilise, r.soldeUtilise, `${decompte}/${solde} solde`);
    }
  }
});

/* --------------------------------------------------- contraintes utilisateur */

test('les jours imposés sont toujours posés', () => {
  const cal = calendrier('2027-01-01', '2027-12-31');
  const imposes = new Set(['2027-02-15', '2027-02-16', '2027-02-17', '2027-02-18', '2027-02-19']);
  const r = optimiser(cal, { solde: 25, decompte: 'ouvres', minBloc: 1, imposes });
  const poses = new Set(r.pauses.flatMap((p) => p.jours));
  for (const d of imposes) assert.equal(poses.has(d), true, `manque ${d}`);
});

test('les jours interdits ne sont jamais posés', () => {
  const cal = calendrier('2027-01-01', '2027-12-31');
  const interdits = new Set();
  for (let d = 1; d <= 31; d++) interdits.add(`2027-07-${String(d).padStart(2, '0')}`);
  const r = optimiser(cal, { solde: 25, decompte: 'ouvres', minBloc: 1, interdits });
  for (const p of r.pauses) for (const j of p.jours) assert.equal(j.slice(0, 7) === '2027-07', false);
});

test('hors période de référence, aucun jour n’est posé', () => {
  const cal = calendrier('2027-03-01', '2027-03-31');
  const r = optimiser(cal, { solde: 10, decompte: 'ouvres', minBloc: 1 });
  for (const p of r.pauses) for (const j of p.jours) {
    assert.equal(j >= '2027-03-01' && j <= '2027-03-31', true, j);
  }
});

test('minBloc écarte les pauses trop courtes', () => {
  const cal = calendrier('2027-01-01', '2027-12-31');
  const r = optimiser(cal, { solde: 25, decompte: 'ouvres', minBloc: 9 });
  for (const p of r.pauses) assert.equal(p.gain >= 9, true, `${p.debutRepos} gain=${p.gain}`);
});

test('maxPauses est respecté', () => {
  const cal = calendrier('2027-01-01', '2027-12-31');
  const r = optimiser(cal, { solde: 25, decompte: 'ouvres', minBloc: 1, maxPauses: 4 });
  assert.equal(r.pauses.length <= 4, true);
});

test('le congé principal est garanti dans la fenêtre demandée', () => {
  const cal = calendrier('2027-01-01', '2027-12-31');
  const r = optimiser(cal, {
    solde: 25, decompte: 'ouvres', minBloc: 4,
    congePrincipal: { min: 10, debut: '2027-05-01', fin: '2027-10-31' },
  });
  assert.equal(r.faisable, true);
  const ok = r.pauses.some((p) => p.cout >= 10
    && p.debutPose >= '2027-05-01' && p.finPose <= '2027-10-31');
  assert.equal(ok, true, 'aucune pause de 10 jours entre mai et octobre');
});

test('le solde n’est jamais dépassé', () => {
  const cal = calendrier('2027-01-01', '2027-12-31');
  for (const solde of [1, 5, 12, 25, 30, 47]) {
    for (const decompte of ['ouvres', 'ouvrables']) {
      const r = optimiser(cal, { solde, decompte, minBloc: 1 });
      assert.equal(r.soldeUtilise <= solde, true, `${solde}/${decompte}`);
    }
  }
});

test('les pauses sont disjointes, ordonnées, et séparées par du travail', () => {
  const cal = calendrier('2027-01-01', '2027-12-31');
  const r = optimiser(cal, { solde: 25, decompte: 'ouvres', minBloc: 3 });
  for (let i = 1; i < r.pauses.length; i++) {
    const prec = r.pauses[i - 1], cur = r.pauses[i];
    assert.equal(isoDiff(prec.finRepos, cur.debutRepos) >= 2, true,
      `pauses collées : ${prec.finRepos} / ${cur.debutRepos}`);
  }
});

/* --------------------------------------- vérification par recherche exhaustive */

/** Somme des longueurs des blocs de repos contenant au moins un congé posé. */
function gainBrut(cal, choisis) {
  const d = cal.days;
  const pose = new Set(choisis);
  let total = 0, k = 0;
  while (k < d.length) {
    const repos = !d[k].travaille || pose.has(d[k].iso);
    if (!repos) { k++; continue; }
    let j = k, aDuConge = false;
    while (j < d.length && (!d[j].travaille || pose.has(d[j].iso))) {
      if (pose.has(d[j].iso)) aDuConge = true;
      j++;
    }
    // Les blocs touchant un bord de fenêtre sont tronqués : on les ignore,
    // comme le moteur qui exige un jour travaillé de part et d'autre.
    if (aDuConge && k > 0 && j < d.length) total += j - k;
    k = j;
  }
  return total;
}

function* combinaisons(arr, n) {
  if (n === 0) { yield []; return; }
  for (let i = 0; i <= arr.length - n; i++) {
    for (const reste of combinaisons(arr.slice(i + 1), n - 1)) yield [arr[i], ...reste];
  }
}

test('le moteur atteint l’optimum exact (comparaison exhaustive, avril 2027)', () => {
  const cal = calendrier('2027-04-01', '2027-04-30');
  const poseables = cal.days.filter((d) => d.travaille && d.dansPeriode).map((d) => d.iso);
  assert.equal(poseables.length, 22);

  for (const solde of [1, 2, 3]) {
    let meilleur = 0;
    for (const c of combinaisons(poseables, solde)) {
      meilleur = Math.max(meilleur, gainBrut(cal, c));
    }
    const r = optimiser(cal, { solde, decompte: 'ouvres', minBloc: 1 });
    assert.equal(r.totalRepos, meilleur, `solde=${solde} : moteur ${r.totalRepos} vs brut ${meilleur}`);
  }
});

test('le moteur atteint l’optimum exact autour d’un pont (mai 2027)', () => {
  // Mai 2027 : 1er et 8 un samedi, Ascension jeudi 6, Pentecôte lundi 17.
  const cal = calendrier('2027-05-01', '2027-05-31');
  const poseables = cal.days.filter((d) => d.travaille && d.dansPeriode).map((d) => d.iso);
  for (const solde of [1, 2, 3]) {
    let meilleur = 0;
    for (const c of combinaisons(poseables, solde)) {
      meilleur = Math.max(meilleur, gainBrut(cal, c));
    }
    const r = optimiser(cal, { solde, decompte: 'ouvres', minBloc: 1 });
    assert.equal(r.totalRepos, meilleur, `solde=${solde}`);
  }
});

test('le plan reconstruit correspond bien au score annoncé', () => {
  const cal = calendrier('2027-01-01', '2027-12-31');
  for (const solde of [3, 10, 25]) {
    const r = optimiser(cal, { solde, decompte: 'ouvres', minBloc: 1 });
    const poses = r.pauses.flatMap((p) => p.jours);
    assert.equal(gainBrut(cal, poses), r.totalRepos, `solde=${solde}`);
    assert.equal(poses.length, r.soldeUtilise);
    assert.equal(new Set(poses).size, poses.length, 'doublons');
  }
});

/* ------------------------------------------------------------ cas dégradés */

test('solde nul donne un plan vide mais faisable', () => {
  const cal = calendrier('2027-01-01', '2027-12-31');
  const r = optimiser(cal, { solde: 0, decompte: 'ouvres', minBloc: 1 });
  assert.equal(r.faisable, true);
  assert.equal(r.pauses.length, 0);
  assert.equal(r.totalRepos, 0);
});

test('un congé principal impossible est signalé non faisable', () => {
  const cal = calendrier('2027-01-01', '2027-12-31');
  const r = optimiser(cal, {
    solde: 5, decompte: 'ouvres', minBloc: 1,
    congePrincipal: { min: 10, debut: '2027-05-01', fin: '2027-10-31' },
  });
  assert.equal(r.faisable, false);
});

test('une semaine de travail atypique (mardi-samedi) est prise en compte', () => {
  const semaine = [false, false, true, true, true, true, true]; // mar → sam
  const cal = calendrier('2027-06-01', '2027-06-30', { semaine });
  const r = optimiser(cal, { solde: 1, decompte: 'ouvres', minBloc: 1 });
  const jour = r.pauses[0].jours[0];
  // Les jours de repos de base sont dimanche et lundi : le meilleur pont est
  // un samedi (avant dim+lun) ou un mardi (après dim+lun).
  assert.equal([2, 6].includes(isoDow(jour)), true, `${jour} dow=${isoDow(jour)}`);
  assert.equal(r.totalRepos, 3);
});

/* ------------------------------------------------- espacement et étalement */

test('espacementMin impose un intervalle de travail entre deux pauses', () => {
  const cal = calendrier('2027-01-01', '2027-12-31');
  for (const ecart of [1, 3, 8]) {
    const r = optimiser(cal, { solde: 20, decompte: 'ouvres', minBloc: 3, espacementMin: ecart });
    const travailles = cal.days.filter((d) => d.travaille).map((d) => d.iso);
    const rang = new Map(travailles.map((iso, i) => [iso, i]));
    for (let i = 1; i < r.pauses.length; i++) {
      const finPrec = rang.get(r.pauses[i - 1].finPose);
      const debutCur = rang.get(r.pauses[i].debutPose);
      assert.equal(debutCur - finPrec - 1 >= ecart, true,
        `écart ${ecart} : ${debutCur - finPrec - 1} jours travaillés seulement`);
    }
  }
});

test('un espacement plus large ne peut pas améliorer le score', () => {
  const cal = calendrier('2027-01-01', '2027-12-31');
  let precedent = Infinity;
  for (const ecart of [1, 2, 5, 10, 20]) {
    const r = optimiser(cal, { solde: 25, decompte: 'ouvres', minBloc: 3, espacementMin: ecart });
    assert.equal(r.totalRepos <= precedent, true, `écart ${ecart}`);
    precedent = r.totalRepos;
  }
});

test('l’étalement conserve exactement le score optimal', () => {
  const cal = calendrier('2027-01-01', '2027-12-31');
  for (const opt of [
    { solde: 25, decompte: 'ouvres', minBloc: 3 },
    { solde: 30, decompte: 'ouvrables', minBloc: 4, maxPauses: 9 },
    { solde: 12, decompte: 'ouvres', minBloc: 5 },
  ]) {
    const brut = optimiser(cal, opt);
    const etale = optimiserEtEtaler(cal, opt);
    assert.equal(etale.totalRepos, brut.totalRepos, JSON.stringify(opt));
    assert.equal(etale.soldeUtilise <= opt.solde, true);
  }
});

test('l’étalement répartit vraiment les pauses sur l’année', () => {
  const cal = calendrier('2027-01-01', '2027-12-31');
  const opt = { solde: 25, decompte: 'ouvres', minBloc: 3, maxParPause: 20 };
  const brut = optimiser(cal, opt);
  const etale = optimiserEtEtaler(cal, opt);
  const moisTouches = (r) => new Set(r.pauses.map((p) => p.debutRepos.slice(0, 7))).size;
  assert.equal(moisTouches(etale) > moisTouches(brut), true,
    `étalé ${moisTouches(etale)} mois vs brut ${moisTouches(brut)}`);
  // Le plus long « trou sans pause » doit se réduire.
  const plusGrandTrou = (r) => Math.max(...r.pauses.slice(1).map(
    (p, i) => isoDiff(r.pauses[i].finRepos, p.debutRepos)));
  assert.equal(plusGrandTrou(etale) < plusGrandTrou(brut), true,
    `trou étalé ${plusGrandTrou(etale)} vs brut ${plusGrandTrou(brut)}`);
});

test('les jours imposés survivent à l’étalement', () => {
  const cal = calendrier('2027-01-01', '2027-12-31');
  const imposes = new Set(['2027-09-06', '2027-09-07', '2027-09-08', '2027-09-09', '2027-09-10']);
  const r = optimiserEtEtaler(cal, { solde: 25, decompte: 'ouvres', minBloc: 3, imposes });
  const poses = new Set(r.pauses.flatMap((p) => p.jours));
  for (const d of imposes) assert.equal(poses.has(d), true, `manque ${d}`);
});

/* -------------------------------------------------------------- statistiques */

test('les statistiques sont cohérentes avec le plan', () => {
  const cal = calendrier('2027-01-01', '2027-12-31');
  const opt = { solde: 25, decompte: 'ouvres', minBloc: 3 };
  const r = optimiserEtEtaler(cal, opt);
  const st = statistiques(cal, r, opt);
  assert.equal(st.nbPauses, r.pauses.length);
  assert.equal(st.soldeUtilise + st.reliquat, 25);
  assert.equal(st.totalRepos, r.totalRepos);
  assert.equal(st.plusLongue, Math.max(...r.pauses.map((p) => p.gain)));
  // 2027 : 365 jours, et tout jour de la période est soit repos soit travail.
  assert.equal(st.reposPeriode + st.travailPeriode, 365);
  // Sans congés : 104 jours de week-end + 7 fériés en semaine = 111 jours de repos.
  const vide = optimiser(cal, { solde: 0, decompte: 'ouvres' });
  assert.equal(statistiques(cal, vide, { solde: 0 }).reposPeriode, 111);
});

test('le repli signale l’assouplissement des contraintes', () => {
  const cal = calendrier('2027-01-01', '2027-12-31');
  // Congé principal de 10 jours demandé avec seulement 5 jours de solde.
  const r = optimiserEtEtaler(cal, {
    solde: 5, decompte: 'ouvres', minBloc: 4,
    congePrincipal: { min: 10, debut: '2027-05-01', fin: '2027-10-31' },
  });
  assert.equal(r.faisable, true);
  assert.equal(typeof r.assoupli, 'string');
});
