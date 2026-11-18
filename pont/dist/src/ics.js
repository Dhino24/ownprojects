// Export iCalendar (RFC 5545) : un événement « journée entière » par pause.
import { formatLong, formatPlage, isoAdd } from './dates.js';

const CRLF = '\r\n';

const compact = (iso) => iso.replace(/-/g, '');

/** « 1 jour ouvré », « 4 jours ouvrables » — accords compris. */
export function uniteJours(n, decompte) {
  const adj = decompte === 'ouvrables' ? 'ouvrable' : 'ouvré';
  const s = n > 1 ? 's' : '';
  return `${n} jour${s} ${adj}${s}`;
}

const pluriel = (n) => (n > 1 ? 's' : '');

/** Nombre décimal à la française : 2,32 */
export const nombreFr = (x, dec = 2) =>
  x.toLocaleString('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec });

function echappe(txt) {
  return String(txt)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Pliage des lignes à 75 octets, comme l'exige la RFC. */
function plier(ligne) {
  const octets = new TextEncoder().encode(ligne);
  if (octets.length <= 75) return ligne;
  const out = [];
  let courant = '';
  let taille = 0;
  for (const ch of ligne) {
    const n = new TextEncoder().encode(ch).length;
    const limite = out.length === 0 ? 75 : 74; // les lignes suivies commencent par une espace
    if (taille + n > limite) { out.push(courant); courant = ''; taille = 0; }
    courant += ch; taille += n;
  }
  out.push(courant);
  return out.join(`${CRLF} `);
}

function horodatage() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * @param {Array} pauses      pauses issues du moteur
 * @param {Object} meta       { titre, decompte }
 * @returns {string} contenu d'un fichier .ics
 */
export function versIcs(pauses, meta = {}) {
  const titre = meta.titre || 'Congés';
  const stamp = horodatage();
  const lignes = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Pont//Optimiseur de conges//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${echappe(titre)}`,
  ];

  pauses.forEach((p, i) => {
    const detail = [
      `${p.gain} jours de repos d'affilée, ${formatPlage(p.debutRepos, p.finRepos)}.`,
      `${uniteJours(p.cout, meta.decompte)} décompté${pluriel(p.cout)}.`,
      '',
      `Jours de congé à poser (${p.jours.length}) :`,
      ...p.jours.map((j) => `  - ${formatLong(j)}`),
    ].join('\n');

    lignes.push(
      'BEGIN:VEVENT',
      `UID:pont-${compact(p.debutRepos)}-${i + 1}@pont.local`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compact(p.debutRepos)}`,
      `DTEND;VALUE=DATE:${compact(isoAdd(p.finRepos, 1))}`, // borne de fin exclusive
      `SUMMARY:${echappe(`${titre} — ${p.gain} j de repos (${p.cout} posé${pluriel(p.cout)})`)}`,
      `DESCRIPTION:${echappe(detail)}`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    );
  });

  lignes.push('END:VCALENDAR');
  return lignes.map(plier).join(CRLF) + CRLF;
}

/** Récapitulatif en texte brut, prêt à coller dans un mail ou un outil RH. */
export function versTexte(pauses, stats, meta = {}) {
  const out = [
    `Plan de congés ${meta.periode || ''}`.trim(),
    `${stats.totalRepos} jours de repos obtenus avec `
    + `${uniteJours(stats.soldeUtilise, meta.decompte)} posé${pluriel(stats.soldeUtilise)} `
    + `(rendement ×${nombreFr(stats.rendement)}).`,
    stats.reliquat > 0
      ? `Reliquat non utilisé : ${stats.reliquat} jour${pluriel(stats.reliquat)}.`
      : null,
    '',
  ].filter((l) => l !== null);

  pauses.forEach((p, i) => {
    out.push(`${i + 1}. ${formatPlage(p.debutRepos, p.finRepos)} — ${p.gain} jours de repos`);
    out.push(`   ${uniteJours(p.cout, meta.decompte)} à poser : `
      + `${p.jours.map(formatLong).join(', ')}`);
  });
  return out.join('\n');
}
