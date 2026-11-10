import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useData } from '../lib/live';
import { ago, formatPhone, mapsLink, money, when } from '../lib/format';
import { Icon } from '../components/Icon';
import { Async, Empty, Field, Intro, Kv, Modal, Stat, StatusTag, useAction, useToast } from '../components/ui';
import { MapView } from '../components/MapView';
import { PhotoButton } from '../components/Media';
import { useSession } from '../components/Layout';
import { METHOD_LABEL, type PaymentMethod } from '../../../shared/contract';

/** Partage de position seulement quand l'app est ouverte ET le livreur disponible ou en course (pas de suivi en arrière-plan). */
function usePositionSharing(enabled: boolean) {
  const [state, setState] = useState<{ status: 'off' | 'on' | 'denied' | 'error'; sentAt?: number }>({ status: 'off' });
  const last = useRef<{ t: number; lat: number; lng: number } | null>(null);
  useEffect(() => {
    if (!enabled || !('geolocation' in navigator)) { setState({ status: 'off' }); return; }
    const id = navigator.geolocation.watchPosition(async (p) => {
      const now = Date.now();
      const l = last.current;
      const moved = !l || Math.abs(l.lat - p.coords.latitude) + Math.abs(l.lng - p.coords.longitude) > 0.0004;
      if (l && now - l.t < 30000 && !moved) return;
      if (l && now - l.t < 10000) return;
      last.current = { t: now, lat: p.coords.latitude, lng: p.coords.longitude };
      try {
        await api('/api/courier/position', { body: { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy } });
        setState({ status: 'on', sentAt: now });
      } catch { setState((s) => ({ ...s, status: 'error' })); }
    }, (e) => setState({ status: e.code === e.PERMISSION_DENIED ? 'denied' : 'error' }), { enableHighAccuracy: true, maximumAge: 15000, timeout: 30000 });
    return () => navigator.geolocation.clearWatch(id);
  }, [enabled]);
  return state;
}

function PositionStatus({ s }: { s: ReturnType<typeof usePositionSharing> }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 15000); return () => clearInterval(t); }, []);
  if (s.status === 'denied') return <div className="notice warn">Localisation refusée : l’équipe ne voit pas votre position. Autorisez-la dans le navigateur pour recevoir des courses proches.</div>;
  if (s.status === 'error') return <div className="notice warn">Position non envoyée (GPS ou réseau). Nouvel essai automatique.</div>;
  if (s.status === 'on' && s.sentAt) return <small><span className="dot" />Position partagée {ago((Date.now() - s.sentAt) / 1000)} · uniquement quand l’application est ouverte</small>;
  return null;
}

/** Délai réel restant, calé sur l'horloge du serveur. */
function Countdown({ expiresAt, serverNow, onEnd }: { expiresAt: string; serverNow: string; onEnd: () => void }) {
  const offset = useRef(new Date(serverNow).getTime() - Date.now());
  const calc = () => Math.max(0, Math.ceil((new Date(expiresAt).getTime() - (Date.now() + offset.current)) / 1000));
  const [left, setLeft] = useState(calc);
  useEffect(() => {
    const t = setInterval(() => {
      const l = calc();
      setLeft(l);
      if (l <= 0) { clearInterval(t); onEnd(); }
    }, 250);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expiresAt]);
  return <span className={`tag ${left <= 10 ? 'red' : 'orange'}`} role="timer" aria-live="off">{left > 0 ? `${left} s pour répondre` : 'Offre expirée'}</span>;
}

export function CourierHome() {
  const { me } = useSession();
  const navigate = useNavigate();
  const q = useData(() => api('/api/courier/home'), [], { live: true, every: 10000 });
  const { run, busy } = useAction();
  const toast = useToast();
  const sharing = usePositionSharing(!!q.data && q.data.profile.status === 'approved' && (q.data.profile.available || !!q.data.active));
  const first = me?.user.name.split(' ')[0];
  return (
    <>
      <Intro title={`Bonne route, ${first}.`} sub="Des courses claires. Des clients faciles à trouver." />
      <Async q={q}>{(d: any) => {
        if (d.profile.status !== 'approved') {
          return (
            <section className="card state">
              <h2>{d.profile.status === 'suspended' ? 'Profil suspendu' : 'Profil en cours de validation'}</h2>
              <p>{d.profile.status === 'suspended' ? 'Contactez l’équipe Yoon pour en savoir plus.' : 'L’équipe Yoon vérifie votre profil. Vous pourrez activer votre disponibilité une fois validé.'}</p>
            </section>
          );
        }
        const respond = async (accept: boolean) => {
          try {
            const r = await api(`/api/courier/offers/${d.offer.id}/respond`, { body: { accept } });
            if (r.status === 'accepted') navigate(`/l/course/${r.orderId}`);
            else { toast('Offre refusée. Elle sera proposée à un autre livreur.'); q.reload(); }
          } catch (e) {
            toast(e instanceof ApiError ? e.message : 'Erreur', true);
            q.reload();
          }
        };
        return (
          <div className="grid">
            <div>
              <section className="balance">
                <div className="between">
                  <div><small>Votre disponibilité</small><h2 style={{ marginTop: 8 }}>{d.profile.available ? 'Vous êtes en ligne' : 'Vous êtes hors ligne'}</h2></div>
                  <button className={`switch ${d.profile.available ? 'on' : ''}`} role="switch" aria-checked={d.profile.available} aria-label="Ma disponibilité" disabled={busy}
                    onClick={() => run(() => api('/api/courier/availability', { body: { available: !d.profile.available } })).then(q.reload)}><span /></button>
                </div>
                <p style={{ fontSize: 13 }}>{d.profile.available ? 'Prêt à recevoir votre prochaine course.' : 'Activez votre disponibilité pour recevoir des courses.'}</p>
                <PositionStatus s={sharing} />
              </section>
              <section className="card offer">
                {d.active ? (
                  <>
                    <span className="tag">Votre course #{d.active.ref}</span>
                    <h2 style={{ margin: '18px 0 8px' }}>Course en cours</h2>
                    <StatusTag status={d.active.status} />
                    <Link className="primary block" to={`/l/course/${d.active.id}`}>Ouvrir la course<Icon name="arrow" /></Link>
                  </>
                ) : d.offer ? (
                  <>
                    <div className="between"><span className="tag">Nouvelle proposition</span><Countdown expiresAt={d.offer.expires_at} serverNow={d.offer.server_now} onEnd={q.reload} /></div>
                    <div className="bigmoney">{new Intl.NumberFormat('fr-FR').format(d.offer.courier_earning)} <span style={{ fontSize: 17 }}>F CFA</span></div>
                    <p className="muted">Votre gain pour cette course</p>
                    <div className="bill">
                      <p style={{ margin: '0 0 10px' }}><b>Retrait</b><br />{d.offer.shop_name} · {d.offer.pickup_address} ({d.offer.pickup_zone})</p>
                      <p style={{ margin: 0 }}><b>Livraison</b><br />Zone {d.offer.dest_zone}</p>
                      <small>Position du client reçue · aucun argent à encaisser</small>
                    </div>
                    <div className="two">
                      <button className="secondary" onClick={() => respond(false)}>Refuser<Icon name="back" /></button>
                      <button className="primary" onClick={() => respond(true)}>Accepter<Icon name="check" /></button>
                    </div>
                  </>
                ) : d.profile.available ? (
                  <><h2>En attente d’une course.</h2><p className="muted">L’équipe vous proposera une course proche. Gardez l’application ouverte : vous aurez 30 secondes pour répondre.</p></>
                ) : (
                  <><h2>Une pause bien méritée.</h2><p className="muted">Aucune offre tant que vous êtes indisponible.</p></>
                )}
              </section>
            </div>
            <div>
              <div className="stats" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 0 }}>
                <Stat label="Gains du jour" value={money(d.today.earned)} sub={`Solde à reverser : ${money(d.today.balance)}`} icon="wallet" to="/l/gains" />
                <Stat label="Courses livrées" value={d.today.delivered} sub="Aujourd’hui" icon="check" />
              </div>
              <section className="quick"><div className="flex"><Icon name="bike" /><h3>Sur réseau faible</h3></div><p>Une action n’est validée que lorsque l’écran le confirme. En cas de coupure, réessayez : rien n’est compté deux fois.</p></section>
            </div>
          </div>
        );
      }}</Async>
    </>
  );
}

const STEPS: Record<string, { label: string; next?: 'arrived_pickup' | 'picked_up' | 'departed'; cta?: string; hint: string }> = {
  assigned: { label: 'Cap sur le retrait.', next: 'arrived_pickup', cta: 'Je suis au retrait', hint: 'Rendez-vous au lieu de retrait.' },
  at_pickup: { label: 'Récupérez le colis.', next: 'picked_up', cta: 'J’ai récupéré le colis', hint: 'Vérifiez le colis avec le commerçant avant de partir.' },
  picked_up: { label: 'Colis récupéré.', next: 'departed', cta: 'Je pars livrer', hint: 'Prévenez quand vous partez : le client est informé.' },
  in_delivery: { label: 'En route vers le client.', hint: 'Demandez le code au client après lui avoir remis sa commande.' },
  incident: { label: 'Incident en cours.', hint: 'L’équipe examine la situation. Restez joignable.' },
  delivered: { label: 'Bien livré. Bien joué.', hint: 'Votre gain est ajouté à votre solde.' },
  cancelled: { label: 'Course annulée.', hint: 'Cette course est terminée.' },
};

export function CourierMission() {
  const { id = '' } = useParams();
  const q = useData(() => api(`/api/courier/orders/${id}`), [id], { live: true });
  const sharing = usePositionSharing(!!q.data && !['delivered', 'cancelled'].includes(q.data.order.status));
  const { run, busy, error, setError } = useAction();
  const [code, setCode] = useState(() => sessionStorage.getItem(`code-${id}`) ?? '');
  const [modal, setModal] = useState<null | 'photo'>(null);
  const [proof, setProof] = useState<{ id: string; url: string } | null>(null);
  const [reason, setReason] = useState('Client injoignable');
  const [recipient, setRecipient] = useState('');
  useEffect(() => { sessionStorage.setItem(`code-${id}`, code); }, [code, id]);
  return (
    <Async q={q} lines={6}>{(d: any) => {
      const o = d.order;
      const s = STEPS[o.status] ?? STEPS.assigned;
      const toPickup = ['assigned', 'at_pickup'].includes(o.status);
      const delivering = ['picked_up', 'in_delivery'].includes(o.status);
      const loc = d.location;
      return (
        <>
          <Intro eyebrow={`Course #${o.ref} · gain ${money(o.courier_earning)}`} title={s.label} sub={s.hint} action={<StatusTag status={o.status} />} />
          <div className="grid">
            <section className="card">
              <MapView markers={loc?.lat != null ? [{ lat: loc.lat, lng: loc.lng, kind: 'customer', label: 'Client' }] : []} badge={toPickup ? `Retrait : ${o.pickup_zone}` : `Client : ${o.dest_zone}`} />
              <div className="tracking">
                <PositionStatus s={sharing} />
                <h2 style={{ marginTop: 10 }}>{toPickup ? `${o.shop_name} · ${o.pickup_zone}` : `${o.customer_name} · ${o.dest_zone}`}</h2>
                {toPickup ? <p className="notice">{o.pickup_address}</p> : (
                  <>
                    {loc?.landmark && <p className="notice">{loc.landmark}</p>}
                    {o.dest_hint && <p className="muted">Indication du commerçant : {o.dest_hint}</p>}
                    {loc?.photoUrl && <img className="thumb" src={loc.photoUrl} alt="Photo du lieu envoyée par le client" />}
                    {loc?.voiceUrl && <audio controls src={loc.voiceUrl} />}
                  </>
                )}
                <div className="two" style={{ marginTop: 12 }}>
                  {!toPickup && loc?.lat != null ? <a className="secondary" href={mapsLink(loc.lat, loc.lng)} target="_blank" rel="noopener">Itinéraire<Icon name="location" /></a>
                    : <span className="secondary" aria-disabled="true" style={{ opacity: .6 }}>{toPickup ? 'Itinéraire : voir l’adresse' : 'Pas de position'}</span>}
                  {(toPickup ? o.shop_phone : o.customer_phone) && <a className="secondary" href={`tel:${toPickup ? o.shop_phone : o.customer_phone}`}
                    onClick={() => delivering && api(`/api/courier/orders/${id}/contact`, { body: { channel: 'call' } }).then(q.reload).catch(() => {})}>Appeler<Icon name="phone" /></a>}
                </div>
                {delivering && o.customer_phone && <a className="textbtn" href={`https://wa.me/${o.customer_phone.replace(/\D/g, '')}`} target="_blank" rel="noopener"
                  onClick={() => api(`/api/courier/orders/${id}/contact`, { body: { channel: 'whatsapp' } }).then(q.reload).catch(() => {})}>Écrire sur WhatsApp ({formatPhone(o.customer_phone)}) ↗</a>}
              </div>
            </section>
            <section className="card offer">
              {s.next && <button className="primary block" disabled={busy} onClick={() => run(() => api(`/api/courier/orders/${id}/step`, { body: { step: s.next } }), 'Étape confirmée.').then(q.reload)}>{busy ? 'Envoi…' : s.cta}<Icon name="check" /></button>}
              {delivering && (
                <>
                  <h2 style={{ marginTop: s.next ? 24 : 0 }}>Confirmer la remise</h2>
                  <p className="muted">Demandez le code au client <b>après</b> lui avoir remis sa commande.</p>
                  {d.code?.used ? <p className="notice">Code déjà utilisé.</p> : (
                    <form onSubmit={async (e) => {
                      e.preventDefault();
                      setError(null);
                      const ok = await run(() => api(`/api/courier/orders/${id}/code`, { body: { code } }), 'Livraison confirmée par le serveur.');
                      if (ok) { setCode(''); sessionStorage.removeItem(`code-${id}`); }
                      q.reload();
                    }}>
                      <Field label="Code du client"><input required inputMode="numeric" pattern="[0-9]{4}" maxLength={4} autoComplete="one-time-code" placeholder="4 chiffres" value={code}
                        onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} style={{ fontSize: 27, letterSpacing: 12 }} aria-invalid={!!error} /></Field>
                      <small>{d.code ? `${d.code.attemptsLeft} essai${d.code.attemptsLeft > 1 ? 's' : ''} restant${d.code.attemptsLeft > 1 ? 's' : ''}` : ''}</small>
                      {error && <p className="err-text" role="alert">{error}</p>}
                      <button className="primary block" disabled={busy || code.length !== 4 || d.code?.attemptsLeft === 0}>{busy ? 'Vérification…' : 'Confirmer la livraison'}<Icon name="check" /></button>
                    </form>
                  )}
                  <div className="notice">
                    <b>Client injoignable ?</b> Tentatives de contact : {d.contact.attempts}/2.{' '}
                    {d.contact.canDeclareNotFound ? 'Vous pouvez signaler le client introuvable.' : d.contact.attempts >= 2 ? `Attendez ${d.contact.waitMinutes} min après la première tentative (délai à valider pendant le pilote).` : 'Appelez ou écrivez au client depuis cette fiche : chaque tentative est tracée.'}
                  </div>
                  <div className="two">
                    <button className="secondary" disabled={!d.contact.canDeclareNotFound || busy} onClick={() => run(() => api(`/api/courier/orders/${id}/not-found`, { method: 'POST' }), 'Signalé à l’équipe.').then(q.reload)}>Client introuvable</button>
                    <button className="secondary" onClick={() => setModal('photo')}>Preuve photo<Icon name="camera" /></button>
                  </div>
                </>
              )}
              {o.status === 'incident' && <div className="notice warn">L’équipe examine la situation (preuve photo ou client introuvable). Vous serez informé ici.</div>}
              {o.status === 'delivered' && <><h2>{money(o.courier_earning)} ajoutés à vos gains</h2><Link className="primary block" to="/l/gains">Voir mes gains<Icon name="arrow" /></Link></>}
              {o.status === 'cancelled' && <Link className="secondary block" to="/l">Retour à l’accueil</Link>}
              {d.proofs.length > 0 && <div style={{ marginTop: 16 }}>{d.proofs.map((p: any, i: number) => <small key={i} style={{ display: 'block' }}>Preuve {p.kind === 'code' ? 'code' : 'photo'} · {p.status === 'accepted' ? 'validée' : p.status === 'pending_review' ? 'en vérification' : 'refusée'}</small>)}</div>}
            </section>
          </div>
          {modal === 'photo' && (
            <Modal title="Preuve photo de remise" onClose={() => setModal(null)}>
              <div className="notice warn">Procédure de secours : elle est contrôlée par l’équipe avant validation. Ne remettez pas le colis à un tiers sans accord du client.</div>
              <Field label="Motif"><select value={reason} onChange={(e) => setReason(e.target.value)}><option>Client injoignable</option><option>Code bloqué ou expiré</option><option>Remis à un tiers autorisé par le client</option></select></Field>
              {reason.startsWith('Remis') && <Field label="Nom de la personne qui a reçu le colis"><input value={recipient} onChange={(e) => setRecipient(e.target.value)} /></Field>}
              {proof && <img className="thumb" src={proof.url} alt="Preuve" />}
              <div className="two" style={{ marginTop: 10 }}>
                <PhotoButton orderId={id} kind="proof" onUploaded={(pid, url) => setProof({ id: pid, url })} label={proof ? 'Reprendre' : 'Prendre la photo'} />
                <button className="primary" disabled={!proof || busy || (reason.startsWith('Remis') && !recipient.trim())} onClick={async () => {
                  if (await run(() => api(`/api/courier/orders/${id}/photo-proof`, { body: { mediaId: proof!.id, reason, recipientName: recipient || undefined } }), 'Preuve envoyée : en attente de validation.')) { setModal(null); q.reload(); }
                }}>Envoyer</button>
              </div>
            </Modal>
          )}
        </>
      );
    }}</Async>
  );
}

const KIND: Record<string, string> = { delivery: 'Course', cancellation: 'Compensation annulation', adjustment: 'Ajustement' };
export function CourierWallet() {
  const q = useData(() => api('/api/courier/wallet'), [], { live: true });
  const h = useData(() => api('/api/courier/history'), []);
  return (
    <>
      <Intro title="Vos gains, en toute clarté." sub="Gain de course, reversement : chaque mouvement est suivi." />
      <Async q={q}>{(d: any) => (
        <div className="grid">
          <div>
            <section className="balance"><small>Solde à vous reverser</small><div className="bigmoney">{new Intl.NumberFormat('fr-FR').format(d.balance)} <span style={{ fontSize: 18 }}>F CFA</span></div><span className="tag dark">Reversement effectué par l’équipe</span></section>
            <section className="card">
              <div className="cardhead"><h2>Mouvements</h2></div>
              {d.earnings.length === 0 && <Empty>Pas encore de gain.</Empty>}
              {d.earnings.map((e: any) => (
                <div key={e.id} className="list-item between">
                  <div><b>{KIND[e.kind]}{e.ref ? ` · #${e.ref}` : ''}</b><small style={{ display: 'block' }}>{when(e.created_at)}{e.note ? ` · ${e.note}` : ''}</small></div>
                  <div style={{ textAlign: 'right' }}><b>{money(e.amount)}</b><br /><span className={`tag ${e.status === 'paid' ? '' : 'orange'}`}>{e.status === 'paid' ? 'Reversé' : 'À reverser'}</span></div>
                </div>
              ))}
            </section>
          </div>
          <div>
            <section className="card">
              <div className="cardhead"><h2>Reversements reçus</h2></div>
              {d.payouts.length === 0 && <Empty>Aucun reversement pour l’instant.</Empty>}
              {d.payouts.map((p: any) => <div key={p.id} className="list-item between"><div><b>{money(p.amount)}</b><small style={{ display: 'block' }}>{METHOD_LABEL[p.method as PaymentMethod]} · réf. {p.reference}</small></div><small>{when(p.created_at)}</small></div>)}
            </section>
            <section className="card">
              <div className="cardhead"><h2>Historique des courses</h2></div>
              {h.data?.length === 0 && <Empty>Aucune course.</Empty>}
              {h.data?.slice(0, 20).map((o: any) => <Link key={o.id} className="delivery" to={`/l/course/${o.id}`}><div className="between"><div><b>#{o.ref}</b><small>{o.pickup_zone} → {o.dest_zone} · {when(o.updated_at)}</small></div><StatusTag status={o.status} /></div></Link>)}
            </section>
          </div>
        </div>
      )}</Async>
    </>
  );
}

export function CourierProfile() {
  const { me, reload } = useSession();
  const c = me!.courier;
  const [zones, setZones] = useState<any[]>([]);
  const [f, setF] = useState({ payoutMethod: c.payout_method ?? '', payoutNumber: c.payout_number ?? '', homeZoneId: String(c.home_zone_id ?? '') });
  const { run, busy, error } = useAction();
  useEffect(() => { api('/api/zones').then(setZones).catch(() => {}); }, []);
  return (
    <>
      <Intro title="Votre profil" sub={`${me!.user.name} · ${formatPhone(me!.user.phone)}`} />
      <section className="card formcard">
        <Kv rows={[['Statut', c.status === 'approved' ? 'Validé' : c.status === 'pending' ? 'En attente de validation' : 'Suspendu'], ['Véhicule', c.vehicle]]} />
        <form onSubmit={async (e) => { e.preventDefault(); if (await run(() => api('/api/courier/profile', { method: 'PATCH', body: { payoutMethod: f.payoutMethod || null, payoutNumber: f.payoutNumber || null, homeZoneId: f.homeZoneId ? Number(f.homeZoneId) : null } }), 'Profil enregistré.')) reload(); }}>
          <Field label="Reversement sur"><select value={f.payoutMethod} onChange={(e) => setF({ ...f, payoutMethod: e.target.value })}><option value="">—</option><option value="wave">Wave</option><option value="orange_money">Orange Money</option></select></Field>
          <Field label="Numéro de reversement"><input type="tel" value={f.payoutNumber} onChange={(e) => setF({ ...f, payoutNumber: e.target.value })} /></Field>
          <Field label="Zone habituelle"><select value={f.homeZoneId} onChange={(e) => setF({ ...f, homeZoneId: e.target.value })}><option value="">—</option>{zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}</select></Field>
          {error && <p className="err-text" role="alert">{error}</p>}
          <button className="primary block" disabled={busy}>Enregistrer<Icon name="check" /></button>
        </form>
        <p className="notice">Votre position n’est envoyée que lorsque l’application est ouverte et que vous êtes disponible ou en course. Un navigateur ne permet pas un suivi fiable écran éteint.</p>
      </section>
    </>
  );
}
