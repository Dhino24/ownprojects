// Construit la fonction Netlify en UN seul fichier, dépendances comprises.
//
// Pourquoi : l'hébergement sans serveur installe les dépendances telles quelles et les charge
// à l'exécution. Or plusieurs d'entre elles sont passées au format « module ES », que le Node
// de la plateforme ne sait pas charger depuis un module classique (ERR_REQUIRE_ESM).
// En assemblant tout à la construction, plus rien n'est résolu à l'exécution : le problème disparaît.
import { build } from 'esbuild';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'netlify/functions-build');
await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const result = await build({
  entryPoints: [path.join(root, 'netlify/functions/api.mts')],
  outfile: path.join(outDir, 'api.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // pg le charge de façon facultative ; absent, il bascule sur son client JavaScript.
  external: ['pg-native'],
  // Certaines dépendances appellent require() de façon dynamique : on le leur fournit.
  banner: { js: "import { createRequire as __nodeRequire } from 'module';\nconst require = __nodeRequire(import.meta.url);" },
  logLevel: 'warning',
  metafile: true,
});
const bytes = Object.values(result.metafile.outputs)[0]?.bytes ?? 0;
console.log(`Fonction assemblée : netlify/functions-build/api.mjs (${Math.round(bytes / 1024)} Ko)`);
