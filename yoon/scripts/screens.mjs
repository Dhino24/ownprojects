// Parcours navigateur réel + captures aux largeurs 360, 390 et 1440 px, avec détection de débordement horizontal.
// Prérequis : serveur lancé avec la démo (voir README, « Vérification visuelle »). Usage : BASE=http://localhost:8787 npm run screens
import { createRequire } from 'node:module';
// Playwright : installé globalement dans l'environnement ou via « npm i -D playwright ».
const { chromium } = createRequire(import.meta.url)('playwright');
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:8787';
const OUT = process.env.OUT ?? 'screens';
const PASSWORD = 'yoon-demo-2026';
const ACC = { admin: '770000001', merchant: '770000010', courier: '770000020' };
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const problems = [];

async function ctx(width, extra = {}) {
  const c = await browser.newContext({ viewport: { width, height: width < 800 ? 820 : 900 }, deviceScaleFactor: 1, locale: 'fr-FR', timezoneId: 'Africa/Dakar', ...extra });
  const p = await c.newPage();
  p.on('pageerror', (e) => problems.push(`JS ${width}px ${p.url()}: ${e.message}`));
  p.on('console', (m) => m.type() === 'error' && !/tile|Failed to load resource|ERR_/.test(m.text()) && problems.push(`console ${width}px ${p.url()}: ${m.text()}`));
  return { c, p };
}
async function login(p, who) {
  await p.goto(`${BASE}/connexion`);
  await p.getByLabel('Téléphone').fill(ACC[who]);
  await p.getByLabel('Mot de passe').fill(PASSWORD);
  await p.getByRole('button', { name: /Se connecter/ }).click();
  await p.waitForURL((u) => !u.pathname.startsWith('/connexion'));
}
async function shot(p, name, width) {
  await p.waitForTimeout(700);
  const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (over > 1) problems.push(`Débordement horizontal ${over}px · ${name} @${width}`);
  await p.screenshot({ path: `${OUT}/${name}-${width}.png`, fullPage: true });
}

// ---------- Parcours réel dans le navigateur (390 px) ----------
const W = 390;
const m = await ctx(W);
await login(m.p, 'merchant');
await m.p.getByRole('link', { name: /Nouvelle livraison/ }).first().click();
await m.p.getByLabel('Nom du client').fill('Fatou Ndiaye');
await m.p.getByLabel(/Téléphone WhatsApp du client/).fill('76 555 44 33');
await m.p.getByLabel(/Montant de la commande/).fill('9000');
await m.p.getByRole('button', { name: /Continuer/ }).click();
await m.p.getByLabel('Zone de livraison').selectOption({ label: 'Ouakam' });
await m.p.getByLabel('Qui paie la livraison ?').selectOption('customer');
await m.p.getByRole('button', { name: /Voir le récapitulatif/ }).click();
await m.p.getByText('Tout est prêt ?').waitFor();
await shot(m.p, 'commercant-recap', W);
await m.p.getByRole('button', { name: /Confirmer la livraison/ }).click();
await m.p.waitForURL(/\/m\/livraisons\//);
await m.p.getByText('Messages au client').waitFor();
await shot(m.p, 'commercant-detail-attente', W);
const orderId = m.p.url().split('/').pop().split('?')[0];
const waHref = await m.p.getByRole('link', { name: /Ouvrir WhatsApp/ }).first().getAttribute('href');
const clientUrl = decodeURIComponent(waHref).match(/https?:\/\/\S+\/c#[\w-]+/)[0].replace(/^https?:\/\/[^/]+/, BASE);
await m.p.getByRole('button', { name: /J’ai envoyé ce message/ }).click();
await m.p.getByText('Envoyé (confirmé)').waitFor();

// Client : GPS accordé (position simulée par le navigateur de test).
const cl = await ctx(W, { geolocation: { latitude: 14.7262, longitude: -17.4895, accuracy: 25 }, permissions: ['geolocation'] });
await cl.p.goto(clientUrl);
await cl.p.waitForURL(`${BASE}/c`);
await cl.p.getByText('Première étape : votre position').waitFor();
await shot(cl.p, 'client-accueil-attente', W);
await cl.p.getByRole('link', { name: /Partager ma position/ }).click();
await cl.p.getByRole('button', { name: /Partager ma position/ }).click();
await cl.p.getByText(/Position GPS/).waitFor();
await cl.p.getByLabel(/Un repère facile/).fill('Portail vert, en face de la pharmacie');
await shot(cl.p, 'client-position', W);
await cl.p.getByRole('button', { name: /Confirmer mon repère/ }).click();
await cl.p.waitForURL(`${BASE}/c`);
await cl.p.getByText('Votre code de livraison').waitFor();
const code = (await cl.p.locator('.code span').allTextContents()).join('');
await shot(cl.p, 'client-suivi', W);

// Livreur disponible avec position.
const cr = await ctx(W, { geolocation: { latitude: 14.712, longitude: -17.472, accuracy: 15 }, permissions: ['geolocation'] });
await login(cr.p, 'courier');
await cr.p.getByRole('switch', { name: 'Ma disponibilité' }).click();
await cr.p.getByText('Vous êtes en ligne').waitFor();
await cr.p.getByText(/Position partagée/).waitFor({ timeout: 15000 });

// Admin propose.
const ad = await ctx(1440);
await login(ad.p, 'admin');
await ad.p.goto(`${BASE}/a/livraisons/${orderId}`);
await ad.p.getByRole('button', { name: 'Proposer' }).first().click();
await ad.p.getByText(/Offre envoyée à/).first().waitFor();
await shot(ad.p, 'admin-attribution', 1440);

// Livreur : offre avec compte à rebours serveur, acceptation, étapes, code.
await cr.p.getByText('Nouvelle proposition').waitFor({ timeout: 15000 });
await shot(cr.p, 'livreur-offre', W);
await cr.p.getByRole('button', { name: /Accepter/ }).click();
await cr.p.waitForURL(/\/l\/course\//);
for (const cta of ['Je suis au retrait', 'J’ai récupéré le colis', 'Je pars livrer']) {
  await cr.p.getByRole('button', { name: cta }).click();
  await cr.p.getByText('Étape confirmée.').waitFor();
  await cr.p.waitForTimeout(400);
}
await cr.p.getByLabel('Code du client').fill(code === '0000' ? '1111' : '0000');
await cr.p.getByRole('button', { name: /Confirmer la livraison/ }).click();
await cr.p.getByText(/Code incorrect/).first().waitFor();
await shot(cr.p, 'livreur-code-erreur', W);
await cr.p.getByLabel('Code du client').fill(code);
await cr.p.getByRole('button', { name: /Confirmer la livraison/ }).click();
await cr.p.getByText(/ajoutés à vos gains/).waitFor();
await shot(cr.p, 'livreur-livre', W);

// Client : justificatif ; admin : vérification.
await cl.p.goto(`${BASE}/c/paiement`);
await cl.p.getByRole('button', { name: /J’ai payé/ }).first().click();
await cl.p.getByLabel('Référence du transfert').fill('WV-UI-001');
await cl.p.getByRole('button', { name: /Envoyer le justificatif/ }).click();
await cl.p.getByText(/en attente de vérification/).first().waitFor();
await shot(cl.p, 'client-paiement', W);
await ad.p.goto(`${BASE}/a/paiements`);
await ad.p.getByText('#').first().waitFor();
await shot(ad.p, 'admin-paiements', 1440);

// ---------- Captures de chaque écran aux 3 largeurs ----------
const screens = {
  merchant: [['/m', 'commercant-accueil'], ['/m/livraisons', 'commercant-liste'], [`/m/livraisons/${orderId}`, 'commercant-detail'], ['/m/nouvelle', 'commercant-nouvelle'], ['/m/paiements', 'commercant-paiements'], ['/m/compte', 'commercant-compte']],
  courier: [['/l', 'livreur-accueil'], ['/l/gains', 'livreur-gains'], ['/l/compte', 'livreur-compte']],
  admin: [['/a', 'admin-accueil'], [`/a/livraisons/${orderId}`, 'admin-detail'], ['/a/paiements', 'admin-paiements-liste'], ['/a/incidents', 'admin-incidents'], ['/a/livreurs', 'admin-livreurs'], ['/a/reversements', 'admin-reversements'], ['/a/zones', 'admin-zones'], ['/a/recap', 'admin-recap'], ['/a/messages', 'admin-messages'], ['/a/parametres', 'admin-parametres'], ['/a/plus', 'admin-plus']],
};
for (const width of [360, 390, 1440]) {
  for (const [who, list] of Object.entries(screens)) {
    const { c, p } = await ctx(width);
    await login(p, who);
    for (const [path, name] of list) { await p.goto(BASE + path); await shot(p, name, width); }
    await c.close();
  }
  const { c, p } = await ctx(width);
  await p.goto(clientUrl);
  await p.waitForURL(`${BASE}/c`);
  for (const [path, name] of [['/c', 'client-accueil'], ['/c/position', 'client-position'], ['/c/paiement', 'client-paiement'], ['/c/aide', 'client-aide']]) { await p.goto(BASE + path); await shot(p, name, width); }
  await p.goto(`${BASE}/connexion`); await shot(p, 'connexion', width);
  await c.close();
}
await browser.close();
console.log(problems.length ? `Problèmes :\n- ${problems.join('\n- ')}` : 'Parcours navigateur OK, aucun débordement ni erreur JS.');
process.exit(problems.length ? 1 : 0);
