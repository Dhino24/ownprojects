// Pont — interface. Aucune dépendance, aucun appel réseau : tout est calculé sur l'appareil.

import { feriesMap, feriesFrance } from './holidays.js';
import {
  buildCalendar, optimiserEtEtaler, optimiserAvecRepli, statistiques, typePause,
  SEMAINE_STANDARD,
} from './engine.js';
import { versIcs, versTexte, uniteJours, nombreFr } from './ics.js';
import {
  isoAdd, isoDow, isoYear, isoMonth, isoDay, moisNom, moisCourt, formatPlage, formatLong,
  numeroJour, jourNom, jourLettre, utcToIso,
} from './dates.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const CLE = 'pont.etat.v2';
const AUJOURDHUI = utcToIso(Date.now());

// Dans un cadre bac à sable (aperçu d'artefact, intégration), le navigateur refuse
// les téléchargements lancés par la page. On bascule alors sur le presse-papiers.
const EN_CADRE = (() => { try { return window.self !== window.top; } catch { return true; } })();

/* ------------------------------------------------------------------- modes */

const MODES = {
  rendement: {
    nom: 'Rendement maximum',
    pitch: 'Le plus de repos par jour posé. Beaucoup de ponts et de week-ends de 3 ou 4 jours.',
    params: { minBloc: 3, maxPauses: 0, congePrincipal: false },
  },
  equilibre: {
    nom: 'Équilibré',
    pitch: 'De vraies coupures réparties sur l’année, dont deux semaines l’été.',
    params: { minBloc: 4, maxPauses: 9, congePrincipal: true },
  },
  vacances: {
    nom: 'Grandes vacances',
    pitch: 'Uniquement des pauses d’au moins neuf jours de repos d’affilée.',
    params: { minBloc: 9, maxPauses: 0, congePrincipal: true },
  },
  unique: {
    nom: 'Une seule grande coupure',
    pitch: 'Tout en une fois, pour la plus longue pause possible.',
    params: { minBloc: 1, maxPauses: 1, congePrincipal: false },
  },
};

/* ------------------------------------------------------------------- état */

function etatParDefaut(annee = 2027) {
  return {
    annee,
    debut: `${annee}-01-01`,
    fin: `${annee}-12-31`,
    decompte: 'ouvres',
    solde: 25,
    bonus: 0,
    mode: 'equilibre',
    semaine: [...SEMAINE_STANDARD],
    minBloc: 4,
    maxPauses: 9,
    etaler: true,
    congePrincipal: true,
    cpDebut: `${annee}-05-01`,
    cpFin: `${annee}-10-31`,
    plafond: true,
    imposes: [],
    interdits: [],
    vue: 'plan',
  };
}

function charger() {
  try {
    const brut = localStorage.getItem(CLE);
    if (!brut) return etatParDefaut();
    const sauve = JSON.parse(brut);
    return { ...etatParDefaut(sauve.annee || 2027), ...sauve };
  } catch { return etatParDefaut(); }
}

function sauver() {
  try { localStorage.setItem(CLE, JSON.stringify(etat)); } catch { /* mode privé */ }
}

let etat = charger();
let cal = null, resultat = null, stats = null, feries = null;

/* ----------------------------------------------------------------- calcul */

/** Valeurs légales du plafond de congé continu et du congé principal. */
const legal = (decompte) => decompte === 'ouvrables'
  ? { plafond: 24, principal: 12 }
  : { plafond: 20, principal: 10 };

function optionsCourantes() {
  const l = legal(etat.decompte);
  return {
    solde: Math.max(0, (+etat.solde || 0) + (+etat.bonus || 0)),
    decompte: etat.decompte,
    minBloc: Math.max(1, +etat.minBloc || 1),
    maxPauses: +etat.maxPauses > 0 ? +etat.maxPauses : undefined,
    maxParPause: etat.plafond ? l.plafond : undefined,
    congePrincipal: etat.congePrincipal
      ? { min: l.principal, debut: etat.cpDebut, fin: etat.cpFin }
      : null,
    imposes: new Set(etat.imposes),
    interdits: new Set(etat.interdits),
  };
}

function recalculer() {
  feries = feriesMap(isoYear(etat.debut) - 1, isoYear(etat.fin) + 1);
  cal = buildCalendar({
    debut: etat.debut, fin: etat.fin, semaine: etat.semaine, feries,
  });
  const opt = optionsCourantes();
  resultat = etat.etaler ? optimiserEtEtaler(cal, opt) : optimiserAvecRepli(cal, opt);
  stats = statistiques(cal, resultat, opt);
  rendre();
}

let minuteur = null;
function recalculerBientot() {
  document.body.classList.add('calcul');
  clearTimeout(minuteur);
  minuteur = setTimeout(() => {
    recalculer();
    document.body.classList.remove('calcul');
    sauver();
  }, 90);
}

/* ------------------------------------------------------------------ rendu */

function rendre() {
  rendreHero();
  rendreAlerte();
  rendrePauses();
  rendreMillesime();
  rendreCalendrier();
  rendreCompteur();
  $('#chip-periode').textContent = etat.debut.slice(0, 4) === etat.fin.slice(0, 4)
    ? etat.debut.slice(0, 4)
    : `${etat.debut.slice(0, 4)}–${etat.fin.slice(2, 4)}`;
}

function rendreHero() {
  $('#st-repos').textContent = stats.totalRepos;
  const u = uniteJours(stats.soldeUtilise, etat.decompte);
  $('#st-sous').innerHTML = stats.soldeUtilise > 0
    ? `pour <b>${u}</b> posés — soit <b>×${nombreFr(stats.rendement, 1)}</b> de repos par jour de congé`
    : 'aucun congé posé : règle ton solde dans les réglages';

  const puces = [
    `<span class="puce"><b>${stats.nbPauses}</b> pause${stats.nbPauses > 1 ? 's' : ''}</span>`,
    `<span class="puce">plus longue&nbsp;: <b>${stats.plusLongue}</b> j</span>`,
    `<span class="puce"><b>${stats.reposPeriode}</b> j non travaillés sur l'année</span>`,
  ];
  if (stats.reliquat > 0) {
    puces.push(`<span class="puce alerte"><b>${stats.reliquat}</b> j non utilisé${stats.reliquat > 1 ? 's' : ''}</span>`);
  }
  $('#st-puces').innerHTML = puces.join('');
}

function rendreAlerte() {
  const box = $('#alerte-contraintes');
  if (!resultat.faisable) {
    box.innerHTML = `<div class="carte" style="border-color:#6b2b2f">
      <p><b style="color:var(--interdit)">Aucun plan possible.</b> Tes contraintes s'excluent :
      les jours imposés tombent probablement dans une zone interdite, ou dépassent ton solde.
      Allège le calendrier ou augmente le solde.</p></div>`;
    return;
  }
  const parts = [];
  if (resultat.assoupli) {
    parts.push(`<div class="carte" style="border-color:#6b4a1f">
      <p><b style="color:var(--ferie)">Contrainte assouplie.</b> Impossible de respecter
      «&nbsp;${resultat.assoupli}&nbsp;» avec ce solde et ces jours imposés : le plan ci-dessous
      s'en affranchit.</p></div>`);
  }
  if (stats.reliquat > 0 && resultat.faisable) {
    const pourquoi = etat.mode === 'unique'
      ? 'le mode «&nbsp;une seule grande coupure&nbsp;» plafonne à une pause'
      : `aucune pause de ${etat.minBloc}&nbsp;jours ou plus ne rentre dans ce qu'il reste`;
    parts.push(`<div class="carte note"><p><b>${stats.reliquat}
      jour${stats.reliquat > 1 ? 's' : ''} non placé${stats.reliquat > 1 ? 's' : ''}</b> :
      ${pourquoi}. Baisse «&nbsp;pause la plus courte acceptée&nbsp;» ou le nombre maximal de
      pauses dans les réglages fins.</p></div>`);
  }
  box.innerHTML = parts.join('');
}

function feriesDuBloc(p) {
  const out = [];
  for (let d = p.debutRepos; d <= p.finRepos; d = isoAdd(d, 1)) {
    const nom = feries.get(d);
    if (nom) out.push({ iso: d, nom });
  }
  return out;
}

function rendrePauses() {
  const box = $('#liste-pauses');
  if (!resultat.pauses.length) {
    box.innerHTML = `<p class="vide-msg">Pas encore de pause.<br>
      Renseigne ton solde de congés dans les réglages.</p>`;
    return;
  }
  box.innerHTML = resultat.pauses.map((p, i) => {
    const t = typePause(p.gain);
    const f = feriesDuBloc(p);
    return `<details class="carte pause">
      <summary>
        <div class="pause-nb"><strong>${p.gain}</strong><span>jours</span></div>
        <div class="pause-txt">
          <div class="pause-quand">${formatPlage(p.debutRepos, p.finRepos)}<span class="etiq ${t.ton}">${t.label}</span></div>
          <div class="pause-cout">${uniteJours(p.cout, etat.decompte)} à poser · rendement ×${nombreFr(p.gain / p.cout, 1)}</div>
        </div>
        <svg class="pause-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 6l6 6-6 6" stroke-linecap="round"/></svg>
      </summary>
      <div class="pause-detail">
        <dl>
          <dt>Repos</dt><dd>du ${formatLong(p.debutRepos)} au ${formatLong(p.finRepos)}</dd>
          <dt>Décompté</dt><dd>${uniteJours(p.cout, etat.decompte)}</dd>
          ${f.length ? `<dt>Fériés captés</dt><dd>${f.map((x) => `<span class="ferie-nom">${x.nom}</span> (${numeroJour(isoDay(x.iso))} ${moisNom(isoMonth(x.iso))})`).join('<br>')}</dd>` : ''}
        </dl>
        <div style="margin-top:12px;color:var(--txt-3);font-size:12.5px">Jours de congé à poser</div>
        <ul>${p.jours.map((j) => `<li>${formatLong(j)}</li>`).join('')}</ul>
      </div>
    </details>`;
  }).join('');
}

function rendreMillesime() {
  const liste = [];
  for (let y = isoYear(etat.debut); y <= isoYear(etat.fin); y++) {
    for (const f of feriesFrance(y)) {
      if (f.iso >= etat.debut && f.iso <= etat.fin) liste.push(f);
    }
  }
  const perdus = liste.filter((f) => !etat.semaine[isoDow(f.iso)]);
  const reposGratuit = cal.days.filter((d) => d.dansPeriode && !d.travaille).length;
  const annee = etat.debut.slice(0, 4);

  // Ce que chaque férié permet, selon le jour de la semaine où il tombe.
  const avis = (iso) => {
    const d = isoDow(iso);
    if (!etat.semaine[d]) return { txt: 'perdu', ton: 'var(--txt-3)' };
    const veille = etat.semaine[(d + 6) % 7];
    const lendemain = etat.semaine[(d + 1) % 7];
    if (!veille || !lendemain) return { txt: '3 j offerts', ton: 'var(--impose)' };
    const versAvant = !etat.semaine[(d + 5) % 7];   // un seul jour à poser avant
    const versApres = !etat.semaine[(d + 2) % 7];   // un seul jour à poser après
    if (versAvant || versApres) return { txt: '1 j → 4 j', ton: 'var(--repos)' };
    return { txt: '2 j → 5 j', ton: 'var(--ferie)' };
  };

  $('#millesime').innerHTML = `
    <p><b>${liste.length} jours fériés</b> en ${annee}, dont
      <b style="color:${perdus.length ? 'var(--interdit)' : 'var(--repos)'}">${perdus.length}</b>
      ${perdus.length > 1 ? 'tombent' : 'tombe'} un jour que tu ne travailles pas
      ${perdus.length ? '— autant de repos perdu.' : '.'}</p>
    <p>Sans poser le moindre congé, tu as déjà <b>${reposGratuit} jours</b> de repos
      (week-ends et fériés).</p>
    <table style="width:100%;border-collapse:collapse;margin-top:12px;font-size:12.5px">
      <caption style="caption-side:top;text-align:left;color:var(--txt-3);font-size:11.5px;padding-bottom:6px">
        Ce que chaque férié permet d'obtenir
      </caption>
      ${liste.map((f) => {
        const a = avis(f.iso);
        return `<tr style="border-top:1px solid var(--line)">
          <td style="padding:5px 0;color:var(--txt-2);white-space:nowrap">${jourNom(isoDow(f.iso)).slice(0, 3)}. ${numeroJour(isoDay(f.iso))} ${moisCourt(isoMonth(f.iso))}</td>
          <td style="padding:5px 8px;color:var(--txt)">${f.nom}</td>
          <td style="padding:5px 0;text-align:right;color:${a.ton};white-space:nowrap;font-weight:600">${a.txt}</td>
        </tr>`;
      }).join('')}
    </table>`;
}

function etatsDesJours() {
  const poses = new Set(resultat.pauses.flatMap((p) => p.jours));
  const blocs = new Set();
  for (const p of resultat.pauses) {
    for (let d = p.debutRepos; d <= p.finRepos; d = isoAdd(d, 1)) blocs.add(d);
  }
  const imposes = new Set(etat.imposes);
  const interdits = new Set(etat.interdits);
  return { poses, blocs, imposes, interdits };
}

function rendreCalendrier() {
  const { poses, blocs, imposes, interdits } = etatsDesJours();
  const parIso = new Map(cal.days.map((d) => [d.iso, d]));

  // Mois couverts par la période de référence.
  const mois = [];
  let curseur = `${etat.debut.slice(0, 7)}-01`;
  const dernier = `${etat.fin.slice(0, 7)}-01`;
  let garde = 0;
  while (curseur <= dernier && garde++ < 400) {
    mois.push(curseur);
    const y = isoYear(curseur), m = isoMonth(curseur);
    curseur = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  }

  const entetes = [1, 2, 3, 4, 5, 6, 0]
    .map((d) => `<div class="jour-nom" aria-hidden="true">${jourLettre(d)}</div>`).join('');

  $('#calendrier').innerHTML = mois.map((premier) => {
    const y = isoYear(premier), m = isoMonth(premier);
    const nbJours = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const decalage = (isoDow(premier) + 6) % 7; // grille qui commence le lundi

    let posesMois = 0;
    const cases = [];
    for (let k = 0; k < decalage; k++) cases.push('<div class="jour vide"></div>');
    for (let jour = 1; jour <= nbJours; jour++) {
      const iso = `${y}-${String(m).padStart(2, '0')}-${String(jour).padStart(2, '0')}`;
      const d = parIso.get(iso);
      const cls = ['jour'];
      const titres = [];
      if (!d || !d.dansPeriode) cls.push('hors');
      if (d) {
        if (d.weekend) cls.push('we');
        if (d.ferie) { cls.push('ferie'); titres.push(d.ferie); }
        if (blocs.has(iso)) cls.push('bloc');
        if (poses.has(iso)) { cls.push('pose'); posesMois++; titres.push('congé posé'); }
        if (imposes.has(iso)) { cls.push('impose'); titres.push('imposé'); }
        if (interdits.has(iso)) { cls.push('interdit'); titres.push('interdit'); }
        if (d.travaille && d.dansPeriode) cls.push('cliquable');
      }
      if (iso === AUJOURDHUI) cls.push('aujourdhui');
      const t = titres.length ? ` title="${titres.join(' · ')}"` : '';
      const label = `${formatLong(iso)}${titres.length ? ' — ' + titres.join(', ') : ''}`;
      cases.push(`<button type="button" class="${cls.join(' ')}" data-iso="${iso}"${t}
        aria-label="${label}">${jour}</button>`);
    }

    return `<div class="mois">
      <div class="mois-nom">${moisNom(m)} ${y}${posesMois ? `<small>${posesMois} posé${posesMois > 1 ? 's' : ''}</small>` : ''}</div>
      <div class="grille">${entetes}${cases.join('')}</div>
    </div>`;
  }).join('');
}

function rendreCompteur() {
  const n = etat.imposes.length + etat.interdits.length;
  $('#compteur-contraintes').innerHTML = n === 0 ? '' : `
    <div class="carte note" style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
      <p style="flex:1">
        ${etat.imposes.length ? `<b style="color:var(--impose)">${etat.imposes.length}</b> imposé${etat.imposes.length > 1 ? 's' : ''}` : ''}
        ${etat.imposes.length && etat.interdits.length ? ' · ' : ''}
        ${etat.interdits.length ? `<b style="color:var(--interdit)">${etat.interdits.length}</b> interdit${etat.interdits.length > 1 ? 's' : ''}` : ''}
      </p>
      <button class="btn discret" id="btn-vider" style="padding:7px 12px">Effacer</button>
    </div>`;
  const b = $('#btn-vider');
  if (b) b.addEventListener('click', () => {
    etat.imposes = []; etat.interdits = [];
    recalculerBientot();
    toast('Contraintes effacées');
  });
}

/* ------------------------------------------------------- synchro réglages */

function syncReglages() {
  $$('[data-decompte]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.decompte === etat.decompte));
  });
  const l = legal(etat.decompte);
  $('#aide-decompte').innerHTML = etat.decompte === 'ouvrables'
    ? `Le samedi compte, même si tu ne travailles pas : <b>poser un vendredi coûte 2 jours</b>
       (vendredi + samedi), un lundi n'en coûte qu'un. Solde légal plein : 30 jours.`
    : `Seuls les jours réellement travaillés sont décomptés. Solde légal plein : 25 jours.`;
  $('#aide-principal').textContent =
    `Au moins ${l.principal} jours d'affilée dans la fenêtre choisie`;
  $('#aide-plafond').textContent = `Pas plus de ${l.plafond} jours de congé d'un seul tenant`;

  $('#in-solde').value = etat.solde;
  $('#in-bonus').value = etat.bonus;
  $('#in-annee').value = etat.annee;
  $('#in-debut').value = etat.debut;
  $('#in-fin').value = etat.fin;
  $('#in-minbloc').value = etat.minBloc;
  $('#v-minbloc').textContent = etat.minBloc;
  $('#in-maxpauses').value = etat.maxPauses;
  $('#in-etaler').checked = etat.etaler;
  $('#in-principal').checked = etat.congePrincipal;
  $('#in-cp-debut').value = etat.cpDebut;
  $('#in-cp-fin').value = etat.cpFin;
  $('#in-plafond').checked = etat.plafond;

  $$('#modes .mode').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.mode === etat.mode));
  });
  $$('#semaine button').forEach((b) => {
    b.setAttribute('aria-pressed', String(!!etat.semaine[+b.dataset.dow]));
  });
}

/** Le mode courant correspond-il encore aux réglages fins ? Sinon : « personnalisé ». */
function verifierMode() {
  const p = MODES[etat.mode]?.params;
  if (!p) return;
  const colle = +etat.minBloc === p.minBloc
    && +etat.maxPauses === p.maxPauses
    && etat.congePrincipal === p.congePrincipal;
  if (!colle) etat.mode = '';
}

/* ------------------------------------------------------------- événements */

/** Remplace confirm(), refusé dans les cadres bac à sable. */
function demander() {
  return new Promise((resoudre) => {
    const voile = $('#voile');
    voile.hidden = false;
    const fin = (reponse) => {
      voile.hidden = true;
      $('#dlg-oui').onclick = null;
      $('#dlg-non').onclick = null;
      voile.onclick = null;
      resoudre(reponse);
    };
    $('#dlg-oui').onclick = () => fin(true);
    $('#dlg-non').onclick = () => fin(false);
    voile.onclick = (e) => { if (e.target === voile) fin(false); };
    $('#dlg-oui').focus();
  });
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('vu');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('vu'), 2200);
}

function changerVue(nom) {
  etat.vue = nom;
  $$('.vue').forEach((v) => v.classList.toggle('actif', v.id === `vue-${nom}`));
  $$('.onglets button').forEach((b) => {
    if (b.dataset.vue === nom) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  window.scrollTo({ top: 0, behavior: 'instant' });
  sauver();
}

function appliquerAnnee(y) {
  y = Math.min(2100, Math.max(2000, Math.round(y) || 2027));
  etat.annee = y;
  etat.debut = `${y}-01-01`;
  etat.fin = `${y}-12-31`;
  etat.cpDebut = `${y}-05-01`;
  etat.cpFin = `${y}-10-31`;
  etat.imposes = []; etat.interdits = [];
}

function brancher() {
  // Onglets
  $$('.onglets button').forEach((b) => {
    b.addEventListener('click', () => changerVue(b.dataset.vue));
  });

  // Modes
  $('#modes').innerHTML = Object.entries(MODES).map(([cle, m]) => `
    <button class="mode" data-mode="${cle}" aria-pressed="false">
      <strong>${m.nom}</strong><span>${m.pitch}</span>
    </button>`).join('');
  $$('#modes .mode').forEach((b) => b.addEventListener('click', () => {
    etat.mode = b.dataset.mode;
    Object.assign(etat, MODES[b.dataset.mode].params);
    syncReglages(); recalculerBientot();
  }));

  // Jours de la semaine (lundi d'abord)
  $('#semaine').innerHTML = [1, 2, 3, 4, 5, 6, 0].map((d) => `
    <button type="button" data-dow="${d}" aria-pressed="false"
      aria-label="${jourNom(d)}">${jourLettre(d)}</button>`).join('');
  $$('#semaine button').forEach((b) => b.addEventListener('click', () => {
    const d = +b.dataset.dow;
    const copie = [...etat.semaine];
    copie[d] = !copie[d];
    if (copie.some(Boolean)) etat.semaine = copie; else toast('Il faut au moins un jour travaillé');
    syncReglages(); recalculerBientot();
  }));

  // Décompte
  $$('[data-decompte]').forEach((b) => b.addEventListener('click', () => {
    if (etat.decompte === b.dataset.decompte) return;
    const avant = etat.decompte;
    etat.decompte = b.dataset.decompte;
    // Un solde encore « par défaut » suit la convention : 25 ouvrés ↔ 30 ouvrables.
    if (avant === 'ouvres' && +etat.solde === 25) etat.solde = 30;
    else if (avant === 'ouvrables' && +etat.solde === 30) etat.solde = 25;
    syncReglages(); recalculerBientot();
  }));

  // Steppers
  const stepper = (sel, champ, min, max, apres) => {
    $$(sel).forEach((b) => b.addEventListener('click', () => {
      const pas = +(b.dataset.pas ?? b.dataset.pasBonus ?? b.dataset.pasAnnee);
      const v = Math.min(max, Math.max(min, (+etat[champ] || 0) + pas));
      if (apres) apres(v); else etat[champ] = v;
      syncReglages(); recalculerBientot();
    }));
  };
  stepper('[data-pas]', 'solde', 0, 80);
  stepper('[data-pas-bonus]', 'bonus', 0, 40);
  stepper('[data-pas-annee]', 'annee', 2000, 2100, appliquerAnnee);

  const nombre = (sel, champ, min, max, apres) => {
    $(sel).addEventListener('input', () => {
      const v = Math.min(max, Math.max(min, Math.round(+$(sel).value) || 0));
      if (apres) apres(v); else etat[champ] = v;
      if (champ === 'minBloc' || champ === 'maxPauses') verifierMode();
      syncReglages(); recalculerBientot();
    });
  };
  nombre('#in-solde', 'solde', 0, 80);
  nombre('#in-bonus', 'bonus', 0, 40);
  nombre('#in-maxpauses', 'maxPauses', 0, 40);
  $('#in-annee').addEventListener('change', () => {
    appliquerAnnee(+$('#in-annee').value);
    syncReglages(); recalculerBientot();
  });

  $('#in-minbloc').addEventListener('input', () => {
    etat.minBloc = +$('#in-minbloc').value;
    $('#v-minbloc').textContent = etat.minBloc;
    verifierMode();
    $$('#modes .mode').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === etat.mode)));
    recalculerBientot();
  });

  // Dates
  const dateChamp = (sel, champ) => $(sel).addEventListener('change', () => {
    const v = $(sel).value;
    if (!v) return;
    etat[champ] = v;
    if (etat.debut > etat.fin) { const t = etat.debut; etat.debut = etat.fin; etat.fin = t; }
    syncReglages(); recalculerBientot();
  });
  dateChamp('#in-debut', 'debut');
  dateChamp('#in-fin', 'fin');
  dateChamp('#in-cp-debut', 'cpDebut');
  dateChamp('#in-cp-fin', 'cpFin');

  // Bascules
  const bascule = (sel, champ) => $(sel).addEventListener('change', () => {
    etat[champ] = $(sel).checked;
    if (champ === 'congePrincipal') verifierMode();
    syncReglages(); recalculerBientot();
  });
  bascule('#in-etaler', 'etaler');
  bascule('#in-principal', 'congePrincipal');
  bascule('#in-plafond', 'plafond');

  // Calendrier : appui sur un jour → imposé → interdit → normal
  $('#calendrier').addEventListener('click', (e) => {
    const b = e.target.closest('.jour.cliquable');
    if (!b) return;
    const iso = b.dataset.iso;
    const iImp = etat.imposes.indexOf(iso);
    const iInt = etat.interdits.indexOf(iso);
    if (iImp === -1 && iInt === -1) {
      etat.imposes.push(iso);
      toast(`${formatLong(iso)} : congé imposé`);
    } else if (iImp !== -1) {
      etat.imposes.splice(iImp, 1);
      etat.interdits.push(iso);
      toast(`${formatLong(iso)} : interdit`);
    } else {
      etat.interdits.splice(iInt, 1);
      toast(`${formatLong(iso)} : libre`);
    }
    recalculerBientot();
  });

  // Export .ics — téléchargement si la page le permet, presse-papiers sinon.
  // Un aperçu en cadre refuse les téléchargements : on met alors en avant la
  // copie du récapitulatif, seule action vraiment utile depuis un téléphone.
  if (EN_CADRE) {
    $('#btn-ics').lastChild.textContent = ' Copier le calendrier (.ics) ';
    $('#btn-ics').classList.remove('primaire');
    $('#btn-copie').classList.add('primaire');
    $('#btn-copie').parentNode.prepend($('#btn-copie'));
    $('#aide-export').innerHTML = 'Cet aperçu ne peut pas télécharger de fichier. '
      + 'Le récapitulatif se colle dans un message ou une demande de congés ; '
      + 'le .ics se copie aussi, à enregistrer sur ordinateur sous <code>conges.ics</code> '
      + 'puis à ouvrir avec ton agenda.';
  }

  $('#btn-ics').addEventListener('click', async () => {
    if (!resultat.pauses.length) return toast('Aucune pause à exporter');
    const annee = etat.debut.slice(0, 4);
    const texte = versIcs(resultat.pauses, { titre: `Congés ${annee}`, decompte: etat.decompte });

    if (EN_CADRE) {
      try {
        await navigator.clipboard.writeText(texte);
        toast('Calendrier copié — colle-le dans un fichier .ics');
      } catch {
        toast('Copie refusée par le navigateur');
      }
      return;
    }
    const blob = new Blob([texte], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `conges-${annee}.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`${resultat.pauses.length} pauses exportées`);
  });

  // Copie du récapitulatif
  $('#btn-copie').addEventListener('click', async () => {
    const txt = versTexte(resultat.pauses, stats, {
      decompte: etat.decompte,
      periode: etat.debut.slice(0, 4) === etat.fin.slice(0, 4)
        ? etat.debut.slice(0, 4) : `${etat.debut} → ${etat.fin}`,
    });
    try {
      await navigator.clipboard.writeText(txt);
      toast('Récapitulatif copié');
    } catch {
      // Repli : sélection manuelle dans une zone de texte temporaire.
      const ta = document.createElement('textarea');
      ta.value = txt;
      ta.style.cssText = 'position:fixed;top:50%;left:4%;width:92%;height:40vh;z-index:99';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand && document.execCommand('copy');
      ta.remove();
      toast(ok ? 'Récapitulatif copié' : 'Copie refusée par le navigateur');
    }
  });

  // Réinitialisation
  $('#btn-reset').addEventListener('click', async () => {
    if (!await demander()) return;
    etat = etatParDefaut(2027);
    syncReglages(); recalculer(); sauver(); changerVue('plan');
    toast('Réglages réinitialisés');
  });
}

/* ------------------------------------------------------------- démarrage */

brancher();
syncReglages();
recalculer();
changerVue(etat.vue || 'plan');

// Mise en cache hors-ligne, si l'hébergement le permet. Sans service worker,
// l'application fonctionne de la même manière : tout le calcul est local.
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* sans conséquence */ });
  });
}
