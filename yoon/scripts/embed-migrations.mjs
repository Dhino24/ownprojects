// Génère server/migrations.generated.ts : les migrations SQL embarquées pour les fonctions serverless.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
const dir = new URL('../server/migrations/', import.meta.url);
const list = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().map((name) => ({ name, sql: readFileSync(new URL(name, dir), 'utf8') }));
writeFileSync(new URL('../server/migrations.generated.ts', import.meta.url),
  `// Fichier généré par scripts/embed-migrations.mjs — ne pas modifier.\nimport type { Migration } from './db.js';\nexport const MIGRATIONS: Migration[] = ${JSON.stringify(list, null, 2)};\n`);
console.log(`${list.length} migrations embarquées`);
