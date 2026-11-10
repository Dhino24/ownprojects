import { loadConfig } from '../config.js';
import { createDb, migrate } from '../db.js';
import { createAdapters } from '../adapters/index.js';
import { DEMO_ACCOUNTS, DEMO_PASSWORD, seedDemo } from '../seed.js';

const cfg = loadConfig();
if (cfg.NODE_ENV === 'production') {
  console.error('Refusé : pas de données de démonstration en production.');
  process.exit(1);
}
const db = createDb(cfg.DATABASE_URL);
await migrate(db);
const r = await seedDemo({ cfg, db, adapters: createAdapters(cfg) });
console.log(r.skipped ? 'Démo déjà présente.' : 'Données de démonstration créées.');
console.log(`Comptes locaux (mot de passe : ${DEMO_PASSWORD}) :`);
for (const [k, a] of Object.entries(DEMO_ACCOUNTS)) console.log(`  ${k.padEnd(15)} ${a.phone}  ${a.name}`);
await db.end();
