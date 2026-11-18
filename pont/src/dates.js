// Utilitaires de dates en UTC pur : aucune dépendance au fuseau de l'appareil.

const MS_DAY = 86400000;

export function ymdToUTC(y, m, d) {
  return Date.UTC(y, m - 1, d);
}

export function isoToUTC(iso) {
  const y = +iso.slice(0, 4), m = +iso.slice(5, 7), d = +iso.slice(8, 10);
  return ymdToUTC(y, m, d);
}

export function utcToIso(ts) {
  const dt = new Date(ts);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Décale une date ISO de n jours. */
export function isoAdd(iso, n) {
  return utcToIso(isoToUTC(iso) + n * MS_DAY);
}

/** Jour de la semaine : 0 = dimanche … 6 = samedi. */
export function isoDow(iso) {
  return new Date(isoToUTC(iso)).getUTCDay();
}

/** Nombre de jours entre deux dates ISO (b - a). */
export function isoDiff(a, b) {
  return Math.round((isoToUTC(b) - isoToUTC(a)) / MS_DAY);
}

export function isoYear(iso) { return +iso.slice(0, 4); }
export function isoMonth(iso) { return +iso.slice(5, 7); }
export function isoDay(iso) { return +iso.slice(8, 10); }

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const MOIS_COURT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin',
  'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const JOURS_COURT = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];

export const moisNom = (m) => MOIS[m - 1];
export const moisCourt = (m) => MOIS_COURT[m - 1];
export const jourNom = (dow) => JOURS[dow];
export const jourLettre = (dow) => JOURS_COURT[dow];

/** 1 -> « 1er », les autres inchangés. */
export const numeroJour = (n) => (n === 1 ? '1er' : String(n));

/** « mardi 29 mars 2027 » */
export function formatLong(iso) {
  return `${jourNom(isoDow(iso))} ${numeroJour(isoDay(iso))} ${moisNom(isoMonth(iso))} ${isoYear(iso)}`;
}

/** « du 27 mars au 5 avril 2027 », en évitant les répétitions inutiles. */
export function formatPlage(a, b) {
  const ya = isoYear(a), yb = isoYear(b), ma = isoMonth(a), mb = isoMonth(b);
  const da = numeroJour(isoDay(a)), db = numeroJour(isoDay(b));
  if (a === b) return `le ${da} ${moisNom(ma)} ${ya}`;
  if (ya === yb && ma === mb) return `du ${da} au ${db} ${moisNom(mb)} ${yb}`;
  if (ya === yb) return `du ${da} ${moisNom(ma)} au ${db} ${moisNom(mb)} ${yb}`;
  return `du ${da} ${moisNom(ma)} ${ya} au ${db} ${moisNom(mb)} ${yb}`;
}
