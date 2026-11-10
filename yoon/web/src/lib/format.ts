import { TIMEZONE } from '../../../shared/contract';

export const money = (n: number | null | undefined) => new Intl.NumberFormat('fr-FR').format(n ?? 0) + ' F';
export const fcfa = (n: number | null | undefined) => new Intl.NumberFormat('fr-FR').format(n ?? 0) + ' FCFA';

const tf = new Intl.DateTimeFormat('fr-FR', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit' });
const df = new Intl.DateTimeFormat('fr-FR', { timeZone: TIMEZONE, day: 'numeric', month: 'short' });
const lf = new Intl.DateTimeFormat('fr-FR', { timeZone: TIMEZONE, weekday: 'long', day: 'numeric', month: 'long' });
const keyf = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

export const dakarDay = (d: Date | string = new Date()) => keyf.format(new Date(d));
export const time = (d: string | Date | null | undefined) => (d ? tf.format(new Date(d)) : '—');
export function when(d: string | Date | null | undefined) {
  if (!d) return '—';
  const day = dakarDay(d);
  if (day === dakarDay()) return `Aujourd’hui, ${time(d)}`;
  if (day === dakarDay(new Date(Date.now() - 86400000))) return `Hier, ${time(d)}`;
  return `${df.format(new Date(d))}, ${time(d)}`;
}
export const longToday = () => {
  const s = lf.format(new Date());
  return s.charAt(0).toUpperCase() + s.slice(1);
};
export function ago(sec: number) {
  if (sec < 60) return 'à l’instant';
  if (sec < 3600) return `il y a ${Math.round(sec / 60)} min`;
  if (sec < 86400) return `il y a ${Math.round(sec / 3600)} h`;
  return `il y a ${Math.round(sec / 86400)} j`;
}
export const initials = (name = '') => name.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
export const telLink = (p?: string | null) => (p ? `tel:${p}` : undefined);
export const waLink = (p?: string | null, text = '') => (p ? `https://wa.me/${p.replace(/\D/g, '')}${text ? `?text=${encodeURIComponent(text)}` : ''}` : undefined);
export const mapsLink = (lat: number, lng: number) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
export const formatPhone = (p?: string | null) => (p ? p.replace(/^\+221(\d{2})(\d{3})(\d{2})(\d{2})$/, '+221 $1 $2 $3 $4') : '');
