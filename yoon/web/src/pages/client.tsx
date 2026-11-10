import { createContext, useContext, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api, clientToken } from '../lib/api';
import { useData } from '../lib/live';
import { ago, fcfa, formatPhone, money, time } from '../lib/format';
import { Icon } from '../components/Icon';
import { Async, Field, Intro, Modal, PayTag, StatusTag, useAction } from '../components/ui';
import { CourierLine, Progress, Timeline } from '../components/orders';
import { MapView, type Marker } from '../components/MapView';
import { PhotoButton, VoiceButton } from '../components/Media';
import { Banners } from '../components/Layout';
import { PaymentDeclare } from './merchant';
import { OBLIGATION_KIND_LABEL } from '../../../shared/contract';

type Q = ReturnType<typeof useData<any>>;
const Ctx = createContext<Q | null>(null);
const useOrder = () => useContext(Ctx)!;

const NAV = [
  { to: '/c', icon: 'pin', label: 'Ma livraison', end: true },
  { to: '/c/position', icon: 'location', label: 'Ma position' },
  { to: '/c/paiement', icon: 'wallet', label: 'Paiement' },
  { to: '/c/aide', icon: 'chat', label: 'Aide' },
];

/** Accès client : jeton opaque reçu dans le lien WhatsApp (#…), conservé sur ce téléphone, sans compte. */
export function ClientShell() {
  const loc = useLocation();
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const h = window.location.hash.slice(1);
    if (h.length > 20) {
      clientToken.set(h);
      navigate('/c', { replace: true }); // retire le jeton de la barre d'adresse
    }
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const q = useData(() => (clientToken.get() ? api('/api/client/order', { client: true }) : Promise.reject(Object.assign(new Error(), { status: 404, code: 'no_link', message: 'Ouvrez le lien reçu sur WhatsApp pour suivre votre livraison.' }))), [ready], { live: true, client: true, every: 15000 });
  if (!ready) return null;
  const current = NAV.find((n) => (n.end ? loc.pathname === n.to : loc.pathname.startsWith(n.to)));
  return (
    <Ctx.Provider value={q}>
      <aside className="sidebar">
        <div className="brand"><span className="mark">↗</span>yoon<span style={{ color: '#97b96a' }}>.</span></div>
        <div className="subtitle">La livraison, simplement.</div>
        <div className="navlabel">Votre livraison</div>
        <nav>{NAV.map((n) => <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `navbtn ${isActive ? 'active' : ''}`}><Icon name={n.icon} />{n.label}</NavLink>)}</nav>
        <div className="sidebarfooter"><div className="helpbox"><b>Pas de compte nécessaire.</b><p>Ce lien est personnel et ne donne accès qu’à cette livraison.</p></div></div>
      </aside>
      <header className="topbar">
        <div className="topcrumb"><small>Votre livraison</small><span style={{ color: '#c6cfc1', margin: '0 12px' }}>/</span><b style={{ fontSize: 13 }}>{current?.label}</b></div>
        <div className="brand mobilebrand"><span className="mark">↗</span>yoon.</div>
        {q.data && <span className="tag">#{q.data.order.ref}</span>}
      </header>
      <Banners />
      <main className="stage"><div className="screen" key={loc.pathname}>
        {q.error && !q.data ? (
          <div className="card state" role="alert">
            <h2>{q.error.code === 'link_expired' ? 'Lien expiré' : q.error.code === 'link_revoked' ? 'Lien remplacé' : q.error.code === 'offline' ? 'Hors connexion' : 'Lien invalide'}</h2>
            <p>{q.error.message}</p>
            {q.error.code === 'offline' && <button className="primary" onClick={q.reload}>Réessayer</button>}
          </div>
        ) : <Outlet />}
      </div><div className="bottomnote">Pensé pour Dakar. Fait pour vous. ↗</div></main>
      <nav className="bottomnav">{NAV.map((n) => <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'active' : '')}><Icon name={n.icon} />{n.label}</NavLink>)}</nav>
    </Ctx.Provider>
  );
}

function markers(d: any): Marker[] {
  const m: Marker[] = [];
  if (d.location?.lat != null) m.push({ lat: d.location.lat, lng: d.location.lng, kind: 'customer', label: 'Vous' });
  const p = d.courier?.position;
  if (p) m.push({ lat: p.lat, lng: p.lng, kind: 'courier', label: `Livreur · ${ago(p.ageSec)}`, stale: p.stale });
  return m;
}

export function ClientHome() {
  const q = useOrder();
  return (
    <Async q={q}>{(d: any) => {
      const o = d.order;
      const first = o.customer_name.split(' ')[0];
      const toPay = d.payments.filter((p: any) => ['due', 'rejected'].includes(p.status));
      const title = o.status === 'delivered' ? `Bien reçu, ${first} !` : o.status === 'cancelled' ? 'Livraison annulée.' : o.status === 'awaiting_location' ? `Où vous retrouver, ${first} ?` : `Votre commande arrive, ${first}.`;
      return (
        <>
          <Intro title={title} sub={`${o.shop_name} vous envoie une commande · ${o.pickup_zone} → ${o.dest_zone}`} />
          {o.status === 'awaiting_location' && (
            <div className="card pad" style={{ marginBottom: 20 }}>
              <h3>Première étape : votre position</h3>
              <p className="muted">Le livreur ne sera choisi qu’après réception de votre position. Elle n’est partagée qu’avec l’équipe et le livreur de cette course.</p>
              <Link className="primary block" to="/c/position">Partager ma position<Icon name="location" /></Link>
            </div>
          )}
          <div className="grid">
            <section className="card">
              <MapView markers={markers(d)} badge={<><span className="dot" />{o.status === 'awaiting_location' ? 'Position attendue' : 'Suivi de livraison'}</>} />
              <div className="tracking">
                <div className="between"><div><small>Statut</small><div className="eta" style={{ fontSize: 22 }}>{o.status === 'in_delivery' ? 'En route vers vous' : <StatusTag status={o.status} />}</div></div></div>
                <Progress status={o.status} />
                {d.courier ? (
                  <>
                    <CourierLine name={d.courier.firstName} sub="Votre livreur · Moto" phone={d.courier.phone} position={d.courier.position} />
                    <small>Pas d’heure d’arrivée calculée : la carte montre la dernière position connue du livreur{d.courier.position ? ` (${time(d.courier.position.at)})` : ''}.</small>
                  </>
                ) : !['delivered', 'cancelled'].includes(o.status) && <p className="muted">Un livreur sera attribué par l’équipe Yoon.</p>}
                {!['delivered', 'cancelled'].includes(o.status) && <Link className="secondary block" to="/c/position">Préciser ma position<Icon name="pin" /></Link>}
              </div>
            </section>
            <div>
              {d.code?.value && (
                <section className="card tracking">
                  <span className="eyebrow">À la remise du colis</span>
                  <h2 style={{ marginTop: 10 }}>Votre code de livraison</h2>
                  <div className="code" aria-label={`Code ${d.code.value.split('').join(' ')}`}>{d.code.value.split('').map((n: string, i: number) => <span key={i}>{n}</span>)}</div>
                  <p className="notice">Donnez ce code au livreur <b>uniquement après avoir reçu votre commande</b>. Ne le communiquez à personne d’autre.</p>
                  {d.code.locked && <p className="notice warn">Trop d’essais incorrects : l’équipe vérifiera la remise avec vous.</p>}
                </section>
              )}
              {d.code?.expired && <div className="notice warn">Votre code a expiré. Contactez le commerçant ou l’équipe.</div>}
              {d.payments.length > 0 && (
                <section className="card tracking">
                  <div className="between"><h3>Votre paiement</h3>{toPay.length ? <span className="tag orange">À régler</span> : <span className="tag">À jour</span>}</div>
                  <div className="bill">{d.payments.map((p: any) => <div key={p.id} className="between"><span>{p.kind === 'order_amount' ? `Commande · ${o.shop_name}` : 'Course · Yoon'}</span><b>{money(p.amount)}</b></div>)}</div>
                  <Link className="primary block" to="/c/paiement">{toPay.length ? 'Payer et envoyer le justificatif' : 'Voir mes paiements'}<Icon name="wallet" /></Link>
                </section>
              )}
              <section className="card"><div className="cardhead"><h3>Les étapes</h3></div><Timeline events={d.timeline} /></section>
            </div>
          </div>
        </>
      );
    }}</Async>
  );
}

type GeoState = 'idle' | 'locating' | 'denied' | 'unavailable' | 'done';

export function ClientLocation() {
  const q = useOrder();
  const navigate = useNavigate();
  const [geo, setGeo] = useState<GeoState>('idle');
  const [pos, setPos] = useState<{ lat: number; lng: number; accuracy?: number; source: 'gps' | 'map' } | null>(null);
  const [landmark, setLandmark] = useState('');
  const [photo, setPhoto] = useState<{ id: string; url: string } | null>(null);
  const [voice, setVoice] = useState<{ id: string; url: string } | null>(null);
  const { run, busy, error } = useAction();
  useEffect(() => { if (q.data?.location?.landmark && !landmark) setLandmark(q.data.location.landmark); /* eslint-disable-next-line */ }, [q.data]);

  function locate() {
    if (!('geolocation' in navigator)) return setGeo('unavailable');
    setGeo('locating');
    navigator.geolocation.getCurrentPosition(
      (p) => { setPos({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, source: 'gps' }); setGeo('done'); },
      (e) => setGeo(e.code === e.PERMISSION_DENIED ? 'denied' : 'unavailable'),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  }
  return (
    <Async q={q}>{(d: any) => (
      <>
        <Intro title="Le bon endroit, du premier coup." sub="Aidez le livreur à vous trouver sans appels répétés." />
        <section className="card formcard">
          <h2>Où vous retrouver ?</h2>
          <p className="muted">Partagez votre position (avec votre accord) ou touchez la carte pour placer votre repère. Ajoutez un repère écrit, une photo ou une note vocale.</p>
          <MapView pick={pos} markers={!pos && d.location?.lat != null ? [{ lat: d.location.lat, lng: d.location.lng, kind: 'customer', label: 'Position enregistrée' }] : []}
            onPick={(p) => { setPos({ ...p, source: 'map' }); setGeo('done'); }}
            note={pos ? (pos.source === 'gps' ? `Position GPS${pos.accuracy ? ` · précision ±${Math.round(pos.accuracy)} m` : ''}. Touchez la carte pour corriger.` : 'Repère placé sur la carte.') : 'Touchez la carte pour placer votre repère.'} />
          <button className="primary block" onClick={locate} disabled={geo === 'locating'}>{geo === 'locating' ? 'Localisation…' : pos?.source === 'gps' ? 'Position trouvée · actualiser' : 'Partager ma position'}<Icon name="location" /></button>
          {geo === 'denied' && <div className="notice warn" role="alert">Localisation refusée. Pas de souci : touchez la carte à l’endroit où vous êtes, et décrivez un repère.</div>}
          {geo === 'unavailable' && <div className="notice warn" role="alert">Position GPS indisponible. Touchez la carte pour placer votre repère.</div>}
          <Field label="Un repère facile à reconnaître"><textarea value={landmark} onChange={(e) => setLandmark(e.target.value)} maxLength={500} placeholder="Ex. Portail vert, en face de la pharmacie" /></Field>
          {photo && <img className="thumb" src={photo.url} alt="Photo du lieu" />}
          {voice && <audio controls src={voice.url} />}
          <div className="two" style={{ marginTop: 12 }}>
            <PhotoButton orderId={d.order.id} client onUploaded={(id, url) => setPhoto({ id, url })} label={photo ? 'Changer la photo' : 'Ajouter une photo'} />
            <VoiceButton orderId={d.order.id} client onUploaded={(id, url) => setVoice({ id, url })} />
          </div>
          {error && <p className="err-text" role="alert">{error}</p>}
          <button className="primary block" disabled={busy || (!pos && !landmark.trim() && !photo && !voice)} onClick={async () => {
            const body = pos ? { source: pos.source, lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy, landmark, photoMediaId: photo?.id, voiceMediaId: voice?.id }
              : { source: 'landmark_only', landmark, photoMediaId: photo?.id, voiceMediaId: voice?.id };
            const r: any = await run(() => api('/api/client/location', { client: true, body }));
            if (r) { await q.reload(); navigate('/c', { state: { saved: r.hasPosition } }); }
          }}>{busy ? 'Envoi…' : 'Confirmer mon repère'}<Icon name="check" /></button>
          {!pos && <p className="muted" style={{ fontSize: 12 }}>Sans position sur la carte, votre repère est enregistré mais le livreur ne peut pas encore être attribué.</p>}
        </section>
      </>
    )}</Async>
  );
}

export function ClientPayment() {
  const q = useOrder();
  const [open, setOpen] = useState<any>(null);
  return (
    <Async q={q}>{(d: any) => (
      <>
        <Intro title="Payez en toute simplicité." sub="Wave ou Orange Money. Aucun cash à remettre au livreur." />
        <section className="card formcard">
          {d.payments.length === 0 && <p>Rien à payer de votre côté : la course est réglée par le commerçant.</p>}
          {d.payments.map((p: any) => (
            <div key={p.id} className="bill">
              <div className="between"><b>{p.kind === 'order_amount' ? `Commande · ${p.payTo.label}` : OBLIGATION_KIND_LABEL[p.kind as keyof typeof OBLIGATION_KIND_LABEL]}</b><PayTag status={p.status} /></div>
              <div className="between"><span>Montant</span><b style={{ fontSize: 18 }}>{fcfa(p.amount)}</b></div>
              <div className="between"><span>À payer à</span><b>{p.payTo.label}</b></div>
              {p.payTo.wave && <div className="between"><span>Wave</span><b>{formatPhone(p.payTo.wave)}</b></div>}
              {p.payTo.orange_money && <div className="between"><span>Orange Money</span><b>{formatPhone(p.payTo.orange_money)}</b></div>}
              {!p.payTo.wave && !p.payTo.orange_money && <div className="notice warn">Numéro de paiement non communiqué : contactez {p.kind === 'order_amount' ? 'le commerçant' : 'l’équipe'} avant de payer.</div>}
              {['due', 'rejected'].includes(p.status) && <button className="primary block" onClick={() => setOpen(p)}>J’ai payé : envoyer le justificatif<Icon name="arrow" /></button>}
              {p.status === 'rejected' && <div className="notice err">Justificatif refusé. Vérifiez le montant et la référence, puis renvoyez-le.</div>}
              {p.status === 'declared' && <p className="muted" style={{ fontSize: 12 }}>Justificatif reçu : en attente de vérification. Ce n’est pas encore une confirmation.</p>}
            </div>
          ))}
          <div className="notice">La commande se paie au commerçant, la course au service : ce sont deux transferts distincts, vérifiés à la main pendant le pilote.</div>
        </section>
        {open && <Modal title={`Justificatif · ${money(open.amount)}`} onClose={() => setOpen(null)}><PaymentDeclare ob={open} orderId={d.order.id} client onDone={() => { setOpen(null); q.reload(); }} /></Modal>}
      </>
    )}</Async>
  );
}

export function ClientHelp() {
  const q = useOrder();
  const [text, setText] = useState('');
  const { run, busy } = useAction();
  return (
    <Async q={q}>{(d: any) => (
      <>
        <Intro title="On vous accompagne." sub="Un souci avec votre livraison ? Dites-le nous." />
        <section className="card formcard">
          {d.courier?.phone && <CourierLine name={d.courier.firstName} phone={d.courier.phone} />}
          {d.shopPhone && <div className="driver"><span className="avatar"><Icon name="box" /></span><div><b>{d.order.shop_name}</b><small>Le commerçant</small></div><a className="round" href={`tel:${d.shopPhone}`} aria-label="Appeler le commerçant"><Icon name="phone" /></a></div>}
          <Field label="Décrivez le problème"><textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Ex. le colis est abîmé, je ne suis pas disponible…" /></Field>
          <button className="primary block" disabled={busy || !text.trim()} onClick={async () => { if (await run(() => api('/api/client/report', { client: true, body: { type: 'complaint', description: text } }), 'Signalement envoyé. L’équipe vous recontacte.')) setText(''); }}>Envoyer à l’équipe<Icon name="arrow" /></button>
        </section>
      </>
    )}</Async>
  );
}
