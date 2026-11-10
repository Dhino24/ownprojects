// Contrat métier unique, partagé par l'API, l'interface et les intégrations.
// Chaque état est séparé : livraison, offre, paiements, gains/reversements.

export const ORDER_STATUSES = [
  'awaiting_location', // créée, en attente de la position du client
  'ready', // position reçue, attribuable par l'admin
  'offered', // une offre de 30 s est en cours auprès d'un livreur
  'assigned', // livreur a accepté
  'at_pickup', // arrivé au lieu de retrait
  'picked_up', // colis récupéré
  'in_delivery', // en route vers le client
  'incident', // bloquée : décision admin requise (client introuvable, preuve photo…)
  'delivered',
  'cancelled',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const FINAL_STATUSES: OrderStatus[] = ['delivered', 'cancelled'];
export const COURIER_ACTIVE_STATUSES: OrderStatus[] = ['assigned', 'at_pickup', 'picked_up', 'in_delivery', 'incident'];
export const BEFORE_ASSIGNMENT: OrderStatus[] = ['awaiting_location', 'ready', 'offered'];

export type Actor = 'merchant' | 'customer' | 'courier' | 'admin' | 'system';

/** Transitions de livraison autorisées et acteurs pouvant les déclencher. */
export const TRANSITIONS: Record<string, { from: OrderStatus[]; to: OrderStatus; actors: Actor[] }> = {
  location_received: { from: ['awaiting_location'], to: 'ready', actors: ['customer', 'admin'] },
  offer_sent: { from: ['ready'], to: 'offered', actors: ['admin'] },
  offer_closed: { from: ['offered'], to: 'ready', actors: ['courier', 'admin', 'system'] }, // refus, expiration, retrait
  offer_accepted: { from: ['offered'], to: 'assigned', actors: ['courier'] },
  arrived_pickup: { from: ['assigned'], to: 'at_pickup', actors: ['courier'] },
  picked_up: { from: ['at_pickup'], to: 'picked_up', actors: ['courier'] },
  departed: { from: ['picked_up'], to: 'in_delivery', actors: ['courier'] },
  delivered_code: { from: ['picked_up', 'in_delivery'], to: 'delivered', actors: ['courier'] },
  incident_opened: { from: ['assigned', 'at_pickup', 'picked_up', 'in_delivery'], to: 'incident', actors: ['courier'] },
  incident_resumed: { from: ['incident'], to: 'in_delivery', actors: ['admin'] }, // reprise vers l'état précédent
  delivered_photo_approved: { from: ['incident'], to: 'delivered', actors: ['admin'] },
  cancelled_free: { from: BEFORE_ASSIGNMENT, to: 'cancelled', actors: ['merchant', 'admin'] },
  cancelled_with_fee: { from: ['assigned', 'at_pickup'], to: 'cancelled', actors: ['merchant', 'admin'] },
  cancelled_admin: { from: ['picked_up', 'in_delivery', 'incident'], to: 'cancelled', actors: ['admin'] },
};

export const OFFER_STATUSES = ['pending', 'accepted', 'refused', 'expired', 'withdrawn'] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

export const OBLIGATION_KINDS = ['order_amount', 'delivery_fee', 'cancellation_fee'] as const;
export type ObligationKind = (typeof OBLIGATION_KINDS)[number];
/** due = à régler · declared = déclaré, justificatif à vérifier · confirmed = reçu (vérifié) · rejected · waived = annulé */
export const OBLIGATION_STATUSES = ['due', 'declared', 'confirmed', 'rejected', 'waived'] as const;
export type ObligationStatus = (typeof OBLIGATION_STATUSES)[number];

export const EARNING_STATUSES = ['pending', 'paid'] as const; // paid = reversé
export type EarningStatus = (typeof EARNING_STATUSES)[number];

export const PAYMENT_METHODS = ['wave', 'orange_money'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const INCIDENT_TYPES = ['customer_not_found', 'photo_proof', 'damaged', 'complaint', 'other'] as const;
export type IncidentType = (typeof INCIDENT_TYPES)[number];

export const ROLES = ['merchant', 'courier', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  awaiting_location: 'Position attendue',
  ready: 'À attribuer',
  offered: 'Offre envoyée',
  assigned: 'Livreur en route vers le retrait',
  at_pickup: 'Livreur au retrait',
  picked_up: 'Colis récupéré',
  in_delivery: 'En livraison',
  incident: 'Incident en cours',
  delivered: 'Livrée',
  cancelled: 'Annulée',
};

export const OBLIGATION_STATUS_LABEL: Record<ObligationStatus, string> = {
  due: 'À régler',
  declared: 'Déclaré · à vérifier',
  confirmed: 'Reçu · vérifié',
  rejected: 'Justificatif refusé',
  waived: 'Annulé',
};

export const OBLIGATION_KIND_LABEL: Record<ObligationKind, string> = {
  order_amount: 'Commande (au commerçant)',
  delivery_fee: 'Course (au service)',
  cancellation_fee: 'Frais d’annulation (au service)',
};

export const METHOD_LABEL: Record<PaymentMethod, string> = { wave: 'Wave', orange_money: 'Orange Money' };

export const INCIDENT_LABEL: Record<IncidentType, string> = {
  customer_not_found: 'Client introuvable',
  photo_proof: 'Remise avec preuve photo',
  damaged: 'Colis endommagé',
  complaint: 'Réclamation',
  other: 'Autre',
};

export const OFFER_STATUS_LABEL: Record<OfferStatus, string> = {
  pending: 'En attente',
  accepted: 'Acceptée',
  refused: 'Refusée',
  expired: 'Expirée',
  withdrawn: 'Retirée',
};

/** Position plus ancienne que ce seuil = périmée (affichée comme telle). */
export const POSITION_STALE_SECONDS = 180;

export const TIMEZONE = 'Africa/Dakar';
