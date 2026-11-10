import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { one } from '../server/db.js';
import { expireOffers } from '../server/domain/dispatch.js';
import { prepareDailyRecaps } from '../server/jobs.js';
import { normalizePhone } from '../server/lib/phone.js';
import { dakarDate } from '../server/lib/time.js';
import { api, availableCourier, login, newOrder, setup, upload, zoneId, type T } from './helpers.js';

let t: T;
let merchant: string, merchant2: string, adminCookie: string;
beforeAll(async () => {
  t = await setup();
  merchant = await login(t, 'merchant');
  merchant2 = await login(t, 'merchant2');
  adminCookie = await login(t, 'admin');
});
afterAll(async () => { await t.close(); });

async function assign(orderId: string, who: 'courier' | 'courier2' = 'courier') {
  const courier = await availableCourier(t, who);
  const offer = await api(t, { cookie: adminCookie }).post(`/api/admin/orders/${orderId}/offers`, { courierId: courier.id });
  expect(offer.status).toBe(200);
  await courier.c.post(`/api/courier/offers/${offer.body.id}/respond`, { accept: true });
  return courier;
}
async function deliverSteps(c: ReturnType<typeof api>, orderId: string) {
  for (const step of ['arrived_pickup', 'picked_up', 'departed']) await c.post(`/api/courier/orders/${orderId}/step`, { step });
}

describe('Numéros', () => {
  it('normalise et valide les numéros sénégalais', () => {
    expect(normalizePhone('77 123 45 67')).toBe('+221771234567');
    expect(normalizePhone('00221 78-123-45-67')).toBe('+221781234567');
    expect(normalizePhone('+33612345678')).toBeNull();
    expect(normalizePhone('12345')).toBeNull();
  });
});

describe('Autorisations', () => {
  it('cloisonne boutiques, clients, livreurs et admin', async () => {
    const a = await newOrder(t, merchant);
    const b = await newOrder(t, merchant2);
    expect((await api(t, { cookie: merchant2 }).get(`/api/merchant/orders/${a.orderId}`)).status).toBe(404);
    expect((await api(t, { cookie: merchant2 }).post(`/api/merchant/orders/${a.orderId}/cancel`, { reason: 'test' })).status).toBe(404);
    expect((await api(t, { cookie: merchant }).get('/api/admin/overview')).status).toBe(403);
    expect((await api(t).get('/api/merchant/orders')).status).toBe(401);
    // Le jeton du client A ne donne accès qu'à la livraison A.
    const ca = await api(t, { client: a.token }).get('/api/client/order');
    const cb = await api(t, { client: b.token }).get('/api/client/order');
    expect(ca.body.order.ref).not.toBe(cb.body.order.ref);
    const obB = cb.body.payments[0].id;
    expect((await api(t, { client: a.token }).post(`/api/client/obligations/${obB}/declare`, { method: 'wave', reference: 'X' })).status).toBe(404);
    expect((await api(t, { client: 'faux-jeton-faux-jeton-faux' }).get('/api/client/order')).status).toBe(404);
    // Un livreur non attribué ne voit pas la course.
    const c2 = await login(t, 'courier2');
    expect((await api(t, { cookie: c2 }).get(`/api/courier/orders/${a.orderId}`)).status).toBe(404);
  });

  it('lien client révoqué ou expiré', async () => {
    const a = await newOrder(t, merchant);
    const renewed = await api(t, { cookie: merchant }).post(`/api/merchant/orders/${a.orderId}/client-link`);
    expect(renewed.status).toBe(200);
    expect((await api(t, { client: a.token }).get('/api/client/order')).body.error).toBe('link_revoked');
    const fresh = String(renewed.body.url).split('#')[1];
    await t.db.query('update client_links set expires_at = now() - interval \'1 minute\' where order_id = $1', [a.orderId]);
    expect((await api(t, { client: fresh }).get('/api/client/order')).body.error).toBe('link_expired');
  });

  it('médias : URL signée obligatoire, upload limité à sa livraison, type contrôlé', async () => {
    const a = await newOrder(t, merchant);
    const b = await newOrder(t, merchant2);
    expect((await upload(t, { client: a.token }, b.orderId, 'photo')).status).toBe(404);
    const bad = await upload(t, { client: a.token }, a.orderId, 'photo', Buffer.from('<?php echo 1; ?>'), 'image/jpeg');
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('invalid_file_type');
    const ok = await upload(t, { client: a.token }, a.orderId, 'photo');
    expect(ok.status).toBe(201);
    expect((await t.app.inject({ method: 'GET', url: `/api/media/${ok.body.id}` })).statusCode).toBe(403);
    expect((await t.app.inject({ method: 'GET', url: `/api/media/${ok.body.id}?e=9999999999&s=abc` })).statusCode).toBe(403);
    await api(t, { client: a.token }).post('/api/client/location', { source: 'landmark_only', photoMediaId: ok.body.id, landmark: 'Maison bleue' });
    const md = await api(t, { cookie: merchant }).get(`/api/merchant/orders/${a.orderId}`);
    expect(md.body.location.photoUrl).toBeTruthy();
    expect((await t.app.inject({ method: 'GET', url: md.body.location.photoUrl })).statusCode).toBe(200);
    // Un média d'une autre livraison ne peut pas être rattaché.
    const okB = await upload(t, { client: b.token }, b.orderId, 'photo');
    expect((await api(t, { client: a.token }).post('/api/client/location', { source: 'landmark_only', photoMediaId: okB.body.id })).body.error).toBe('invalid_media');
  });

  it('refuse les écritures venant d’une autre origine', async () => {
    const r = await t.app.inject({ method: 'POST', url: '/api/auth/logout', headers: { origin: 'https://evil.example' } });
    expect(r.statusCode).toBe(403);
  });
});

describe('Attribution', () => {
  it('position requise avant toute offre (absence de GPS)', async () => {
    const a = await newOrder(t, merchant, { locate: false });
    const client = api(t, { client: a.token });
    const r = await client.post('/api/client/location', { source: 'landmark_only', landmark: 'Derrière la mosquée' });
    expect(r.body.status).toBe('awaiting_location');
    expect((await client.post('/api/client/location', { source: 'gps' })).body.error).toBe('missing_coords');
    expect((await client.post('/api/client/location', { source: 'map', lat: 48.85, lng: 2.35 })).body.error).toBe('out_of_area');
    const courier = await availableCourier(t);
    const offer = await api(t, { cookie: adminCookie }).post(`/api/admin/orders/${a.orderId}/offers`, { courierId: courier.id });
    expect(offer.body.error).toBe('no_location');
    // Placement manuel sur la carte : la course devient attribuable, le repère est conservé.
    const m = await client.post('/api/client/location', { source: 'map', lat: 14.73, lng: -17.49, landmark: 'Derrière la mosquée' });
    expect(m.body.status).toBe('ready');
  });

  it('double acceptation : une seule réussit', async () => {
    const a = await newOrder(t, merchant);
    const courier = await availableCourier(t);
    const offer = await api(t, { cookie: adminCookie }).post(`/api/admin/orders/${a.orderId}/offers`, { courierId: courier.id });
    // Une seconde offre en parallèle sur la même course est refusée.
    const other = await availableCourier(t, 'courier2');
    expect((await api(t, { cookie: adminCookie }).post(`/api/admin/orders/${a.orderId}/offers`, { courierId: other.id })).status).toBe(409);
    const [r1, r2] = await Promise.all([
      courier.c.post(`/api/courier/offers/${offer.body.id}/respond`, { accept: true }),
      courier.c.post(`/api/courier/offers/${offer.body.id}/respond`, { accept: true }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    const n = await one(t.db, `select count(*)::int as n from offers where order_id = $1 and status = 'accepted'`, [a.orderId]);
    expect(n.n).toBe(1);
    await api(t, { cookie: adminCookie }).post(`/api/admin/orders/${a.orderId}/cancel`, { reason: 'nettoyage test' });
  });

  it('offre expirée : refusée, course de nouveau attribuable, tâche rejouable', async () => {
    const a = await newOrder(t, merchant);
    const courier = await availableCourier(t);
    const offer = await api(t, { cookie: adminCookie }).post(`/api/admin/orders/${a.orderId}/offers`, { courierId: courier.id });
    await t.db.query(`update offers set expires_at = now() - interval '1 second' where id = $1`, [offer.body.id]);
    const r = await courier.c.post(`/api/courier/offers/${offer.body.id}/respond`, { accept: true });
    expect(r.body.error).toBe('offer_expired');
    expect((await one(t.db, 'select status from orders where id = $1', [a.orderId])).status).toBe('ready');
    expect(await expireOffers(t.db)).toBe(0);
    // Refus : la course revient « à attribuer » et l'admin propose au suivant.
    const o2 = await api(t, { cookie: adminCookie }).post(`/api/admin/orders/${a.orderId}/offers`, { courierId: courier.id });
    expect((await courier.c.post(`/api/courier/offers/${o2.body.id}/respond`, { accept: false })).body.status).toBe('refused');
    const next = await availableCourier(t, 'courier2');
    expect((await api(t, { cookie: adminCookie }).post(`/api/admin/orders/${a.orderId}/offers`, { courierId: next.id })).status).toBe(200);
    const hist = await api(t, { cookie: adminCookie }).get(`/api/admin/orders/${a.orderId}`);
    expect(hist.body.offers.map((o: any) => o.status)).toEqual(['expired', 'refused', 'pending']);
    await api(t, { cookie: adminCookie }).post(`/api/admin/orders/${a.orderId}/cancel`, { reason: 'nettoyage test' });
  });

  it('un livreur non validé ne peut pas se rendre disponible', async () => {
    const c = api(t, { cookie: await login(t, 'courierPending') });
    expect((await c.post('/api/courier/availability', { available: true })).body.error).toBe('courier_not_approved');
  });
});

describe('Remise', () => {
  it('mauvais code, limite d’essais, réutilisation impossible', async () => {
    const a = await newOrder(t, merchant);
    const courier = await assign(a.orderId);
    await deliverSteps(courier.c, a.orderId);
    const code = (await api(t, { client: a.token }).get('/api/client/order')).body.code.value;
    const wrong = code === '0000' ? '1111' : '0000';
    const r1 = await courier.c.post(`/api/courier/orders/${a.orderId}/code`, { code: wrong });
    expect(r1.status).toBe(422);
    expect(r1.body.details.remaining).toBe(4);
    expect((await courier.c.post(`/api/courier/orders/${a.orderId}/code`, { code: 'abcd' })).body.error).toBe('invalid_code_format');
    expect((await courier.c.post(`/api/courier/orders/${a.orderId}/code`, { code })).status).toBe(200);
    const again = await courier.c.post(`/api/courier/orders/${a.orderId}/code`, { code });
    expect(again.status).toBe(409);
    const n = await one(t.db, `select count(*)::int as n from earnings where order_id = $1`, [a.orderId]);
    expect(n.n).toBe(1);
  });

  it('blocage après trop d’essais, puis preuve photo contrôlée par l’admin', async () => {
    const a = await newOrder(t, merchant);
    const courier = await assign(a.orderId);
    await deliverSteps(courier.c, a.orderId);
    const code = (await api(t, { client: a.token }).get('/api/client/order')).body.code.value;
    const wrong = code === '0000' ? '1111' : '0000';
    for (let i = 0; i < 5; i++) await courier.c.post(`/api/courier/orders/${a.orderId}/code`, { code: wrong });
    const locked = await courier.c.post(`/api/courier/orders/${a.orderId}/code`, { code });
    expect(locked.status).toBe(423);
    const photo = await upload(t, { cookie: courier.cookie }, a.orderId, 'proof');
    const p = await courier.c.post(`/api/courier/orders/${a.orderId}/photo-proof`, { mediaId: photo.body.id, reason: 'Code bloqué', recipientName: 'Sœur du client' });
    expect(p.body.status).toBe('incident');
    // Pas de remise silencieuse : rien n'est livré ni payé avant décision.
    expect((await one(t.db, 'select count(*)::int as n from earnings where order_id = $1', [a.orderId])).n).toBe(0);
    const inc = (await api(t, { cookie: adminCookie }).get('/api/admin/incidents')).body.find((i: any) => i.order_id === a.orderId);
    expect((await api(t, { cookie: adminCookie }).post(`/api/admin/incidents/${inc.id}/resolve`, { decision: 'approve_photo', note: 'Appel au client : confirmé' })).status).toBe(200);
    expect((await one(t.db, 'select status from orders where id = $1', [a.orderId])).status).toBe('delivered');
    expect((await one(t.db, 'select count(*)::int as n from earnings where order_id = $1', [a.orderId])).n).toBe(1);
  });

  it('client introuvable : deux tentatives tracées, délai, puis annulation avec frais', async () => {
    const a = await newOrder(t, merchant);
    const courier = await assign(a.orderId);
    await deliverSteps(courier.c, a.orderId);
    await courier.c.post(`/api/courier/orders/${a.orderId}/contact`, { channel: 'call' });
    expect((await courier.c.post(`/api/courier/orders/${a.orderId}/not-found`)).body.error).toBe('attempts_required');
    await courier.c.post(`/api/courier/orders/${a.orderId}/contact`, { channel: 'whatsapp' });
    expect((await courier.c.post(`/api/courier/orders/${a.orderId}/not-found`)).body.error).toBe('wait_required');
    await t.db.query(`update contact_attempts set created_at = created_at - interval '11 minutes' where order_id = $1`, [a.orderId]);
    expect((await courier.c.post(`/api/courier/orders/${a.orderId}/not-found`)).body.status).toBe('incident');
    const inc = (await api(t, { cookie: adminCookie }).get('/api/admin/incidents')).body.find((i: any) => i.order_id === a.orderId);
    await api(t, { cookie: adminCookie }).post(`/api/admin/incidents/${inc.id}/resolve`, { decision: 'cancel', note: 'Client injoignable après 2 appels' });
    const fee = await one(t.db, `select amount, payer from payment_obligations where order_id = $1 and kind = 'cancellation_fee'`, [a.orderId]);
    expect(fee).toEqual({ amount: 1000, payer: 'merchant' });
    expect((await one(t.db, `select amount from earnings where order_id = $1 and kind = 'cancellation'`, [a.orderId])).amount).toBe(1000);
  });
});

describe('Paiements', () => {
  it('justificatif sans validation ≠ payé ; montant imposé par le serveur', async () => {
    const a = await newOrder(t, merchant, { payer: 'customer' });
    const client = api(t, { client: a.token });
    const fee = (await client.get('/api/client/order')).body.payments.find((p: any) => p.kind === 'delivery_fee');
    // Le client ne peut pas envoyer de montant.
    expect((await client.post(`/api/client/obligations/${fee.id}/declare`, { method: 'wave', reference: 'REF-1', amount: 1 })).status).toBe(400);
    await client.post(`/api/client/obligations/${fee.id}/declare`, { method: 'wave', reference: 'REF-1' });
    const st = await one(t.db, 'select status from payment_obligations where id = $1', [fee.id]);
    expect(st.status).toBe('declared');
    const recap = await api(t, { cookie: adminCookie }).get(`/api/admin/recap?date=${dakarDate()}`);
    expect(recap.body.unconfirmed).toBeGreaterThan(0);
    const admin = api(t, { cookie: adminCookie });
    expect((await admin.post(`/api/admin/obligations/${fee.id}/confirm`, { method: 'wave', reference: 'REF-1', amountReceived: fee.amount - 100 })).body.error).toBe('amount_mismatch');
    expect((await admin.post(`/api/admin/obligations/${fee.id}/confirm`, { method: 'wave', reference: 'REF-1', amountReceived: fee.amount })).status).toBe(200);
    expect((await admin.post(`/api/admin/obligations/${fee.id}/confirm`, { method: 'wave', reference: 'REF-1', amountReceived: fee.amount })).body.error).toBe('already_confirmed');
    // Une même référence ne peut pas confirmer deux paiements.
    const b = await newOrder(t, merchant, { payer: 'customer' });
    const feeB = (await api(t, { client: b.token }).get('/api/client/order')).body.payments.find((p: any) => p.kind === 'delivery_fee');
    expect((await admin.post(`/api/admin/obligations/${feeB.id}/confirm`, { method: 'wave', reference: 'REF-1', amountReceived: feeB.amount })).body.error).toBe('reference_used');
  });

  it('course payée par le commerçant vs par le client', async () => {
    const a = await newOrder(t, merchant, { payer: 'merchant' });
    const client = api(t, { client: a.token });
    const cv = await client.get('/api/client/order');
    expect(cv.body.payments.map((p: any) => p.kind)).toEqual(['order_amount']);
    const fee = await one(t.db, `select id from payment_obligations where order_id = $1 and kind = 'delivery_fee'`, [a.orderId]);
    expect((await client.post(`/api/client/obligations/${fee.id}/declare`, { method: 'wave', reference: 'X' })).status).toBe(403);
    const m = api(t, { cookie: merchant });
    expect((await m.post(`/api/merchant/obligations/${fee.id}/declare`, { orderId: a.orderId, method: 'wave', reference: 'MF-1' })).body.status).toBe('declared');
    // Le commerçant ne peut pas confirmer lui-même un paiement destiné au service.
    expect((await m.post(`/api/merchant/obligations/${fee.id}/confirm`, { method: 'wave', reference: 'MF-1', amountReceived: a.price })).status).toBe(404);
  });

  it('reversement : montant affiché vérifié, pas de double reversement', async () => {
    const admin = api(t, { cookie: adminCookie });
    const courier = await availableCourier(t);
    const bal = (await courier.c.get('/api/courier/wallet')).body.balance;
    if (bal > 0) {
      expect((await admin.post(`/api/admin/couriers/${courier.id}/payouts`, { method: 'wave', reference: 'P-X', expectedAmount: bal + 1 })).body.error).toBe('amount_changed');
      expect((await admin.post(`/api/admin/couriers/${courier.id}/payouts`, { method: 'wave', reference: 'P-X', expectedAmount: bal })).status).toBe(200);
    }
    expect((await admin.post(`/api/admin/couriers/${courier.id}/payouts`, { method: 'wave', reference: 'P-Y', expectedAmount: bal })).body.error).toBe('nothing_to_pay');
  });
});

describe('Annulation et tarifs', () => {
  it('gratuite avant attribution, frais après attribution', async () => {
    const m = api(t, { cookie: merchant });
    const a = await newOrder(t, merchant);
    const r = await m.post(`/api/merchant/orders/${a.orderId}/cancel`, { reason: 'Client a annulé' });
    expect(r.body.fee).toBe(0);
    const b = await newOrder(t, merchant);
    await assign(b.orderId);
    const r2 = await m.post(`/api/merchant/orders/${b.orderId}/cancel`, { reason: 'Rupture de stock' });
    expect(r2.body.fee).toBe(500);
    const c = await one(t.db, 'select actor, reason, fee from cancellations where order_id = $1', [b.orderId]);
    expect(c).toEqual({ actor: 'merchant', reason: 'Rupture de stock', fee: 500 });
    expect((await m.post(`/api/merchant/orders/${b.orderId}/cancel`, { reason: 'encore' })).status).toBe(409);
  });

  it('prix figé à la confirmation et nouvelle version de tarifs', async () => {
    const m = api(t, { cookie: merchant });
    const from = await zoneId(t, 'Mermoz – Sacré-Cœur'), to = await zoneId(t, 'Ouakam');
    const before = await newOrder(t, merchant);
    const pub = await api(t, { cookie: adminCookie }).post('/api/admin/pricing', {
      note: 'Test v2', courierShareBps: 7500, cancelFee: 600, cancelCourierShareBps: 10000, notFoundFee: 1000, notFoundWaitMinutes: 10,
      pairs: [{ fromZoneId: from, toZoneId: to, price: 1700 }],
    });
    expect(pub.status).toBe(200);
    const stale = await m.post('/api/merchant/orders', { customerName: 'Test', customerPhone: '771234567', orderAmount: 0, pickupAddress: 'Mermoz',
      pickupZoneId: from, destZoneId: to, deliveryPayer: 'merchant', expectedPrice: before.price });
    expect(stale.body.error).toBe('price_changed');
    expect(stale.body.details.price).toBe(1700);
    const old = await one(t.db, 'select delivery_price, pricing_version_id from orders where id = $1', [before.orderId]);
    expect(old.delivery_price).toBe(before.price);
    const after = await newOrder(t, merchant);
    const fresh = await one(t.db, 'select delivery_price, courier_earning, commission from orders where id = $1', [after.orderId]);
    expect(fresh).toEqual({ delivery_price: 1700, courier_earning: 1275, commission: 425 });
  });

  it('zone inactive refusée', async () => {
    const r = await api(t, { cookie: merchant }).post('/api/merchant/quote', { pickupZoneId: await zoneId(t, 'Mermoz – Sacré-Cœur'), destZoneId: await zoneId(t, 'Plateau') });
    expect(r.body.error).toBe('zone_inactive');
  });
});

describe('Robustesse', () => {
  it('reprise réseau : la même clé d’idempotence ne crée pas de doublon', async () => {
    const m = api(t, { cookie: merchant });
    const from = await zoneId(t, 'Mermoz – Sacré-Cœur'), to = await zoneId(t, 'Ouakam');
    const price = (await m.post('/api/merchant/quote', { pickupZoneId: from, destZoneId: to })).body.price;
    const body = { customerName: 'Réseau', customerPhone: '771112233', orderAmount: 1000, pickupAddress: 'Mermoz', pickupZoneId: from, destZoneId: to, deliveryPayer: 'merchant', expectedPrice: price };
    const r1 = await m.post('/api/merchant/orders', body, { 'idempotency-key': 'k-123' });
    const r2 = await m.post('/api/merchant/orders', body, { 'idempotency-key': 'k-123' });
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(200);
    expect(r2.body.orderId).toBe(r1.body.orderId);
  });

  it('récap quotidien rejoué sans doublon', async () => {
    const d = dakarDate();
    expect(await prepareDailyRecaps(t.ctx, d)).toBe(true);
    const n1 = (await one(t.db, `select count(*)::int as n from notifications where template = 'daily_recap'`)).n;
    expect(await prepareDailyRecaps(t.ctx, d)).toBe(false);
    expect((await api(t, { cookie: adminCookie }).post(`/api/admin/recap/prepare?date=${d}`)).status).toBe(409);
    expect((await one(t.db, `select count(*)::int as n from notifications where template = 'daily_recap'`)).n).toBe(n1);
  });

  it('message WhatsApp : ouvrir ≠ envoyé', async () => {
    const a = await newOrder(t, merchant);
    const msg = (await api(t, { cookie: merchant }).get(`/api/merchant/orders/${a.orderId}`)).body.messages[0];
    const m = api(t, { cookie: merchant });
    expect((await m.post(`/api/messages/${msg.id}/mark`, { status: 'opened' })).body.status).toBe('opened');
    expect((await m.post(`/api/messages/${msg.id}/mark`, { status: 'confirmed_sent' })).body.status).toBe('confirmed_sent');
    expect((await api(t, { cookie: merchant2 }).post(`/api/messages/${msg.id}/mark`, { status: 'opened' })).status).toBe(404);
  });
});
