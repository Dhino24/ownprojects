import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, newIdempotencyKey, uploadMedia, compressImage } from '../lib/api';
import { useData } from '../lib/live';
import { fcfa, money, when, time, formatPhone } from '../lib/format';
import { Icon } from '../components/Icon';
import { Async, Empty, Field, Intro, Kv, Modal, PayTag, Stat, StatusTag, useAction } from '../components/ui';
import { CourierLine, Messages, OrderList, Progress, Timeline } from '../components/orders';
import { MapView, type Marker } from '../components/MapView';
import { useSession } from '../components/Layout';
import { OBLIGATION_KIND_LABEL, METHOD_LABEL, ORDER_STATUS_LABEL, type PaymentMethod } from '../../../shared/contract';

const Package = () => (
  <svg className="package" viewBox="0 0 160 160" aria-hidden="true"><path d="m20 48 58-25 61 26-60 28z" fill="#e4f4b8" /><path d="m20 48 59 29v63l-59-31z" fill="#b5cd8e" /><path d="m79 77 60-28v63l-60 28z" fill="#d0e6a6" /><path d="m50 35 61 28v32l-16 8V70L35 42z" fill="#6f8e5a" /><path d="m100 118 23-10 M100 123l15-7" stroke="#7a9664" strokeWidth="3" /></svg>
);

export function markersFor(d: { location?: any; courier?: any }): Marker[] {
  const m: Marker[] = [];
  if (d.location?.lat != null) m.push({ lat: d.location.lat, lng: d.location.lng, kind: 'customer', label: 'Client' });
  const p = d.courier?.position;
  if (p) m.push({ lat: p.lat, lng: p.lng, kind: 'courier', label: `Livreur · ${p.stale ? 'position périmée' : 'récente'}`, stale: p.stale });
  return m;
}

function LiveCard({ id }: { id: string }) {
  const q = useData(() => api(`/api/merchant/orders/${id}`), [id], { live: true });
  if (!q.data) return null;
  const d = q.data;
  return (
    <section className="card">
      <div className="cardhead between"><h3>Votre livraison en direct</h3><span className="tag">#{d.order.ref}</span></div>
      <MapView markers={markersFor(d)} badge={<><span className="dot" />{ORDER_STATUS_LABEL[d.order.status as keyof typeof ORDER_STATUS_LABEL]}</>} />
      <div className="tracking">
        <div className="between"><div><small>Destination</small><div className="eta" style={{ fontSize: 24 }}>{d.order.dest_zone}</div></div><StatusTag status={d.order.status} /></div>
        <Progress status={d.order.status} />
        <small>Pas d’heure d’arrivée calculée : suivez la dernière position connue du livreur.</small>
        {d.courier && <CourierLine name={d.courier.name} phone={d.courier.phone} position={d.courier.position} />}
        <Link className="secondary block" to={`/m/livraisons/${id}`}>Suivre la livraison<Icon name="arrow" /></Link>
      </div>
    </section>
  );
}

export function MerchantHome() {
  const { me } = useSession();
  const q = useData(() => api('/api/merchant/dashboard'), [], { live: true });
  const first = me?.user.name.split(' ')[0];
  return (
    <>
      <Intro title={`Bonjour, ${first} 👋`} sub="Une belle journée pour faire avancer vos livraisons."
        action={<Link className="primary iconOnly" to="/m/nouvelle" aria-label="Nouvelle livraison">Nouvelle livraison<Icon name="plus" /></Link>} />
      <Async q={q}>{(d: any) => (
        <div className="grid">
          <div>
            <section className="hero">
              <div className="heroContent">
                <span className="tag dark">VOTRE QUOTIDIEN, PLUS LÉGER</span>
                <h2>Vous vendez.<br />On s’occupe du trajet.</h2>
                <p>Un colis, un repère, et c’est parti. Vos clients sont entre de bonnes mains.</p>
                <Link className="primary lime" to="/m/nouvelle">Envoyer un colis<Icon name="arrow" /></Link>
              </div>
              <Package />
            </section>
            <div className="stats">
              <Stat label="Livrées aujourd’hui" value={d.stats.delivered_today} sub={`Hier : ${d.stats.delivered_yesterday}`} icon="box" />
              <Stat label="En cours" value={String(d.stats.in_progress).padStart(2, '0')} sub={d.stats.awaiting_location ? `${d.stats.awaiting_location} attendent la position` : 'Vos colis avancent'} icon="clock" to="/m/livraisons" />
              <Stat label="Frais de livraison" value={<>{new Intl.NumberFormat('fr-FR').format(d.stats.fees_today)} <span style={{ fontSize: 12 }}>F</span></>} sub="Livrées aujourd’hui · FCFA" icon="wallet" to="/m/paiements" />
            </div>
            <section className="card">
              <div className="cardhead between"><h2>Vos livraisons</h2><Link className="textbtn" to="/m/livraisons">Tout voir ↗</Link></div>
              <OrderList items={d.recent} base="/m/livraisons" empty="Aucune livraison pour l’instant. Créez la première !" />
            </section>
          </div>
          <div>
            {d.liveId ? <LiveCard id={d.liveId} /> : (
              <section className="card tracking"><h3>Aucune livraison en route</h3><p className="muted">Le suivi en direct apparaît ici dès qu’un livreur prend votre colis.</p></section>
            )}
            <section className="quick"><div className="flex"><Icon name="pin" /><h3>Le bon repère change tout.</h3></div>
              <p>Votre client reçoit un lien pour partager sa position, une photo ou une note vocale. Moins d’appels, plus de sérénité.</p></section>
          </div>
        </div>
      )}</Async>
    </>
  );
}

export function MerchantOrders() {
  const [filter, setFilter] = useState('active');
  const [search, setSearch] = useState('');
  const q = useData(() => api(`/api/merchant/orders?filter=${filter}&q=${encodeURIComponent(search)}`), [filter, search], { live: true });
  const labels: Record<string, string> = { active: 'En cours', delivered: 'Livrées', cancelled: 'Annulées', all: 'Toutes' };
  return (
    <>
      <Intro title="Vos livraisons" sub="Chaque colis, au bon endroit." action={<Link className="primary iconOnly" to="/m/nouvelle" aria-label="Nouvelle livraison">Nouvelle livraison<Icon name="plus" /></Link>} />
      <section className="card">
        <div className="cardhead"><label className="field" style={{ margin: 0 }}><span className="eyebrow">Rechercher</span><input type="search" placeholder="Nom du client ou n° YN-…" value={search} onChange={(e) => setSearch(e.target.value)} /></label></div>
        <div className="filters" role="tablist">{Object.entries(labels).map(([k, l]) => <button key={k} role="tab" aria-selected={filter === k} className={filter === k ? 'active' : ''} onClick={() => setFilter(k)}>{l}</button>)}</div>
        <Async q={q}>{(items: any[]) => <OrderList items={items} base="/m/livraisons" />}</Async>
      </section>
    </>
  );
}

// ---------- Création en 3 étapes ----------
type Draft = { customerName: string; customerPhone: string; orderAmount: string; pickupAddress: string; pickupZoneId: string; destZoneId: string; destHint: string; deliveryPayer: 'merchant' | 'customer'; key: string };
const DRAFT_KEY = 'yoon_draft_order';

export function NewOrder() {
  const { me } = useSession();
  const navigate = useNavigate();
  const [zones, setZones] = useState<any[]>([]);
  const [step, setStep] = useState(1);
  const blank = (): Draft => ({ customerName: '', customerPhone: '', orderAmount: '', pickupAddress: me?.shop?.pickup_address ?? '', pickupZoneId: String(me?.shop?.zone_id ?? ''), destZoneId: '', destHint: '', deliveryPayer: 'merchant', key: newIdempotencyKey() });
  // Brouillon conservé localement : survit à une coupure réseau ou à un rechargement.
  const [d, setD] = useState<Draft>(() => { try { return { ...blank(), ...JSON.parse(localStorage.getItem(DRAFT_KEY) ?? '{}') }; } catch { return blank(); } });
  const [quote, setQuote] = useState<{ price: number; isDemo: boolean } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { run, busy, error, setError } = useAction();
  useEffect(() => { api('/api/zones').then((z) => setZones(z.filter((x: any) => x.active))).catch(() => {}); }, []);
  useEffect(() => { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); }, [d]);
  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setD({ ...d, [k]: e.target.value });
  const zoneName = (id: string) => zones.find((z) => String(z.id) === id)?.name ?? '—';

  async function toSummary() {
    setError(null);
    const r = await run(() => api('/api/merchant/quote', { body: { pickupZoneId: Number(d.pickupZoneId), destZoneId: Number(d.destZoneId) } }));
    if (r) { setQuote(r); setStep(3); }
  }
  async function confirm() {
    try {
      const r = await api('/api/merchant/orders', { idempotencyKey: d.key, body: {
        customerName: d.customerName, customerPhone: d.customerPhone, orderAmount: Number(d.orderAmount || 0), pickupAddress: d.pickupAddress,
        pickupZoneId: Number(d.pickupZoneId), destZoneId: Number(d.destZoneId), destHint: d.destHint, deliveryPayer: d.deliveryPayer, expectedPrice: quote!.price } });
      localStorage.removeItem(DRAFT_KEY);
      navigate(`/m/livraisons/${r.orderId}?nouvelle=1`);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'price_changed') { setQuote({ ...quote!, price: e.details.price }); setNotice('Le tarif vient de changer. Vérifiez le nouveau prix puis confirmez.'); }
      else setError(e instanceof ApiError ? e.message : 'Erreur');
    }
  }
  return (
    <>
      <Intro title="Une livraison, en quelques gestes." sub="Les informations utiles. Rien de plus." />
      <section className="card formcard">
        <div className="between">
          <button className="textbtn" onClick={() => (step > 1 ? setStep(step - 1) : navigate('/m'))}><Icon name="back" />Retour</button>
          <small>Étape {step} sur 3</small>
        </div>
        <div className="steps">{[1, 2, 3].map((s) => <span key={s} className={s <= step ? 'on' : ''} />)}</div>
        {step === 1 && (
          <form onSubmit={(e) => { e.preventDefault(); setStep(2); }}>
            <h2>À qui livre-t-on ?</h2>
            <p className="muted">Le client recevra un lien pour préciser sa position et ses repères.</p>
            <Field label="Nom du client"><input required minLength={2} placeholder="Ex. Aïssatou Diop" value={d.customerName} onChange={set('customerName')} autoComplete="off" /></Field>
            <Field label="Téléphone WhatsApp du client" hint="Numéro sénégalais (77, 78, 76, 70, 75…)."><input required type="tel" inputMode="tel" placeholder="77 000 00 00" value={d.customerPhone} onChange={set('customerPhone')} /></Field>
            <Field label="Montant de la commande (FCFA)" hint="Payé par le client directement à votre boutique. 0 si déjà réglé."><input required type="number" min={0} step={1} inputMode="numeric" placeholder="Ex. 12500" value={d.orderAmount} onChange={set('orderAmount')} /></Field>
            <button className="primary block">Continuer<Icon name="arrow" /></button>
          </form>
        )}
        {step === 2 && (
          <form onSubmit={(e) => { e.preventDefault(); toSummary(); }}>
            <h2>D’où part le colis ?</h2>
            <Field label="Lieu de retrait"><input required minLength={3} value={d.pickupAddress} onChange={set('pickupAddress')} /></Field>
            <div className="two">
              <Field label="Zone de retrait"><select required value={d.pickupZoneId} onChange={set('pickupZoneId')}><option value="">Choisir…</option>{zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}</select></Field>
              <Field label="Zone de livraison"><select required value={d.destZoneId} onChange={set('destZoneId')}><option value="">Choisir…</option>{zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}</select></Field>
            </div>
            <Field label="Indication (facultatif)" hint="Le client précisera lui-même sa position."><input value={d.destHint} onChange={set('destHint')} placeholder="Ex. Cité Avion" /></Field>
            <Field label="Qui paie la livraison ?">
              <select value={d.deliveryPayer} onChange={set('deliveryPayer')}><option value="merchant">Moi (commerçant)</option><option value="customer">Le client</option></select>
            </Field>
            <div className="notice">Le client devra partager sa position avant l’attribution d’un livreur.</div>
            {error && <p className="err-text" role="alert">{error}</p>}
            <button className="primary block" disabled={busy}>{busy ? 'Calcul du prix…' : 'Voir le récapitulatif'}<Icon name="arrow" /></button>
          </form>
        )}
        {step === 3 && quote && (
          <>
            <h2>Tout est prêt ?</h2>
            {notice && <div className="notice warn" role="alert">{notice}</div>}
            <div className="bill">
              <div className="between"><span>Client</span><b>{d.customerName} · {d.customerPhone}</b></div>
              <div className="between"><span>Retrait</span><b>{d.pickupAddress} ({zoneName(d.pickupZoneId)})</b></div>
              <div className="between"><span>Livraison</span><b>{zoneName(d.destZoneId)}</b></div>
              <div className="between"><span>Commande (payée à votre boutique)</span><b>{money(Number(d.orderAmount || 0))}</b></div>
              <hr />
              <div className="between"><span>Prix de la course</span><b style={{ fontSize: 18 }}>{money(quote.price)}</b></div>
              <small>À la charge {d.deliveryPayer === 'merchant' ? 'de votre boutique' : 'du client'} · payée au service Yoon · prix fixe par zone{quote.isDemo ? ' · TARIF DE DÉMONSTRATION' : ''}</small>
            </div>
            <div className="notice">Deux paiements distincts : la commande vous est payée directement ; la course est payée au service. Le livreur ne manipule pas d’argent.</div>
            {error && <p className="err-text" role="alert">{error}</p>}
            <ConfirmButton onConfirm={confirm} />
          </>
        )}
      </section>
    </>
  );
}
function ConfirmButton({ onConfirm }: { onConfirm: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return <button className="primary block" disabled={busy} onClick={async () => { setBusy(true); await onConfirm(); setBusy(false); }}>{busy ? 'Confirmation…' : 'Confirmer la livraison'}<Icon name="check" /></button>;
}

// ---------- Détail ----------
export function PaymentDeclare({ ob, orderId, client, onDone }: { ob: any; orderId: string; client?: boolean; onDone: () => void }) {
  const [method, setMethod] = useState<PaymentMethod>('wave');
  const [reference, setReference] = useState('');
  const [mediaId, setMediaId] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const { run, busy, error } = useAction();
  return (
    <form onSubmit={async (e) => {
      e.preventDefault();
      const url = client ? `/api/client/obligations/${ob.id}/declare` : `/api/merchant/obligations/${ob.id}/declare`;
      const ok = await run(() => api(url, { client, body: { ...(client ? {} : { orderId }), method, reference: reference || undefined, mediaId: mediaId ?? undefined } }), 'Justificatif envoyé : vérification en attente.');
      if (ok) onDone();
    }}>
      {(['wave', 'orange_money'] as const).map((m) => (
        <button type="button" key={m} className={`payment ${method === m ? 'chosen' : ''}`} aria-pressed={method === m} onClick={() => setMethod(m)}>
          <span className={`paylogo ${m === 'wave' ? '' : 'om'}`}>{m === 'wave' ? '≈' : 'O'}</span><b>{METHOD_LABEL[m]}</b><span style={{ marginLeft: 'auto' }}>{method === m ? '●' : '○'}</span>
        </button>
      ))}
      <Field label="Référence du transfert" hint="Indiquée dans le SMS ou l’écran de confirmation."><input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} /></Field>
      {preview && <img className="thumb" src={preview} alt="Capture du paiement" />}
      <div className="two" style={{ marginTop: 12 }}>
        <label className="secondary" style={{ cursor: 'pointer' }}>{mediaId ? 'Changer la capture' : 'Joindre la capture'}<Icon name="camera" />
          <input type="file" accept="image/*" hidden onChange={async (e) => {
            const f = e.target.files?.[0]; if (!f) return;
            const blob = await compressImage(f);
            const id = await run(() => uploadMedia(blob, orderId, 'proof', client));
            if (id) { setMediaId(id); setPreview(URL.createObjectURL(blob)); }
          }} />
        </label>
        <button className="primary" disabled={busy || (!reference.trim() && !mediaId)}>{busy ? 'Envoi…' : 'Envoyer le justificatif'}<Icon name="check" /></button>
      </div>
      {error && <p className="err-text" role="alert">{error}</p>}
      <p className="muted" style={{ fontSize: 12 }}>Un justificatif signifie « à vérifier » : le paiement n’est compté qu’après contrôle du transfert reçu.</p>
    </form>
  );
}

function ConfirmReceived({ ob, onDone }: { ob: any; onDone: () => void }) {
  const [method, setMethod] = useState<PaymentMethod>(ob.method ?? 'wave');
  const [reference, setReference] = useState(ob.proofs?.[0]?.declared_reference ?? '');
  const [amount, setAmount] = useState(String(ob.amount));
  const { run, busy, error } = useAction();
  return (
    <form onSubmit={async (e) => { e.preventDefault(); if (await run(() => api(`/api/merchant/obligations/${ob.id}/confirm`, { body: { method, reference, amountReceived: Number(amount) } }), 'Paiement confirmé.')) onDone(); }}>
      <p className="muted">Vérifiez sur votre compte {METHOD_LABEL[method]} que le transfert de {fcfa(ob.amount)} est bien arrivé.</p>
      <Field label="Moyen"><select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}><option value="wave">Wave</option><option value="orange_money">Orange Money</option></select></Field>
      <Field label="Référence du transfert reçu"><input required minLength={3} value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
      <Field label="Montant reçu (FCFA)"><input required type="number" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
      {error && <p className="err-text" role="alert">{error}</p>}
      <button className="primary block" disabled={busy}>Confirmer la réception<Icon name="check" /></button>
    </form>
  );
}

export function MerchantOrder() {
  const { id = '' } = useParams();
  const q = useData(() => api(`/api/merchant/orders/${id}`), [id], { live: true });
  const [modal, setModal] = useState<null | 'cancel' | 'report' | { declare: any } | { confirm: any } | { reject: any }>(null);
  const { run, busy } = useAction();
  const isNew = useMemo(() => new URLSearchParams(location.search).get('nouvelle') === '1', []);
  const [text, setText] = useState('');
  return (
    <Async q={q} lines={6}>{(d: any) => {
      const o = d.order;
      const waiting = o.status === 'awaiting_location';
      return (
        <>
          <Intro eyebrow={`Livraison #${o.ref}`} title={waiting ? 'En attente de la position du client.' : ORDER_STATUS_LABEL[o.status as keyof typeof ORDER_STATUS_LABEL]}
            sub={`${o.customer_name} · ${o.pickup_zone} → ${o.dest_zone} · ${when(o.created_at)}`} action={<StatusTag status={o.status} />} />
          {isNew && <div className="notice" role="status">Livraison créée. Envoyez maintenant la demande de position à votre client via WhatsApp.</div>}
          <div className="grid">
            <div>
              {(waiting || d.messages.some((m: any) => m.status !== 'confirmed_sent' && m.status !== 'failed')) && (
                <section className="card" style={{ marginBottom: 20 }}>
                  <div className="cardhead between"><h3>Messages au client</h3><button className="textbtn" disabled={busy} onClick={() => run(() => api(`/api/merchant/orders/${id}/client-link`, { method: 'POST' }), 'Nouveau lien prêt. L’ancien ne fonctionne plus.').then(q.reload)}>Nouveau lien ↻</button></div>
                  {waiting && <div className="notice warn" style={{ margin: '0 22px' }}>Aucun livreur ne sera proposé avant la position du client. Ouvrez WhatsApp, envoyez le message, puis confirmez l’envoi.</div>}
                  <Messages items={d.messages} reload={q.reload} />
                </section>
              )}
              <section className="card">
                <MapView markers={markersFor(d)} badge={d.location ? `Repère ${d.location.source === 'gps' ? 'GPS' : d.location.source === 'map' ? 'placé sur la carte' : 'saisi'} · ${time(d.location.at)}` : 'Position non reçue'} />
                <div className="tracking">
                  <Progress status={o.status} />
                  {d.courier ? <CourierLine name={d.courier.name} phone={d.courier.phone} position={d.courier.position} /> : <p className="muted">{waiting ? 'Le client n’a pas encore partagé sa position.' : 'Livreur pas encore attribué. L’équipe s’en occupe.'}</p>}
                  {d.location && (
                    <div style={{ marginTop: 14 }}>
                      {d.location.landmark && <div className="notice">Repère : {d.location.landmark}</div>}
                      {d.location.photoUrl && <img className="thumb" src={d.location.photoUrl} alt="Photo du lieu envoyée par le client" />}
                      {d.location.voiceUrl && <audio controls src={d.location.voiceUrl} />}
                    </div>
                  )}
                </div>
              </section>
              <section className="card">
                <div className="cardhead"><h2>Paiements</h2></div>
                {d.obligations.map((ob: any) => (
                  <div key={ob.id} className="list-item">
                    <div className="between wrap"><b>{OBLIGATION_KIND_LABEL[ob.kind as keyof typeof OBLIGATION_KIND_LABEL]}</b><PayTag status={ob.status} /></div>
                    <div className="between" style={{ marginTop: 6 }}><small>Payé par {ob.payer === 'merchant' ? 'vous' : 'le client'} {ob.method ? `· ${METHOD_LABEL[ob.method as PaymentMethod]}` : ''} {ob.reference ? `· réf. ${ob.reference}` : ''}</small><b>{money(ob.amount)}</b></div>
                    <div className="row" style={{ marginTop: 8 }}>
                      {ob.payer === 'merchant' && ['due', 'rejected'].includes(ob.status) && <button className="secondary" onClick={() => setModal({ declare: ob })}>Déclarer mon paiement<Icon name="wallet" /></button>}
                      {ob.payee === 'merchant' && ['due', 'declared', 'rejected'].includes(ob.status) && <button className="secondary" onClick={() => setModal({ confirm: ob })}>J’ai reçu ce paiement<Icon name="check" /></button>}
                      {ob.payee === 'merchant' && ob.status === 'declared' && <button className="danger" onClick={() => setModal({ reject: ob })}>Refuser le justificatif</button>}
                    </div>
                  </div>
                ))}
              </section>
            </div>
            <div>
              <section className="card">
                <div className="cardhead"><h2>Les étapes de votre colis</h2></div>
                <Timeline events={d.timeline} />
              </section>
              <section className="card pad">
                <Kv rows={[['Client', `${o.customer_name} · ${formatPhone(o.customer_phone)}`], ['Retrait', o.pickup_address], ['Indication', o.dest_hint], ['Course', `${money(o.delivery_price)} · payée par ${o.delivery_payer === 'merchant' ? 'vous' : 'le client'}`]]} />
                {d.cancellation && <div className="notice">Annulée : {d.cancellation.reason}{d.cancellation.fee ? ` · frais ${money(d.cancellation.fee)}` : ' · sans frais'}</div>}
                {d.incidents.map((i: any) => <div key={i.id} className={`notice ${i.status === 'open' ? 'warn' : ''}`}>{i.description} · {i.status === 'open' ? 'en cours de traitement' : `traité : ${i.resolution}`}</div>)}
                <div className="two" style={{ marginTop: 12 }}>
                  <button className="secondary" onClick={() => { setText(''); setModal('report'); }}>Signaler un problème<Icon name="bell" /></button>
                  {d.canCancel && <button className="danger" onClick={() => { setText(''); setModal('cancel'); }}>Annuler</button>}
                </div>
              </section>
            </div>
          </div>
          {modal === 'cancel' && (
            <Modal title={`Annuler #${o.ref}`} onClose={() => setModal(null)}>
              <div className={`notice ${d.cancelHasFee ? 'warn' : ''}`}>{d.cancelHasFee ? 'Un livreur est déjà attribué : des frais d’annulation s’appliquent (montant selon la grille en vigueur).' : 'Annulation gratuite : aucun livreur n’est encore attribué.'}</div>
              <Field label="Motif"><textarea required value={text} onChange={(e) => setText(e.target.value)} /></Field>
              <button className="danger block" disabled={busy || text.trim().length < 3} onClick={async () => { if (await run(() => api(`/api/merchant/orders/${id}/cancel`, { body: { reason: text } }), 'Livraison annulée.')) { setModal(null); q.reload(); } }}>Confirmer l’annulation</button>
            </Modal>
          )}
          {modal === 'report' && (
            <Modal title="Signaler un problème" onClose={() => setModal(null)}>
              <Field label="Que se passe-t-il ?"><textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Décrivez la situation…" /></Field>
              <button className="primary block" disabled={busy || !text.trim()} onClick={async () => { if (await run(() => api(`/api/merchant/orders/${id}/report`, { body: { type: 'complaint', description: text } }), 'Signalement transmis à l’équipe.')) { setModal(null); q.reload(); } }}>Envoyer le signalement<Icon name="arrow" /></button>
            </Modal>
          )}
          {modal && typeof modal === 'object' && 'declare' in modal && <Modal title="Déclarer le paiement de la course" onClose={() => setModal(null)}><p className="muted">{money(modal.declare.amount)} à payer au service Yoon.</p><PaymentDeclare ob={modal.declare} orderId={id} onDone={() => { setModal(null); q.reload(); }} /></Modal>}
          {modal && typeof modal === 'object' && 'confirm' in modal && <Modal title="Confirmer la réception" onClose={() => setModal(null)}><ConfirmReceived ob={modal.confirm} onDone={() => { setModal(null); q.reload(); }} /></Modal>}
          {modal && typeof modal === 'object' && 'reject' in modal && (
            <Modal title="Refuser le justificatif" onClose={() => setModal(null)}>
              <Field label="Raison (visible par l’équipe)"><textarea value={text} onChange={(e) => setText(e.target.value)} /></Field>
              <button className="danger block" disabled={busy || !text.trim()} onClick={async () => { if (await run(() => api(`/api/merchant/obligations/${modal.reject.id}/reject`, { body: { note: text } }), 'Justificatif refusé.')) { setModal(null); q.reload(); } }}>Refuser</button>
            </Modal>
          )}
        </>
      );
    }}</Async>
  );
}

export function MerchantWallet() {
  const [date, setDate] = useState(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Dakar' }).format(new Date()));
  const q = useData(() => api(`/api/merchant/payments?date=${date}`), [date], { live: true });
  return (
    <>
      <Intro title="Vos paiements, au même endroit." sub="Reçu, déclaré, à vérifier : chaque statut est distinct." />
      <Async q={q}>{(d: any) => (
        <div className="grid">
          <div>
            <section className="balance">
              <small>Frais de livraison · courses livrées le {date}</small>
              <div className="bigmoney">{new Intl.NumberFormat('fr-FR').format(d.recap.totals.delivery_fees)} <span style={{ fontSize: 18 }}>F CFA</span></div>
              <span className="tag dark">{d.recap.totals.delivered} livraison{d.recap.totals.delivered > 1 ? 's' : ''} ce jour</span>
            </section>
            <section className="card">
              <div className="cardhead"><h2>Derniers paiements</h2></div>
              {d.obligations.length === 0 && <Empty>Aucun paiement pour l’instant.</Empty>}
              {d.obligations.map((p: any) => (
                <Link key={p.id} className="delivery" to={`/m/livraisons/${p.order_id}`}>
                  <div className="between"><div><b>#{p.ref} · {p.customer_name}</b><small>{OBLIGATION_KIND_LABEL[p.kind as keyof typeof OBLIGATION_KIND_LABEL]} · payé par {p.payer === 'merchant' ? 'vous' : 'le client'}</small></div><b>{money(p.amount)}</b></div>
                  <div style={{ marginTop: 8 }}><PayTag status={p.status} /></div>
                </Link>
              ))}
            </section>
          </div>
          <section className="card tracking">
            <h2>Récapitulatif du jour</h2>
            <Field label="Date"><input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></Field>
            <div className="bill">
              <div className="between"><span>Livraisons créées</span><b>{d.recap.totals.created}</b></div>
              <div className="between"><span>Livrées</span><b>{d.recap.totals.delivered}</b></div>
              <div className="between"><span>Annulées</span><b>{d.recap.totals.cancelled}</b></div>
              <hr />
              <div className="between"><span>Paiements reçus (vérifiés)</span><b>{money(d.recap.received)}</b></div>
              <div className="between"><span>Paiements non confirmés</span><b>{d.recap.unconfirmed}</b></div>
            </div>
            <p className="muted" style={{ fontSize: 12 }}>« Déclaré · à vérifier » n’est pas compté comme reçu. Le récap WhatsApp est envoyé par l’équipe en fin de journée.</p>
          </section>
        </div>
      )}</Async>
    </>
  );
}

export function MerchantProfile() {
  const { me, reload } = useSession();
  const s = me!.shop;
  const [zones, setZones] = useState<any[]>([]);
  const [f, setF] = useState({ name: s.name, pickupAddress: s.pickup_address, zoneId: String(s.zone_id), waveNumber: s.wave_number ?? '', orangeMoneyNumber: s.orange_money_number ?? '' });
  const { run, busy, error } = useAction();
  useEffect(() => { api('/api/zones').then((z) => setZones(z.filter((x: any) => x.active))).catch(() => {}); }, []);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <>
      <Intro title="Votre espace, simplement." sub={`${s.name} · ${s.zone_name}`} />
      <section className="card formcard">
        <div className="flex"><span className="avatar" style={{ width: 60, height: 60, fontSize: 20 }}>{me!.user.name.split(' ').map((w) => w[0]).join('').slice(0, 2)}</span>
          <div><h2>{me!.user.name}</h2><p className="muted" style={{ margin: '4px 0' }}>Commerçant · {formatPhone(me!.user.phone)}</p></div></div>
        <form onSubmit={async (e) => { e.preventDefault(); if (await run(() => api('/api/merchant/shop', { method: 'PATCH', body: { ...f, zoneId: Number(f.zoneId) } }), 'Profil enregistré.')) reload(); }}>
          <Field label="Nom de la boutique"><input required value={f.name} onChange={set('name')} /></Field>
          <Field label="Lieu de retrait"><input required value={f.pickupAddress} onChange={set('pickupAddress')} /></Field>
          <Field label="Zone de retrait"><select value={f.zoneId} onChange={set('zoneId')}>{zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}</select></Field>
          <div className="two">
            <Field label="Numéro Wave" hint="Où vos clients paient la commande."><input type="tel" value={f.waveNumber} onChange={set('waveNumber')} /></Field>
            <Field label="Numéro Orange Money"><input type="tel" value={f.orangeMoneyNumber} onChange={set('orangeMoneyNumber')} /></Field>
          </div>
          {error && <p className="err-text" role="alert">{error}</p>}
          <button className="primary block" disabled={busy}>Enregistrer<Icon name="check" /></button>
        </form>
        <p className="notice">Langue : français. L’interface wolof reste à traduire et à faire valider avant d’être proposée ; vos clients peuvent déjà laisser une note vocale.</p>
      </section>
    </>
  );
}
