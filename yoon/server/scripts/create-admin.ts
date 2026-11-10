// Usage : npm run admin:create -- "+221770000000" "Prénom Nom"
// Le mot de passe est lu sur l'entrée standard (jamais en argument, pour ne pas finir dans l'historique du shell).
import { createInterface } from 'node:readline/promises';
import { loadConfig } from '../config.js';
import { createDb, migrate, one } from '../db.js';
import { hashPassword } from '../lib/crypto.js';
import { normalizePhone } from '../lib/phone.js';

const [phoneArg, ...nameParts] = process.argv.slice(2);
const phone = normalizePhone(phoneArg ?? '');
const name = nameParts.join(' ').trim();
if (!phone || !name) {
  console.error('Usage : npm run admin:create -- "+221770000000" "Prénom Nom"');
  process.exit(1);
}
const rl = createInterface({ input: process.stdin, output: process.stdout });
const password = process.env.ADMIN_PASSWORD ?? (await rl.question('Mot de passe (12 caractères min.) : '));
rl.close();
if (password.length < 12) {
  console.error('Mot de passe trop court.');
  process.exit(1);
}
const db = createDb(loadConfig().DATABASE_URL);
await migrate(db);
const exists = await one(db, 'select id from users where phone = $1', [phone]);
if (exists) {
  console.error('Un compte existe déjà avec ce numéro.');
  process.exit(1);
}
await db.query(`insert into users(phone, name, role, password_hash) values ($1,$2,'admin',$3)`, [phone, name, await hashPassword(password)]);
console.log('Compte admin créé.');
await db.end();
