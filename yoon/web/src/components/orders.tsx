import { Link } from 'react-router-dom';
import { Icon } from './Icon';
import { PayTag, StatusTag, useAction, Empty } from './ui';
import { api } from '../lib/api';
import { ago, initials, money, time, when } from '../lib/format';
import { INCIDENT_LABEL, type OrderStatus } from '../../../shared/contract';

export function OrderRow({ o, to, showShop }: { o: any; to: string; showShop?: boolean }) {
  return (
    <Link className="delivery" to={to}>
      <div className="between">
        <div className="flex">
          <div className="parcelicon"><Icon name="box" /></div>
          <div><b>{o.customer_name}</b><small>#{o.ref} · {when(o.created_at)}{showShop ? ` · ${o.shop_name}` : ''}</small></div>
        </div>
        <StatusTag status={o.status} />
      </div>
      <div className="route"><span>{o.pickup_zone}</span><Icon name="arrow" /><span>{o.dest_zone}</span>
        {o.fee_payment && <PayTag status={o.fee_payment} />}
        <b style={{ marginLeft: 'auto', color: '#3f5c3b' }}>{money(o.delivery_price)}</b></div>
    </Link>
  );
}

export function OrderList({ items, base, showShop, empty }: { items: any[]; base: string; showShop?: boolean; empty?: string }) {
  if (!items.length) return <Empty>{empty ?? 'Aucune livraison dans cette catégorie.'}</Empty>;
  return <>{items.map((o) => <OrderRow key={o.id} o={o} to={`${base}/${o.id}`} showShop={showShop} />)}</>;
}

const EVENT_LABEL: Record<string, string> = {
  created: 'Commande confirmée', location_received: 'Position du client reçue', location_updated: 'Repère mis à jour', offer_sent: 'Offre envoyée à un livreur',
  offer_closed: 'Offre close', offer_expired: 'Offre expirée sans réponse', offer_accepted: 'Livreur attribué', arrived_pickup: 'Livreur au retrait',
  picked_up: 'Colis récupéré', departed: 'En route vers le client', delivered_code: 'Remis contre le code client', code_failed: 'Code incorrect saisi',
  incident_opened: 'Incident signalé', incident_resumed: 'Course reprise', delivered_photo_approved: 'Remise validée par l’équipe (photo)',
  cancelled_free: 'Annulée (sans frais)', cancelled_with_fee: 'Annulée (frais après attribution)', cancelled_admin: 'Annulée par l’équipe',
  payment_declared: 'Paiement déclaré · à vérifier', payment_confirmed: 'Paiement vérifié', payment_rejected: 'Justificatif refusé',
  contact_attempt: 'Tentative de contact du client', problem_reported: 'Problème signalé', client_link_renewed: 'Nouveau lien client',
  code_regenerated: 'Nouveau code généré',
};
const REASON: Record<string, string> = { refused: 'refusée', expired: 'expirée', withdrawn: 'retirée' };

export function Timeline({ events }: { events: { type: string; created_at?: string; at?: string; data?: any; actor?: string }[] }) {
  if (!events.length) return <Empty>Aucun événement.</Empty>;
  return (
    <div className="timeline">
      {events.map((e, i) => (
        <div key={i}><b>{EVENT_LABEL[e.type] ?? e.type}{e.type === 'offer_closed' && e.data?.reason ? ` (${REASON[e.data.reason] ?? e.data.reason})` : ''}</b>
          <small>{time(e.created_at ?? e.at)}{e.data?.type ? ` · ${INCIDENT_LABEL[e.data.type as keyof typeof INCIDENT_LABEL] ?? e.data.type}` : ''}{e.data?.reason && e.type.startsWith('cancelled') ? ` · ${e.data.reason}` : ''}</small></div>
      ))}
    </div>
  );
}

export function CourierLine({ name, sub, phone, position }: { name: string; sub?: string; phone?: string | null; position?: any }) {
  return (
    <div className="driver">
      <span className="avatar">{initials(name)}</span>
      <div><b>{name}</b><small>{sub ?? 'Votre livreur · Moto'}</small>
        {position !== undefined && <small><span className={`dot ${!position ? 'off' : position.stale ? 'stale' : ''}`} />{position ? `Position ${ago(position.ageSec)}${position.stale ? ' · périmée' : ''}` : 'Position non partagée'}</small>}
      </div>
      {phone && <a className="round" href={`tel:${phone}`} aria-label={`Appeler ${name}`}><Icon name="phone" /></a>}
      {phone && <a className="round" href={`https://wa.me/${phone.replace(/\D/g, '')}`} target="_blank" rel="noopener" aria-label={`WhatsApp ${name}`}><Icon name="chat" /></a>}
    </div>
  );
}

const MSG_STATUS: Record<string, string> = { prepared: 'À envoyer', opened: 'Ouvert · envoi non confirmé', confirmed_sent: 'Envoyé (confirmé)', failed: 'Remplacé', sent: 'Envoyé', delivered: 'Distribué' };
const TEMPLATE: Record<string, string> = { location_request: 'Demande de position', courier_offer: 'Offre au livreur', courier_en_route: 'Livreur en route', delivery_code: 'Code de livraison', payment_request: 'Paiement', customer_not_found: 'Client introuvable', daily_recap: 'Récap du jour' };

/** Messages WhatsApp en mode manuel : ouvrir ne vaut pas envoi ; l'envoi doit être confirmé. */
export function Messages({ items, reload }: { items: any[]; reload: () => void }) {
  const { run, busy } = useAction();
  const visible = items.filter((m) => m.status !== 'failed');
  if (!visible.length) return <Empty>Aucun message à envoyer.</Empty>;
  return (
    <>
      {visible.map((m) => (
        <div key={m.id} className="list-item">
          <div className="between"><b>{TEMPLATE[m.template] ?? m.template}{m.ref ? ` · #${m.ref}` : ''}</b><span className={`tag ${m.status === 'confirmed_sent' ? '' : 'orange'}`}>{MSG_STATUS[m.status] ?? m.status}</span></div>
          <p className="muted" style={{ fontSize: 12, margin: '8px 0' }}>{m.body}</p>
          <div className="row">
            <a className="secondary" href={m.wa_link} target="_blank" rel="noopener" onClick={() => m.status === 'prepared' && api(`/api/messages/${m.id}/mark`, { body: { status: 'opened' } }).then(reload).catch(() => {})}>Ouvrir WhatsApp<Icon name="chat" /></a>
            {m.status !== 'confirmed_sent' && <button className="primary" disabled={busy} onClick={async () => { await run(() => api(`/api/messages/${m.id}/mark`, { body: { status: 'confirmed_sent' } }), 'Envoi confirmé.'); reload(); }}>J’ai envoyé ce message<Icon name="check" /></button>}
          </div>
        </div>
      ))}
    </>
  );
}

export const PROGRESS: OrderStatus[] = ['ready', 'assigned', 'picked_up', 'in_delivery', 'delivered'];
export function progressIndex(s: OrderStatus) {
  if (s === 'awaiting_location') return 0;
  if (s === 'offered') return 1;
  if (s === 'at_pickup') return 2;
  return Math.max(0, PROGRESS.indexOf(s)) + 1;
}
export function Progress({ status }: { status: OrderStatus }) {
  const n = progressIndex(status);
  return <div className="progress" aria-label={`Étape ${n} sur 5`}>{[1, 2, 3, 4, 5].map((i) => <span key={i} className={i <= n ? 'on' : ''} />)}</div>;
}
