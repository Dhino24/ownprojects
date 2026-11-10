// Les 8 messages du MVP. Le wolof provient du PDF et DOIT être relu par un locuteur avant usage en production :
// tant que WOLOF_REVIEWED est faux, l'application n'envoie que le français.
export const WOLOF_REVIEWED = false;

export type TemplateKey =
  | 'merchant_welcome'
  | 'location_request'
  | 'courier_offer'
  | 'courier_en_route'
  | 'delivery_code'
  | 'payment_request'
  | 'customer_not_found'
  | 'daily_recap';

const T: Record<TemplateKey, { fr: string; wo: string }> = {
  merchant_welcome: {
    fr: 'Bonjour {nom} ! Pour une livraison, envoyez : 1) le nom et le numéro du client, 2) le lieu de retrait, 3) le lieu de livraison, 4) le montant de la commande. Prix de la course : {prix} FCFA.',
    wo: 'Salaam aleekum {nom} ! Ngir livraison, yonnee ma : 1) tur ak numéro client bi, 2) fu ma ko wara jukki, 3) fu ma ko wara yobbu, 4) montant commande bi. Prix course bi : {prix} FCFA.',
  },
  location_request: {
    fr: 'Bonjour {nom}, {commercant} vous envoie une commande. Pour que le livreur vous trouve, ouvrez ce lien et partagez votre position, puis un repère (ex. « en face de la pharmacie »), une photo ou une note vocale : {lien}',
    wo: 'Salaam aleekum {nom}, {commercant} dafa la yonnee commande. Ngir livreur bi gis la, ubbil lien bii te yonnee sa position, te yokk ko benn repère, nataal walla note vocale : {lien}',
  },
  courier_offer: {
    fr: 'Nouvelle course ! Retrait : {retrait}. Livraison : {zone}. Gain : {gain} FCFA. Répondez dans l’application en 30 secondes.',
    wo: 'Course bu bees ! Jukki : {retrait}. Yobbu : {zone}. Ngain : {gain} FCFA. Tontu ci 30 segonds.',
  },
  courier_en_route: {
    fr: 'Votre livreur {prenom} est en route. Suivez votre livraison ici : {lien}. Gardez votre téléphone près de vous.',
    wo: 'Sa livreur {prenom} mu ngi ci yoon. Toppal ko fii : {lien}. Wacc sa téléphone ci sa wet.',
  },
  delivery_code: {
    fr: 'Votre code de livraison : {code}. Donnez-le au livreur seulement quand vous avez reçu votre commande.',
    wo: 'Sa code livraison : {code}. Jox ko livreur bi rekk bu la commande bi egg.',
  },
  payment_request: {
    fr: 'Montant à payer : {montant} FCFA. Payez par Wave ou Orange Money au {numero}, puis déposez la capture d’écran ici : {lien}',
    wo: 'Montant bi ngay fay : {montant} FCFA. Fay ak Wave walla Orange Money ci {numero}, te yonnee capture bi fii : {lien}',
  },
  customer_not_found: {
    fr: 'Votre livreur est arrivé mais ne vous trouve pas. Renvoyez votre position ({lien}) ou appelez-le au {numero_livreur}. Sans réponse dans {minutes} minutes, la course sera annulée.',
    wo: 'Sa livreur agsi na waaye gisu la. Yonnee sa position ({lien}) walla woo ko ci {numero_livreur}. Su tontoowul ci {minutes} minutes, course bi dina neenal.',
  },
  daily_recap: {
    fr: 'Récap du {date} : {nombre} livraisons faites, {montant} FCFA de paiements reçus. Une question ? Répondez à ce message.',
    wo: 'Récap bi {date} : {nombre} livraison def nañu, {montant} FCFA paiement jot nañu. Am nga laaj ? Tontu ci message bii.',
  },
};

export function render(key: TemplateKey, vars: Record<string, string | number>, lang: 'fr' | 'wo' = 'fr'): string {
  const useLang = lang === 'wo' && WOLOF_REVIEWED ? 'wo' : 'fr';
  return T[key][useLang].replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}

export const templates = T;
