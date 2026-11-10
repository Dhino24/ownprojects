import { loadConfig } from '../config.js';
import { createDb, migrate } from '../db.js';

const cfg = loadConfig();
const db = createDb(cfg.DATABASE_URL);
const applied = await migrate(db);
console.log(applied.length ? `Migrations appliquées : ${applied.join(', ')}` : 'Base à jour.');
await db.end();
