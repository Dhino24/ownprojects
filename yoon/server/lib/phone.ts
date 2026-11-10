// Numéros sénégalais : +221 suivi de 9 chiffres (mobiles 70/71/75/76/77/78, fixes 33).
export function normalizePhone(input: string): string | null {
  let d = String(input ?? '').replace(/[\s().-]/g, '');
  if (d.startsWith('00')) d = '+' + d.slice(2);
  if (d.startsWith('+221')) d = d.slice(4);
  else if (d.startsWith('221') && d.length === 12) d = d.slice(3);
  if (!/^\d{9}$/.test(d)) return null;
  if (!/^(7[015678]|33)/.test(d)) return null;
  return '+221' + d;
}
/** Pour l'affichage partiel : jamais le numéro complet dans les journaux. */
export const maskPhone = (p: string) => p.slice(0, 6) + '•••' + p.slice(-2);
export const waDigits = (p: string) => p.replace(/\D/g, '');
