import { TIMEZONE } from '../../shared/contract.js';

/** Date (YYYY-MM-DD) dans le fuseau Africa/Dakar. */
export function dakarDate(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
export function dakarHour(d = new Date()): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: TIMEZONE, hour: '2-digit', hour12: false }).format(d)) % 24;
}
export const fcfa = (n: number) => new Intl.NumberFormat('fr-FR').format(n).replace(/[  ]/g, ' ') + ' FCFA';
