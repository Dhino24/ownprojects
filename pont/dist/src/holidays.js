// Jours fériés légaux français (métropole), calculés — valables pour toute année.
import { ymdToUTC, utcToIso, isoAdd } from './dates.js';

/**
 * Dimanche de Pâques (algorithme grégorien anonyme / Meeus-Jones-Butcher).
 * @returns {string} date ISO
 */
export function paques(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mois = Math.floor((h + l - 7 * m + 114) / 31);
  const jour = ((h + l - 7 * m + 114) % 31) + 1;
  return utcToIso(ymdToUTC(year, mois, jour));
}

/**
 * Les 11 jours fériés légaux de France métropolitaine.
 * @returns {Array<{iso: string, nom: string}>}
 */
export function feriesFrance(year) {
  const p = paques(year);
  const f = [
    { iso: `${year}-01-01`, nom: "Jour de l'an" },
    { iso: isoAdd(p, 1), nom: 'Lundi de Pâques' },
    { iso: `${year}-05-01`, nom: 'Fête du Travail' },
    { iso: `${year}-05-08`, nom: 'Victoire 1945' },
    { iso: isoAdd(p, 39), nom: 'Ascension' },
    { iso: isoAdd(p, 50), nom: 'Lundi de Pentecôte' },
    { iso: `${year}-07-14`, nom: 'Fête nationale' },
    { iso: `${year}-08-15`, nom: 'Assomption' },
    { iso: `${year}-11-01`, nom: 'Toussaint' },
    { iso: `${year}-11-11`, nom: 'Armistice 1918' },
    { iso: `${year}-12-25`, nom: 'Noël' },
  ];
  f.sort((x, y) => (x.iso < y.iso ? -1 : 1));
  return f;
}

/** Map iso -> nom du férié, pour une plage d'années inclusive. */
export function feriesMap(fromYear, toYear) {
  const map = new Map();
  for (let y = fromYear; y <= toYear; y++) {
    for (const { iso, nom } of feriesFrance(y)) map.set(iso, nom);
  }
  return map;
}
