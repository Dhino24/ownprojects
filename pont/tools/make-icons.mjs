// Génère les icônes PNG de l'application sans dépendance : encodeur PNG minimal
// (IHDR / IDAT / IEND, RGBA 8 bits) + zlib fourni par Node.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return (buf) => {
    let c = -1;
    for (const b of buf) c = t[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
})();

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(CRC(body));
  return Buffer.concat([len, body, crc]);
}

function png(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // profondeur
  ihdr[9] = 6;   // RGBA
  const brut = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    brut[y * (width * 4 + 1)] = 0; // filtre « none »
    rgba.copy(brut, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(brut, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Silhouette de pont : tablier horizontal, arche en plein cintre, ligne d'eau. */
function couleurEn(u, v) {
  const FOND = [16, 21, 29];
  const FOND_HAUT = [24, 32, 43];
  const TEAL = [69, 215, 168];

  // Tablier
  const tablier = u > 0.07 && u < 0.93 && v > 0.34 && v < 0.41;
  // Arche : couronne circulaire dont la clé touche le tablier
  const dx = u - 0.5, dy = v - 0.82;
  const r = Math.hypot(dx, dy);
  const arche = dy <= 0 && v >= 0.405 && r >= 0.33 && r <= 0.41;
  // Ligne d'eau
  const eau = v > 0.865 && v < 0.905 && ((u > 0.12 && u < 0.44) || (u > 0.56 && u < 0.88));

  if (tablier || arche || eau) return TEAL;
  const t = Math.min(1, Math.max(0, v));
  return FOND.map((c, i) => Math.round(FOND_HAUT[i] + (c - FOND_HAUT[i]) * t));
}

function dessiner(taille) {
  const SS = 3; // sur-échantillonnage pour lisser les bords
  const buf = Buffer.alloc(taille * taille * 4);
  for (let y = 0; y < taille; y++) {
    for (let x = 0; x < taille; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / taille;
          const v = (y + (sy + 0.5) / SS) / taille;
          const c = couleurEn(u, v);
          r += c[0]; g += c[1]; b += c[2];
        }
      }
      const n = SS * SS, i = (y * taille + x) * 4;
      buf[i] = Math.round(r / n);
      buf[i + 1] = Math.round(g / n);
      buf[i + 2] = Math.round(b / n);
      buf[i + 3] = 255;
    }
  }
  return png(taille, taille, buf);
}

mkdirSync(new URL('../icons/', import.meta.url), { recursive: true });
for (const t of [180, 192, 512]) {
  const f = new URL(`../icons/icon-${t}.png`, import.meta.url);
  writeFileSync(f, dessiner(t));
  console.log(`icons/icon-${t}.png`);
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="Pont">
  <rect width="100" height="100" fill="#101520"/>
  <g fill="#45d7a8">
    <rect x="7" y="34" width="86" height="7"/>
    <path d="M9 82a41 41 0 0182 0h-8a33 33 0 00-66 0z"/>
    <rect x="12" y="86.5" width="32" height="4"/>
    <rect x="56" y="86.5" width="32" height="4"/>
  </g>
</svg>`;
writeFileSync(new URL('../icons/icon.svg', import.meta.url), svg);
console.log('icons/icon.svg');
