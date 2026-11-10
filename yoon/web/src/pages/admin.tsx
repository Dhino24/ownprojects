import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useData } from '../lib/live';
import { ago, dakarDay, fcfa, formatPhone, money, time, when } from '../lib/format';
import { Icon } from '../components/Icon';
import { Async, Empty, Field, Intro, Kv, Modal, PayTag, Stat, StatusTag, useAction } from '../components/ui';
import { CourierLine, Messages, OrderList, Timeline } from '../components/orders';
import { MapView, type Marker } from '../components/MapView';
import { INCIDENT_LABEL, METHOD_LABEL, OBLIGATION_KIND_LABEL, OFFER_STATUS_LABEL, ORDER_STATUS_LABEL, ORDER_STATUSES, type PaymentMethod } from '../../../shared/contract';

function Freshness({ p }: { p: any }) {
  if (!p) return <span className="tag grey">Position inconnue</span>;
  return <span className={`tag ${p.stale ? 'orange' : ''}`}><span className={`dot ${p.stale ? 'stale' : ''}`} />{p.stale ? 'Périmée · ' : ''}{ago(p.ageSec)}</span>;
}

export function AdminOverview() {
  const q = useData(() => api('/api/admin/overview'), [], { live: true, every: 10000 });
  return (
    <>
      <Intro title="Tout Dakar, en un regard." sub="Attribuez les courses et gardez le fil des opérations." />
      <Async q={q}>{(d: any) => (
        <>
          <div className="stats four">
            <Stat label="Courses à attribuer" value={d.stats.to_assign} sub={`${d.stats.awaiting_location} attendent la position`} icon="box" />
            <Stat label="Livreurs disponibles" value={d.stats.couriers_available} sub={d.stats.couriers_pending ? `${d.stats.couriers_pending} à valider` : 'Validés et en ligne'} icon="user" to="/a/livreurs" />
            <Stat label="Paiements à vérifier" value={d.stats.payments_to_verify} sub="Contrôle manuel" icon="wallet" to="/a/paiements" />
            <Stat label="Incidents ouverts" value={d.stats.open_incidents} sub="Décision requise" icon="alert" to="/a/incidents" />
          </div>
          <div className="grid">
            <section className="card">
              <div className="cardhead between"><h2>Centre des opérations</h2><span className="tag"><span className="dot" />Temps réel</span></div>
              <OrderList items={d.active} base="/a/livraisons" showShop empty="Aucune course en cours." />
              <div className="pad"><Link className="textbtn" to="/a/livraisons">Toutes les livraisons ↗</Link></div>
            </section>
            <section className="card">
              <div className="cardhead"><h3>Livreurs validés</h3><small>La proximité n’est indicative que si la position est récente.</small></div>
              <div style={{ padding: '0 22px 12px' }}>
                {d.couriers.length === 0 && <Empty>Aucun livreur validé.</Empty>}
                {d.couriers.map((c: any) => (
                  <div key={c.id} className="driver">
                    <span className="avatar">{c.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2)}</span>
                    <div><b>{c.name}</b><small>{c.active_ref ? `En course #${c.active_ref}` : c.pending_offer ? 'Offre en attente' : c.home_zone ?? '—'}</small></div>
                    <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                      <span className={`tag ${c.available ? '' : 'grey'}`}>{c.available ? 'Disponible' : 'Hors ligne'}</span><br /><Freshness p={c.position} />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </>
      )}</Async>
    </>
  );
}

export function AdminOrders() {
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const q = useData(() => api(`/api/admin/orders?status=${status}&q=${encodeURIComponent(search)}`), [status, search], { live: true });
  return (
    <>
      <Intro title="Livraisons" sub="Recherche par numéro, client ou boutique." />
      <section className="card">
        <div className="cardhead two">
          <Field label="Rechercher"><input type="search" value={search} onChange={(e) => setSearch(e.target.value)} /></Field>
          <Field label="Statut"><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Tous</option>{ORDER_STATUSES.map((s) => <option key={s} value={s}>{ORDER_STATUS_LABEL[s]}</option>)}</select></Field>
        </div>
        <Async q={q}>{(items: any[]) => <OrderList items={items} base="/a/livraisons" showShop />}</Async>
      </section>
    </>
  );
}

function OfferTimer({ o }: { o: any }) {
  const offset = useMemo(() => new Date(o.server_now).getTime() - Date.now(), [o.server_now]);
  const [left, setLeft] = useState(0);
  useEffect(() => {
    const f = () => setLeft(Math.max(0, Math.ceil((new Date(o.expires_at).getTime() - Date.now() - offset) / 1000)));
    f();
    const t = setInterval(f, 500);
    return () => clearInterval(t);
  }, [o.expires_at, offset]);
  return <span className="tag orange">{left > 0 ? `${left} s` : 'expire…'}</span>;
}

export function AdminOrder() {
  const { id = '' } = useParams();
  const q = useData(() => api(`/api/admin/orders/${id}`), [id], { live: true, every: 5000 });
  const { run, busy } = useAction();
  const [modal, setModal] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const act = async (fn: () => Promise<unknown>, msg: string) => { if (await run(fn, msg)) { setModal(null); q.reload(); } };
  return (
    <Async q={q} lines={8}>{(d: any) => {
      const o = d.order;
      const pending = d.offers.find((f: any) => f.status === 'pending');
      const markers: Marker[] = [];
      if (d.location?.lat != null) markers.push({ lat: d.location.lat, lng: d.location.lng, kind: 'customer', label: 'Client' });
      if (d.pickup) markers.push({ ...d.pickup, kind: 'pickup', label: 'Retrait' });
      if (d.courierPosition) markers.push({ lat: d.courierPosition.lat, lng: d.courierPosition.lng, kind: 'courier', label: 'Livreur', stale: d.courierPosition.stale });
      return (
        <>
          <Intro eyebrow={`#${o.ref} · ${o.shop_name}`} title={ORDER_STATUS_LABEL[o.status as keyof typeof ORDER_STATUS_LABEL]} sub={`${o.customer_name} · ${o.pickup_zone} → ${o.dest_zone} · créée ${when(o.created_at)}`} action={<StatusTag status={o.status} />} />
          <div className="grid">
            <div>
              {['ready', 'offered'].includes(o.status) && (
                <section className="card" style={{ marginBottom: 20 }}>
                  <div className="cardhead between"><h2>Attribution</h2>{pending && <OfferTimer o={pending} />}</div>
                  {pending ? (
                    <div className="pad" style={{ paddingTop: 0 }}>
                      <p>Offre envoyée à <b>{pending.courier_name}</b>. Sans réponse dans le délai, la course redevient attribuable.</p>
                      <button className="secondary" disabled={busy} onClick={() => act(() => api(`/api/admin/offers/${pending.id}/withdraw`, { method: 'POST' }), 'Offre retirée.')}>Retirer l’offre</button>
                    </div>
                  ) : (
                    <div style={{ padding: '0 22px 16px' }}>
                      <div className="notice">Position client reçue. Proposez la course à un livreur disponible ; il aura 30 secondes pour répondre.</div>
                      {d.candidates.length === 0 && <Empty>Aucun livreur disponible.</Empty>}
                      {d.candidates.map((c: any) => (
                        <div key={c.id} className="driver">
                          <span className="avatar">{c.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2)}</span>
                          <div><b>{c.name}</b><small>{c.distanceKm != null ? `≈ ${c.distanceKm} km du retrait (vol d’oiseau)` : 'Distance inconnue'} · <Freshness p={c.position} /></small></div>
                          <button className="primary" style={{ marginLeft: 'auto' }} disabled={busy || c.busy} onClick={() => act(() => api(`/api/admin/orders/${id}/offers`, { body: { courierId: c.id } }), `Offre envoyée à ${c.name}.`)}>{c.busy ? 'Occupé' : 'Proposer'}</button>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              )}
              {o.status === 'awaiting_location' && <div className="notice warn">Position du client non reçue : aucune offre possible. Relancez le client ou saisissez sa position après un appel.</div>}
              <section className="card">
                <MapView markers={markers} badge={d.location ? `Client : ${d.location.source} · ${time(d.location.at)}` : 'Position client absente'} />
                <div className="tracking">
                  {o.courier_name && <CourierLine name={o.courier_name} sub="Livreur attribué" phone={o.courier_phone} position={d.courierPosition} />}
                  {d.location?.landmark && <div className="notice">Repère : {d.location.landmark}</div>}
                  {d.location?.photoUrl && <img className="thumb" src={d.location.photoUrl} alt="Photo du lieu" />}
                  {d.location?.voiceUrl && <audio controls src={d.location.voiceUrl} />}
                  <div className="row" style={{ marginTop: 12 }}>
                    {!['delivered', 'cancelled'].includes(o.status) && <button className="secondary" onClick={() => { setForm({ landmark: d.location?.landmark ?? '' }); setModal('location'); }}>Saisir la position (appel)<Icon name="pin" /></button>}
                    {!['delivered', 'cancelled'].includes(o.status) && <button className="secondary" onClick={() => act(() => api(`/api/admin/orders/${id}/regenerate-code`, { method: 'POST' }), 'Nouveau code généré. Le client le voit sur son lien.')}>Nouveau code client</button>}
                    {!['delivered', 'cancelled'].includes(o.status) && <button className="danger" onClick={() => { setForm({ reason: '', refundDecision: '' }); setModal('cancel'); }}>Annuler la course</button>}
                  </div>
                  {d.code && <small>Code : {d.code.used ? 'utilisé' : `${d.code.attempts}/${d.code.max} essais · expire ${when(d.code.expires_at)}`}</small>}
                </div>
              </section>
              <section className="card">
                <div className="cardhead"><h2>Paiements</h2></div>
                {d.obligations.map((ob: any) => <ObligationRow key={ob.id} ob={ob} reload={q.reload} />)}
              </section>
              {d.incidents.length > 0 && (
                <section className="card">
                  <div className="cardhead"><h2>Incidents</h2></div>
                  {d.incidents.map((i: any) => <IncidentRow key={i.id} i={{ ...i, ref: o.ref }} proofs={d.proofs} reload={q.reload} />)}
                </section>
              )}
            </div>
            <div>
              <section className="card pad">
                <Kv rows={[['Client', `${o.customer_name} · ${formatPhone(o.customer_phone)}`], ['Retrait', o.pickup_address], ['Boutique', `${o.shop_name} · ${formatPhone(o.shop_phone)}`],
                  ['Course', `${money(o.delivery_price)} (livreur ${money(o.courier_earning)} · commission ${money(o.commission)})`], ['Payeur course', o.delivery_payer === 'merchant' ? 'Commerçant' : 'Client'],
                  ['Commande', money(o.order_amount)], ['Grille', `v${o.pricing_version_id}`]]} />
                {d.cancellation && <CancellationBox c={d.cancellation} id={id} reload={q.reload} />}
              </section>
              <section className="card">
                <div className="cardhead"><h3>Offres</h3></div>
                {d.offers.length === 0 ? <Empty>Aucune offre.</Empty> : d.offers.map((f: any) => <div key={f.id} className="list-item between"><span>{f.courier_name}<small style={{ display: 'block' }}>{time(f.created_at)}{f.responded_at ? ` → ${time(f.responded_at)}` : ''}</small></span><span className={`tag ${f.status === 'accepted' ? '' : f.status === 'pending' ? 'orange' : 'grey'}`}>{OFFER_STATUS_LABEL[f.status as keyof typeof OFFER_STATUS_LABEL]}</span></div>)}
                {d.contacts.length > 0 && <div className="list-item"><b>Tentatives de contact</b>{d.contacts.map((c: any, i: number) => <small key={i} style={{ display: 'block' }}>{c.channel === 'call' ? 'Appel' : 'WhatsApp'} · {time(c.created_at)}</small>)}</div>}
              </section>
              <section className="card"><div className="cardhead"><h3>Historique</h3></div><Timeline events={d.timeline} /></section>
              <section className="card"><div className="cardhead"><h3>Messages WhatsApp</h3></div><Messages items={d.messages} reload={q.reload} /></section>
            </div>
          </div>
          {modal === 'location' && (
            <Modal title="Position saisie par l’équipe" onClose={() => setModal(null)}>
              <p className="muted">Après un appel avec le client, touchez la carte à l’endroit indiqué.</p>
              <MapView height={260} pick={form.lat ? { lat: form.lat, lng: form.lng } : null} onPick={(p) => setForm({ ...form, ...p })} />
              <Field label="Repère"><textarea value={form.landmark} onChange={(e) => setForm({ ...form, landmark: e.target.value })} /></Field>
              <button className="primary block" disabled={busy || !form.lat} onClick={() => act(() => api(`/api/admin/orders/${id}/location`, { body: { lat: form.lat, lng: form.lng, landmark: form.landmark } }), 'Position enregistrée.')}>Enregistrer</button>
            </Modal>
          )}
          {modal === 'cancel' && (
            <Modal title={`Annuler #${o.ref}`} onClose={() => setModal(null)}>
              <div className="notice">{['awaiting_location', 'ready', 'offered'].includes(o.status) ? 'Avant attribution : annulation gratuite.' : 'Après attribution : frais selon la grille, modifiables ici. Indiquez la décision de remboursement.'}</div>
              <Field label="Motif"><textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></Field>
              {!['awaiting_location', 'ready', 'offered'].includes(o.status) && (
                <div className="two">
                  <Field label="Frais (FCFA)" hint="Vide = grille en vigueur."><input type="number" min={0} value={form.fee ?? ''} onChange={(e) => setForm({ ...form, fee: e.target.value })} /></Field>
                  <Field label="Part livreur (FCFA)"><input type="number" min={0} value={form.comp ?? ''} onChange={(e) => setForm({ ...form, comp: e.target.value })} /></Field>
                </div>
              )}
              <Field label="Remboursement"><select value={form.refundDecision} onChange={(e) => setForm({ ...form, refundDecision: e.target.value })}><option value="">Automatique (selon paiement reçu)</option><option value="none">Aucun</option><option value="to_refund">À rembourser</option><option value="refunded">Remboursé</option><option value="not_applicable">Sans objet</option></select></Field>
              <button className="danger block" disabled={busy || (form.reason ?? '').trim().length < 3} onClick={() => act(() => api(`/api/admin/orders/${id}/cancel`, { body: {
                reason: form.reason, fee: form.fee !== undefined && form.fee !== '' ? Number(form.fee) : undefined, courierCompensation: form.comp !== undefined && form.comp !== '' ? Number(form.comp) : undefined,
                refundDecision: form.refundDecision || undefined } }), 'Course annulée.')}>Confirmer l’annulation</button>
            </Modal>
          )}
        </>
      );
    }}</Async>
  );
}

function CancellationBox({ c, id, reload }: { c: any; id: string; reload: () => void }) {
  const [decision, setDecision] = useState(c.refund_decision);
  const [note, setNote] = useState(c.refund_note ?? '');
  const { run, busy } = useAction();
  return (
    <div className="notice" style={{ marginTop: 14 }}>
      <b>Annulée par {c.actor === 'admin' ? 'l’équipe' : 'le commerçant'}</b> · {when(c.created_at)}<br />Motif : {c.reason}<br />Frais : {money(c.fee)} · part livreur {money(c.courier_compensation)}
      <Field label="Décision de remboursement"><select value={decision} onChange={(e) => setDecision(e.target.value)}><option value="none">Aucun</option><option value="to_refund">À rembourser</option><option value="refunded">Remboursé</option><option value="not_applicable">Sans objet</option></select></Field>
      <Field label="Note"><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <button className="secondary" disabled={busy || note.trim().length < 3} onClick={() => run(() => api(`/api/admin/cancellations/${id}/refund`, { body: { decision, note } }), 'Décision enregistrée.').then(reload)}>Enregistrer</button>
    </div>
  );
}

function ObligationRow({ ob, reload, showOrder }: { ob: any; reload: () => void; showOrder?: boolean }) {
  const [mode, setMode] = useState<null | 'confirm' | 'reject'>(null);
  const [f, setF] = useState({ method: (ob.method ?? ob.proofs?.[0]?.method ?? 'wave') as PaymentMethod, reference: ob.proofs?.[ob.proofs.length - 1]?.declared_reference ?? '', amount: String(ob.amount), note: '' });
  const { run, busy, error } = useAction();
  const done = async (p: Promise<unknown> | undefined) => { if (await p) { setMode(null); reload(); } };
  return (
    <div className="list-item">
      <div className="between wrap">
        <div><b>{OBLIGATION_KIND_LABEL[ob.kind as keyof typeof OBLIGATION_KIND_LABEL]}</b>{showOrder && <small style={{ display: 'block' }}><Link to={`/a/livraisons/${ob.order_id}`}>#{ob.ref}</Link> · {ob.shop_name} · {ob.customer_name}</small>}
          <small style={{ display: 'block' }}>Payeur : {ob.payer === 'merchant' ? 'commerçant' : 'client'} → {ob.payee === 'merchant' ? 'commerçant' : 'service'}{ob.reference ? ` · réf. ${ob.reference}` : ''}</small></div>
        <div style={{ textAlign: 'right' }}><b>{money(ob.amount)}</b><br /><PayTag status={ob.status} /></div>
      </div>
      {(ob.proofs ?? []).map((p: any) => (
        <div key={p.id} className="notice">
          Justificatif {METHOD_LABEL[p.method as PaymentMethod]} · {p.declared_by === 'customer' ? 'client' : 'commerçant'} · {when(p.created_at)}{p.declared_reference ? ` · réf. déclarée ${p.declared_reference}` : ''} · {p.status === 'to_review' ? 'à vérifier' : p.status === 'accepted' ? 'accepté' : `refusé${p.review_note ? ` (${p.review_note})` : ''}`}
          {p.url && <a href={p.url} target="_blank" rel="noopener"><img className="thumb" src={p.url} alt="Capture du paiement" style={{ marginTop: 8, maxHeight: 160 }} /></a>}
        </div>
      ))}
      {['due', 'declared', 'rejected'].includes(ob.status) && !mode && (
        <div className="row"><button className="primary" onClick={() => setMode('confirm')}>Confirmer après contrôle<Icon name="check" /></button>{ob.status === 'declared' && <button className="danger" onClick={() => setMode('reject')}>Refuser</button>}</div>
      )}
      {mode === 'confirm' && (
        <form onSubmit={(e) => { e.preventDefault(); done(run(() => api(`/api/admin/obligations/${ob.id}/confirm`, { body: { method: f.method, reference: f.reference, amountReceived: Number(f.amount) } }), 'Paiement confirmé.')); }}>
          <div className="notice warn">Confirmez seulement après avoir vu le transfert sur le compte {ob.payee === 'service' ? 'du service' : 'du commerçant'}.</div>
          <div className="two">
            <Field label="Moyen"><select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value as PaymentMethod })}><option value="wave">Wave</option><option value="orange_money">Orange Money</option></select></Field>
            <Field label="Montant reçu"><input type="number" required value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          </div>
          <Field label="Référence du transfert reçu"><input required minLength={3} value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
          {error && <p className="err-text" role="alert">{error}</p>}
          <div className="row"><button className="primary" disabled={busy}>Confirmer</button><button type="button" className="secondary" onClick={() => setMode(null)}>Annuler</button></div>
        </form>
      )}
      {mode === 'reject' && (
        <form onSubmit={(e) => { e.preventDefault(); done(run(() => api(`/api/admin/obligations/${ob.id}/reject`, { body: { note: f.note } }), 'Justificatif refusé.')); }}>
          <Field label="Raison"><input required value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
          <div className="row"><button className="danger" disabled={busy}>Refuser</button><button type="button" className="secondary" onClick={() => setMode(null)}>Annuler</button></div>
        </form>
      )}
    </div>
  );
}

export function AdminPayments() {
  const [status, setStatus] = useState('declared');
  const q = useData(() => api(`/api/admin/payments?status=${status}`), [status], { live: true });
  const labels: Record<string, string> = { declared: 'À vérifier', due: 'À régler', rejected: 'Refusés', confirmed: 'Reçus', all: 'Tous' };
  return (
    <>
      <Intro title="Vérification des paiements" sub="Un justificatif = « à vérifier ». Confirmez seulement un transfert réellement reçu, avec sa référence." />
      <section className="card">
        <div className="filters" style={{ paddingTop: 18 }}>{Object.entries(labels).map(([k, l]) => <button key={k} className={status === k ? 'active' : ''} onClick={() => setStatus(k)}>{l}</button>)}</div>
        <Async q={q}>{(items: any[]) => items.length ? <>{items.map((ob) => <ObligationRow key={ob.id} ob={ob} reload={q.reload} showOrder />)}</> : <Empty>Rien dans cette catégorie.</Empty>}</Async>
      </section>
    </>
  );
}

function IncidentRow({ i, proofs, reload }: { i: any; proofs?: any[]; reload: () => void }) {
  const [note, setNote] = useState('');
  const [fee, setFee] = useState('');
  const { run, busy } = useAction();
  const resolve = (decision: string) => run(() => api(`/api/admin/incidents/${i.id}/resolve`, { body: { decision, note, fee: fee ? Number(fee) : undefined } }), 'Décision enregistrée.').then(reload);
  const photo = proofs?.find((p) => p.kind === 'photo' && p.status === 'pending_review');
  return (
    <div className="list-item">
      <div className="between wrap"><b>{INCIDENT_LABEL[i.type as keyof typeof INCIDENT_LABEL]} · <Link to={`/a/livraisons/${i.order_id}`}>#{i.ref}</Link></b><span className={`tag ${i.status === 'open' ? (i.blocking ? 'red' : 'orange') : ''}`}>{i.status === 'open' ? (i.blocking ? 'Bloquant' : 'Ouvert') : 'Traité'}</span></div>
      <small>{i.reported_by} · {when(i.created_at)}{i.shop_name ? ` · ${i.shop_name}` : ''}</small>
      <p style={{ margin: '6px 0' }}>{i.description}</p>
      {photo?.url && <img className="thumb" src={photo.url} alt="Preuve photo" />}
      {i.status === 'resolved' ? <small>Décision : {i.resolution}</small> : (
        <>
          <Field label="Décision / note (obligatoire)"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex. client joint par téléphone, confirme la réception" /></Field>
          <div className="row">
            {i.type === 'photo_proof' && <><button className="primary" disabled={busy || !note.trim()} onClick={() => resolve('approve_photo')}>Valider la remise</button><button className="secondary" disabled={busy || !note.trim()} onClick={() => resolve('reject_photo')}>Refuser · reprendre</button></>}
            {i.type === 'customer_not_found' && <><button className="secondary" disabled={busy || !note.trim()} onClick={() => resolve('resume')}>Reprendre la course</button>
              <Field label="Frais (vide = grille)"><input type="number" min={0} value={fee} onChange={(e) => setFee(e.target.value)} style={{ maxWidth: 140 }} /></Field>
              <button className="danger" disabled={busy || !note.trim()} onClick={() => resolve('cancel')}>Annuler avec frais</button></>}
            {!i.blocking && <button className="primary" disabled={busy || !note.trim()} onClick={() => resolve('close')}>Clore</button>}
          </div>
        </>
      )}
    </div>
  );
}

export function AdminIncidents() {
  const [status, setStatus] = useState('open');
  const q = useData(() => api(`/api/admin/incidents?status=${status}`), [status], { live: true });
  return (
    <>
      <Intro title="Incidents et réclamations" sub="Traitement manuel pendant le pilote, chaque décision est tracée." />
      <section className="card">
        <div className="filters" style={{ paddingTop: 18 }}>{[['open', 'Ouverts'], ['resolved', 'Traités'], ['all', 'Tous']].map(([k, l]) => <button key={k} className={status === k ? 'active' : ''} onClick={() => setStatus(k)}>{l}</button>)}</div>
        <Async q={q}>{(items: any[]) => items.length ? <>{items.map((i) => <IncidentRow key={i.id} i={i} reload={q.reload} />)}</> : <Empty>Aucun incident.</Empty>}</Async>
      </section>
    </>
  );
}

export function AdminCouriers() {
  const q = useData(() => api('/api/admin/couriers'), [], { live: true });
  const { run, busy } = useAction();
  const set = (id: string, status: string) => run(() => api(`/api/admin/couriers/${id}/status`, { body: { status } }), 'Profil mis à jour.').then(q.reload);
  return (
    <>
      <Intro title="Livreurs" sub="Validation des profils et disponibilité." />
      <Async q={q}>{(items: any[]) => (
        <section className="card tablewrap">
          <table>
            <thead><tr><th>LIVREUR</th><th>STATUT</th><th>DISPONIBILITÉ</th><th>POSITION</th><th className="num">SOLDE</th><th>ACTION</th></tr></thead>
            <tbody>{items.map((c) => (
              <tr key={c.id}>
                <td><b>{c.name}</b><br /><small>{formatPhone(c.phone)} · {c.vehicle}</small></td>
                <td><span className={`tag ${c.status === 'approved' ? '' : c.status === 'pending' ? 'orange' : 'red'}`}>{c.status === 'approved' ? 'Validé' : c.status === 'pending' ? 'À valider' : 'Suspendu'}</span></td>
                <td>{c.active_ref ? `En course #${c.active_ref}` : c.available ? 'Disponible' : 'Hors ligne'}</td>
                <td><Freshness p={c.position} /></td>
                <td className="num">{money(c.balance)}</td>
                <td>{c.status !== 'approved' && <button className="textbtn" disabled={busy} onClick={() => set(c.id, 'approved')}>Valider ↗</button>} {c.status !== 'suspended' && <button className="textbtn" disabled={busy} onClick={() => set(c.id, 'suspended')}>Suspendre</button>}</td>
              </tr>
            ))}</tbody>
          </table>
          {items.length === 0 && <Empty>Aucun livreur inscrit.</Empty>}
        </section>
      )}</Async>
    </>
  );
}

export function AdminPayouts() {
  const q = useData(() => api('/api/admin/payouts'), [], { live: true });
  const [open, setOpen] = useState<any>(null);
  const [f, setF] = useState<any>({});
  const { run, busy, error } = useAction();
  return (
    <>
      <Intro title="Gains et reversements" sub="Gain de course, commission et reversement sont distincts. Un reversement solde tous les gains en attente du livreur." />
      <Async q={q}>{(d: any) => (
        <div className="grid">
          <section className="card tablewrap">
            <table>
              <thead><tr><th>LIVREUR</th><th>REVERSEMENT SUR</th><th className="num">À REVERSER</th><th /></tr></thead>
              <tbody>{d.couriers.map((c: any) => (
                <tr key={c.id}><td><b>{c.name}</b></td><td>{c.payout_method ? `${METHOD_LABEL[c.payout_method as PaymentMethod]} · ${formatPhone(c.payout_number)}` : <small>Non renseigné</small>}</td><td className="num"><b>{money(c.balance)}</b></td>
                  <td><div className="row"><button className="textbtn" disabled={c.balance <= 0} onClick={() => { setOpen({ ...c, mode: 'payout' }); setF({ method: c.payout_method ?? 'wave', reference: '' }); }}>Reverser ↗</button><button className="textbtn" onClick={() => { setOpen({ ...c, mode: 'adjust' }); setF({ amount: '', note: '' }); }}>Ajuster</button></div></td></tr>
              ))}</tbody>
            </table>
          </section>
          <section className="card">
            <div className="cardhead"><h3>Historique des reversements</h3></div>
            {d.history.length === 0 && <Empty>Aucun reversement.</Empty>}
            {d.history.map((p: any) => <div key={p.id} className="list-item between"><div><b>{p.courier_name}</b><small style={{ display: 'block' }}>{METHOD_LABEL[p.method as PaymentMethod]} · réf. {p.reference} · {when(p.created_at)}</small></div><b>{money(p.amount)}</b></div>)}
          </section>
          {open?.mode === 'payout' && (
            <Modal title={`Reverser ${money(open.balance)} à ${open.name}`} onClose={() => setOpen(null)}>
              <div className="notice warn">Effectuez d’abord le transfert, puis enregistrez sa référence. Le montant doit correspondre au solde affiché.</div>
              <ul>{d.pending.filter((e: any) => e.courier_id === open.id).map((e: any) => <li key={e.id}><small>{e.ref ? `#${e.ref}` : e.kind} · {money(e.amount)}{e.note ? ` · ${e.note}` : ''}</small></li>)}</ul>
              <Field label="Moyen"><select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}><option value="wave">Wave</option><option value="orange_money">Orange Money</option></select></Field>
              <Field label="Référence du transfert effectué"><input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
              {error && <p className="err-text">{error}</p>}
              <button className="primary block" disabled={busy || (f.reference ?? '').trim().length < 3} onClick={async () => { if (await run(() => api(`/api/admin/couriers/${open.id}/payouts`, { body: { method: f.method, reference: f.reference, expectedAmount: open.balance } }), 'Reversement enregistré.')) { setOpen(null); q.reload(); } }}>Enregistrer le reversement</button>
            </Modal>
          )}
          {open?.mode === 'adjust' && (
            <Modal title={`Ajustement · ${open.name}`} onClose={() => setOpen(null)}>
              <Field label="Montant (FCFA, négatif pour une retenue)"><input type="number" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
              <Field label="Motif (audité)"><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
              {error && <p className="err-text">{error}</p>}
              <button className="primary block" disabled={busy || !Number(f.amount) || !f.note.trim()} onClick={async () => { if (await run(() => api(`/api/admin/couriers/${open.id}/adjustments`, { body: { amount: Number(f.amount), note: f.note } }), 'Ajustement enregistré.')) { setOpen(null); q.reload(); } }}>Enregistrer</button>
            </Modal>
          )}
        </div>
      )}</Async>
    </>
  );
}

export function AdminZones() {
  const zones = useData(() => api('/api/zones'), []);
  const pricing = useData(() => api('/api/admin/pricing'), []);
  const { run, busy, error } = useAction();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [params, setParams] = useState<any>(null);
  const [from, setFrom] = useState<string>('');
  useEffect(() => {
    if (!pricing.data) return;
    const a = pricing.data.active;
    setParams(a ? { note: '', courierShareBps: a.courier_share_bps, cancelFee: a.cancel_fee, cancelCourierShareBps: a.cancel_courier_share_bps, notFoundFee: a.not_found_fee, notFoundWaitMinutes: a.not_found_wait_minutes }
      : { note: '', courierShareBps: 8000, cancelFee: 0, cancelCourierShareBps: 10000, notFoundFee: 0, notFoundWaitMinutes: 10 });
    setDraft(Object.fromEntries(pricing.data.pairs.map((p: any) => [`${p.from_zone_id}-${p.to_zone_id}`, String(p.price)])));
  }, [pricing.data]);
  const active = (zones.data ?? []).filter((z: any) => z.active);
  useEffect(() => { if (!from && active[0]) setFrom(String(active[0].id)); }, [active, from]);
  return (
    <>
      <Intro title="Un prix clair, avant le départ." sub="Prix fixe par paire de zones. Toute modification crée une nouvelle version ; les commandes passées gardent leur prix." />
      <div className="grid">
        <div>
          <Async q={pricing}>{(p: any) => params && (
            <section className="card pad">
              <div className="between"><h2>Grille tarifaire</h2>{p.active ? <span className={`tag ${p.active.is_demo ? 'orange' : ''}`}>v{p.active.id}{p.active.is_demo ? ' · DÉMO' : ''}</span> : <span className="tag red">Aucune</span>}</div>
              {p.active?.is_demo && <div className="notice warn">Tarifs de démonstration : à remplacer par des prix validés sur le terrain avant le pilote.</div>}
              <Field label="Retrait depuis"><select value={from} onChange={(e) => setFrom(e.target.value)}>{active.map((z: any) => <option key={z.id} value={z.id}>{z.name}</option>)}</select></Field>
              <div className="tablewrap"><table><thead><tr><th>DESTINATION</th><th className="num">TARIF (FCFA)</th></tr></thead><tbody>
                {active.map((z: any) => { const k = `${from}-${z.id}`; return <tr key={k}><td>{z.name}</td><td className="num"><input aria-label={`Tarif vers ${z.name}`} type="number" min={1} value={draft[k] ?? ''} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} style={{ width: 110, minHeight: 40, padding: 8, border: '1px solid #d3ddcd', borderRadius: 8, textAlign: 'right' }} /></td></tr>; })}
              </tbody></table></div>
              <h3 style={{ marginTop: 20 }}>Partage et frais</h3>
              <div className="two">
                <Field label="Part livreur (%)"><input type="number" min={0} max={100} value={params.courierShareBps / 100} onChange={(e) => setParams({ ...params, courierShareBps: Math.round(Number(e.target.value) * 100) })} /></Field>
                <Field label="Frais d’annulation après attribution"><input type="number" min={0} value={params.cancelFee} onChange={(e) => setParams({ ...params, cancelFee: Number(e.target.value) })} /></Field>
                <Field label="Part livreur sur frais (%)"><input type="number" min={0} max={100} value={params.cancelCourierShareBps / 100} onChange={(e) => setParams({ ...params, cancelCourierShareBps: Math.round(Number(e.target.value) * 100) })} /></Field>
                <Field label="Frais client introuvable"><input type="number" min={0} value={params.notFoundFee} onChange={(e) => setParams({ ...params, notFoundFee: Number(e.target.value) })} /></Field>
                <Field label="Délai client introuvable (min)" hint="10 min dans le MVP : à valider."><input type="number" min={0} max={120} value={params.notFoundWaitMinutes} onChange={(e) => setParams({ ...params, notFoundWaitMinutes: Number(e.target.value) })} /></Field>
              </div>
              <Field label="Note de version (obligatoire)"><input value={params.note} onChange={(e) => setParams({ ...params, note: e.target.value })} placeholder="Ex. prix observés semaine 2" /></Field>
              {error && <p className="err-text">{error}</p>}
              <button className="primary block" disabled={busy || params.note.trim().length < 3} onClick={async () => {
                const pairs = Object.entries(draft).filter(([, v]) => Number(v) > 0).map(([k, v]) => { const [a, b] = k.split('-').map(Number); return { fromZoneId: a, toZoneId: b, price: Number(v) }; });
                if (await run(() => api('/api/admin/pricing', { body: { ...params, pairs } }), 'Nouvelle grille publiée.')) pricing.reload();
              }}>Publier une nouvelle version<Icon name="check" /></button>
              <h3 style={{ marginTop: 22 }}>Versions</h3>
              {p.versions.map((v: any) => <div key={v.id} className="list-item between"><span>v{v.id} · {v.note}<small style={{ display: 'block' }}>{when(v.created_at)} · {v.orders} commande(s)</small></span>{v.active && <span className="tag">Active</span>}</div>)}
            </section>
          )}</Async>
        </div>
        <Async q={zones}>{(zs: any[]) => (
          <section className="card">
            <div className="cardhead"><h2>Zones du pilote</h2><small>Région de Dakar uniquement. Activez les communes retenues.</small></div>
            {zs.map((z) => (
              <label key={z.id} className="list-item check" style={{ justifyContent: 'space-between' }}>
                <span>{z.name}<small style={{ display: 'block' }}>{z.department}</small></span>
                <input type="checkbox" checked={z.active} disabled={busy} onChange={async (e) => { await run(() => api(`/api/admin/zones/${z.id}`, { method: 'PATCH', body: { active: e.target.checked } })); zones.reload(); }} />
              </label>
            ))}
          </section>
        )}</Async>
      </div>
    </>
  );
}

export function AdminRecap() {
  const [date, setDate] = useState(dakarDay());
  const q = useData(() => api(`/api/admin/recap?date=${date}`), [date], { live: true });
  const { run, busy } = useAction();
  return (
    <>
      <Intro title="Récapitulatif du jour" sub="Heure de Dakar. Paiements reçus = vérifiés uniquement." action={<a className="secondary" href={`/api/admin/recap.csv?date=${date}`} download>Export CSV<Icon name="download" /></a>} />
      <section className="card pad" style={{ marginBottom: 20 }}>
        <div className="two"><Field label="Date"><input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></Field>
          <div style={{ alignSelf: 'end', marginBottom: 16 }}><button className="secondary block" disabled={busy} onClick={() => run(() => api(`/api/admin/recap/prepare?date=${date}`, { method: 'POST' }), 'Récaps WhatsApp préparés : voir Messages.')}>Préparer les récaps WhatsApp</button></div></div>
      </section>
      <Async q={q}>{(d: any) => (
        <>
          <div className="stats four">
            <Stat label="Livrées" value={d.totals.delivered} sub={`${d.totals.created} créées · ${d.totals.cancelled} annulées`} icon="box" />
            <Stat label="Frais de course" value={money(d.totals.delivery_fees)} sub={`Commission ${money(d.totals.commission)}`} icon="wallet" />
            <Stat label="Paiements reçus" value={money(d.received)} sub="Vérifiés" icon="check" />
            <Stat label="Non confirmés" value={d.unconfirmed} sub="À suivre en fin de journée" icon="alert" />
          </div>
          <div className="grid">
            <section className="card tablewrap"><div className="cardhead"><h3>Par boutique</h3></div>
              <table><thead><tr><th>BOUTIQUE</th><th className="num">LIVRÉES</th><th className="num">FRAIS</th></tr></thead><tbody>{d.byShop.map((s: any) => <tr key={s.id}><td>{s.name}</td><td className="num">{s.delivered}</td><td className="num">{money(s.delivery_fees)}</td></tr>)}</tbody></table>
              {d.byShop.length === 0 && <Empty>Aucune activité.</Empty>}
            </section>
            <section className="card tablewrap"><div className="cardhead"><h3>Par livreur</h3></div>
              <table><thead><tr><th>LIVREUR</th><th className="num">LIVRÉES</th><th className="num">GAINS</th><th className="num">REVERSÉ</th><th className="num">SOLDE</th></tr></thead><tbody>{d.byCourier.map((c: any) => <tr key={c.id}><td>{c.name}</td><td className="num">{c.delivered}</td><td className="num">{money(c.earned)}</td><td className="num">{money(c.paid_out)}</td><td className="num">{money(c.balance)}</td></tr>)}</tbody></table>
              {d.byCourier.length === 0 && <Empty>Aucune activité.</Empty>}
            </section>
          </div>
          <section className="card tablewrap"><div className="cardhead"><h3>Paiements</h3></div>
            <table><thead><tr><th>TYPE</th><th>STATUT</th><th>MOYEN</th><th className="num">NB</th><th className="num">MONTANT</th></tr></thead>
              <tbody>{d.payments.map((p: any, i: number) => <tr key={i}><td>{OBLIGATION_KIND_LABEL[p.kind as keyof typeof OBLIGATION_KIND_LABEL]}</td><td><PayTag status={p.status} /></td><td>{p.method ? METHOD_LABEL[p.method as PaymentMethod] : '—'}</td><td className="num">{p.n}</td><td className="num">{fcfa(p.amount)}</td></tr>)}</tbody></table>
          </section>
        </>
      )}</Async>
    </>
  );
}

export function AdminMessages() {
  const [status, setStatus] = useState('pending');
  const q = useData(() => api(`/api/admin/messages?status=${status}`), [status], { live: true });
  return (
    <>
      <Intro title="Messages WhatsApp" sub="Mode manuel : ouvrez le message prérempli, envoyez-le, puis confirmez. Ouvrir ne vaut pas envoi." />
      <section className="card">
        <div className="filters" style={{ paddingTop: 18 }}>{[['pending', 'À envoyer'], ['confirmed_sent', 'Envoyés'], ['all', 'Tous']].map(([k, l]) => <button key={k} className={status === k ? 'active' : ''} onClick={() => setStatus(k)}>{l}</button>)}</div>
        <Async q={q}>{(items: any[]) => <Messages items={items} reload={q.reload} />}</Async>
      </section>
    </>
  );
}

export function AdminSettings() {
  const q = useData(() => api('/api/admin/settings'), []);
  const audit = useData(() => api('/api/admin/audit'), []);
  const [f, setF] = useState<any>(null);
  const { run, busy, error } = useAction();
  useEffect(() => { if (q.data) setF({ wave: q.data.service_payment_numbers?.wave ?? '', om: q.data.service_payment_numbers?.orange_money ?? '', requireFee: !!q.data.require_fee_before_offer }); }, [q.data]);
  return (
    <>
      <Intro title="Paramètres" sub="Comptes du service et politiques du pilote." />
      <div className="grid">
        <section className="card pad">
          {f && (
            <form onSubmit={async (e) => { e.preventDefault(); if (await run(() => api('/api/admin/settings', { method: 'PUT', body: { service_payment_numbers: { wave: f.wave || null, orange_money: f.om || null }, require_fee_before_offer: f.requireFee } }), 'Paramètres enregistrés.')) q.reload(); }}>
              <h3>Comptes de réception du service (frais de course)</h3>
              <div className="two">
                <Field label="Numéro Wave du service"><input type="tel" value={f.wave} onChange={(e) => setF({ ...f, wave: e.target.value })} /></Field>
                <Field label="Numéro Orange Money du service"><input type="tel" value={f.om} onChange={(e) => setF({ ...f, om: e.target.value })} /></Field>
              </div>
              <label className="check"><input type="checkbox" checked={f.requireFee} onChange={(e) => setF({ ...f, requireFee: e.target.checked })} />Exiger le paiement vérifié de la course avant l’attribution</label>
              <p className="muted" style={{ fontSize: 12 }}>Politique de paiement avant attribution : question ouverte du pilote. Désactivée par défaut.</p>
              {error && <p className="err-text">{error}</p>}
              <button className="primary block" disabled={busy}>Enregistrer</button>
            </form>
          )}
        </section>
        <section className="card">
          <div className="cardhead"><h3>Journal d’audit</h3></div>
          <Async q={audit}>{(rows: any[]) => <>{rows.slice(0, 60).map((a) => <div key={a.id} className="list-item"><b style={{ fontSize: 12 }}>{a.action}</b><small style={{ display: 'block' }}>{a.actor_name ?? a.actor} · {when(a.created_at)} · {a.entity}</small></div>)}</>}</Async>
        </section>
      </div>
    </>
  );
}
