// Prépare `dist/`, le dossier à mettre en ligne :
//   - l'application telle quelle (PWA multi-fichiers, avec service worker et manifeste) ;
//   - `standalone.html`, la même application en un seul fichier autonome, pratique à
//     envoyer, à ouvrir hors-ligne ou à publier ailleurs.
// Pas de bundler : le graphe d'imports est résolu ici et les modules concaténés.
import { readFile, writeFile, mkdir, rm, cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const racine = dirname(fileURLToPath(import.meta.url));
const lire = (p) => readFile(join(racine, p), 'utf8');

const RE_IMPORT = /^import\s+[\s\S]*?from\s+['"]\.\/([^'"]+)['"];?[ \t]*$/gm;

/** Parcours en profondeur du graphe d'imports : les dépendances d'abord. */
async function ordonner(entree, vus = new Set(), ordre = []) {
  if (vus.has(entree)) return ordre;
  vus.add(entree);
  const src = await lire(join('src', entree));
  for (const m of src.matchAll(RE_IMPORT)) await ordonner(m[1], vus, ordre);
  ordre.push(entree);
  return ordre;
}

function aplatir(src) {
  return src
    .replace(RE_IMPORT, '')
    .replace(/^export\s+(?=(?:async\s+)?(?:function|const|let|var|class)\b)/gm, '')
    .trim();
}

const modules = await ordonner('app.js');
let js = '';
for (const m of modules) {
  js += `\n/* ===== src/${m} ===== */\n${aplatir(await lire(join('src', m)))}\n`;
}
// Pas de service worker dans le fichier unique : il n'y a rien à mettre en cache.
js = js.replace(/\/\/ Mise en cache hors-ligne[\s\S]*$/m, '').trimEnd();

const css = (await lire('styles.css')).trim();
const svg = await lire('icons/icon.svg');
const png192 = (await readFile(join(racine, 'icons/icon-192.png'))).toString('base64');
const png180 = (await readFile(join(racine, 'icons/icon-180.png'))).toString('base64');

// Remplacements par fonction : une chaîne de remplacement interpréterait les
// `$$` et `$&` présents dans le code source comme des séquences d'échappement.
const pose = (txt, cible, contenu) => {
  if (!txt.includes(cible)) throw new Error(`index.html : « ${cible} » introuvable`);
  return txt.replace(cible, () => contenu);
};

let html = await lire('index.html');
html = pose(html, '<link rel="manifest" href="manifest.webmanifest">\n', '');
html = pose(html, '<link rel="apple-touch-icon" href="icons/icon-192.png">',
  `<link rel="apple-touch-icon" href="data:image/png;base64,${png180}">\n`
  + `<link rel="apple-touch-icon" sizes="192x192" href="data:image/png;base64,${png192}">`);
html = pose(html, '<link rel="icon" href="icons/icon.svg" type="image/svg+xml">',
  `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${encodeURIComponent(svg)}">`);
html = pose(html, '<link rel="stylesheet" href="styles.css">', `<style>\n${css}\n</style>`);
html = pose(html, '<script type="module" src="src/app.js"></script>',
  `<script type="module">\n${js}\n</script>`);

const dist = join(racine, 'dist');
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

// L'application elle-même, servie telle quelle.
const aCopier = ['index.html', 'styles.css', 'sw.js', 'manifest.webmanifest', 'src', 'icons'];
for (const f of aCopier) await cp(join(racine, f), join(dist, f), { recursive: true });

// Et sa version en un seul fichier.
await writeFile(join(dist, 'standalone.html'), html);

const ko = (Buffer.byteLength(html) / 1024).toFixed(0);
console.log(`dist/ — site prêt à mettre en ligne (${aCopier.join(', ')})`);
console.log(`dist/standalone.html — ${ko} Ko — modules : ${modules.join(' → ')}`);
