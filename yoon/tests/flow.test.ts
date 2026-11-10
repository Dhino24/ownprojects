import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { one } from '../server/db.js';
import { api, availableCourier, login, newOrder, setup, upload, type T } from './helpers.js';

let t: T;
beforeAll(async () => { t = await setup(); });
afterAll(async () => { await t.close(); });

describe('Parcours complet', () => {
  it('commerçant → client → admin → livreur → code → paiements séparés → gain → reversement', async () => {
    const merchant = await login(t, 'merchant');
    const admin = api(t, { cookie: await login(t, 'admin') });
    const { orderId, token, price } = await newOrder(t, merchant, { payer: 'customer', amount: 12500 });
    const client = api(t, { client: token });

    // Le client voit sa livraison, deux paiements distincts avec leurs destinataires réels, et son code.
    let cv = await client.get('/api/client/order');
    expect(cv.status).toBe(200);
    expect(cv.body.order.status).toBe('ready');
    expect(cv.body.payments.map((p: any) => [p.kind, p.payee, p.amount])).toEqual([['order_amount', 'merchant', 12500], ['delivery_fee', 'service', price]]);
    const code = cv.body.code.value as string;
    expect(code).toMatch(/^\d{4}$/);

    // Le commerçant ne voit jamais le code.
    const md = await api(t, { cookie: merchant }).get(`/api/merchant/orders/${orderId}`);
    expect(JSON.stringify(md.body)).not.toContain(`"value":"${code}"`);
    expect(md.body.messages[0].wa_link).toContain('https://wa.me/221771234567');

    // Admin propose au livreur disponible.
    const courier = await availableCourier(t);
    const detail = await admin.get(`/api/admin/orders/${orderId}`);
    expect(detail.body.candidates[0].id).toBe(courier.id);
    expect(detail.body.candidates[0].position.stale).toBe(false);
    const offer = await admin.post(`/api/admin/orders/${orderId}/offers`, { courierId: courier.id });
    expect(offer.status).toBe(200);

    // Le livreur voit l'offre avec l'heure serveur pour un compte à rebours synchronisé, sans adresse exacte du client.
    const home = await courier.c.get('/api/courier/home');
    expect(home.body.offer.id).toBe(offer.body.id);
    expect(new Date(home.body.offer.expires_at).getTime() - new Date(home.body.offer.server_now).getTime()).toBeGreaterThan(25000);
    expect(JSON.stringify(home.body.offer)).not.toContain('14.7262');

    expect((await courier.c.post(`/api/courier/offers/${offer.body.id}/respond`, { accept: true })).body.status).toBe('accepted');
    const cd = await courier.c.get(`/api/courier/orders/${orderId}`);
    expect(cd.body.location.landmark).toBe('Portail vert');

    for (const step of ['arrived_pickup', 'picked_up', 'departed']) {
      const r = await courier.c.post(`/api/courier/orders/${orderId}/step`, { step });
      expect(r.status, step).toBe(200);
    }
    cv = await client.get('/api/client/order');
    expect(cv.body.courier.firstName).toBe('Mamadou');
    expect(cv.body.courier.position.ageSec).toBeGreaterThanOrEqual(0);

    const ok = await courier.c.post(`/api/courier/orders/${orderId}/code`, { code });
    expect(ok.status).toBe(200);
    expect((await client.get('/api/client/order')).body.order.status).toBe('delivered');

    // Paiement commande : client déclare → « à vérifier » ; le commerçant confirme ce qu'il a reçu sur son compte.
    const [orderOb, feeOb] = cv.body.payments;
    expect((await client.post(`/api/client/obligations/${orderOb.id}/declare`, { method: 'wave', reference: 'WV-123' })).body.status).toBe('declared');
    const mconf = await api(t, { cookie: merchant }).post(`/api/merchant/obligations/${orderOb.id}/confirm`, { method: 'wave', reference: 'WV-123', amountReceived: 12500 });
    expect(mconf.body.status).toBe('confirmed');

    // Paiement course : au service, vérifié par l'admin seulement.
    const proof = await upload(t, { client: token }, orderId, 'proof');
    expect(proof.status).toBe(201);
    await client.post(`/api/client/obligations/${feeOb.id}/declare`, { method: 'orange_money', mediaId: proof.body.id });
    const toVerify = await admin.get('/api/admin/payments?status=declared');
    expect(toVerify.body.find((p: any) => p.id === feeOb.id).proofs[0].url).toMatch(/^\/api\/media\//);
    expect((await admin.post(`/api/admin/obligations/${feeOb.id}/confirm`, { method: 'orange_money', reference: 'OM-555', amountReceived: price })).status).toBe(200);

    // Gain visible côté livreur, puis reversement.
    let w = await courier.c.get('/api/courier/wallet');
    const earning = Math.floor(price * 0.8);
    expect(w.body.balance).toBe(earning);
    const payout = await admin.post(`/api/admin/couriers/${courier.id}/payouts`, { method: 'wave', reference: 'PAY-1', expectedAmount: earning });
    expect(payout.status).toBe(200);
    w = await courier.c.get('/api/courier/wallet');
    expect(w.body.balance).toBe(0);
    expect(w.body.earnings[0].status).toBe('paid');
    expect(w.body.payouts[0].reference).toBe('PAY-1');

    // Récap du jour cohérent et export CSV sans code ni coordonnées.
    const recap = await admin.get('/api/admin/recap');
    expect(recap.body.totals.delivered).toBe(1);
    expect(recap.body.received).toBe(12500 + price);
    const csv = await t.app.inject({ method: 'GET', url: '/api/admin/recap.csv', headers: { cookie: await login(t, 'admin') } });
    expect(csv.body).toContain('delivered');
    expect(csv.body).not.toContain(code + ';');
    expect(csv.body).not.toContain('14.72');
  });

  it('données présentes après redémarrage du serveur', async () => {
    const before = await one(t.db, 'select count(*)::int as n from orders');
    const { buildApp } = await import('../server/app.js');
    const { createDb } = await import('../server/db.js');
    const db2 = createDb(t.cfg.DATABASE_URL);
    const { app: app2 } = await buildApp(t.cfg, db2, { logger: false });
    const t2 = { ...t, app: app2, db: db2 };
    const r = await api(t2, { cookie: await login(t2, 'merchant') }).get('/api/merchant/orders');
    expect(r.body.length).toBe(before.n);
    await app2.close();
    await db2.end();
  });
});
