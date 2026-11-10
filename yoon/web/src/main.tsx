import { StrictMode, Suspense, lazy, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import './styles.css';
import { RoleLayout, SessionProvider, type NavItem } from './components/Layout';
import { ToastProvider } from './components/ui';
import { Login, Register, RootRedirect } from './pages/Auth';
// Chargement à la demande par rôle : moins de JavaScript à télécharger sur un téléphone d'entrée de gamme.
const pages = {
  merchant: () => import('./pages/merchant'),
  client: () => import('./pages/client'),
  courier: () => import('./pages/courier'),
  admin: () => import('./pages/admin'),
};
function L<K extends keyof typeof pages>(mod: K, name: string) {
  return lazy(() => pages[mod]().then((m: any) => ({ default: m[name] as ComponentType })));
}
const MerchantHome = L('merchant', 'MerchantHome'), MerchantOrder = L('merchant', 'MerchantOrder'), MerchantOrders = L('merchant', 'MerchantOrders'),
  MerchantProfile = L('merchant', 'MerchantProfile'), MerchantWallet = L('merchant', 'MerchantWallet'), NewOrder = L('merchant', 'NewOrder');
const ClientHelp = L('client', 'ClientHelp'), ClientHome = L('client', 'ClientHome'), ClientLocation = L('client', 'ClientLocation'),
  ClientPayment = L('client', 'ClientPayment'), ClientShell = L('client', 'ClientShell');
const CourierHome = L('courier', 'CourierHome'), CourierMission = L('courier', 'CourierMission'), CourierProfile = L('courier', 'CourierProfile'), CourierWallet = L('courier', 'CourierWallet');
const AdminCouriers = L('admin', 'AdminCouriers'), AdminIncidents = L('admin', 'AdminIncidents'), AdminMessages = L('admin', 'AdminMessages'), AdminOrder = L('admin', 'AdminOrder'),
  AdminOrders = L('admin', 'AdminOrders'), AdminOverview = L('admin', 'AdminOverview'), AdminPayments = L('admin', 'AdminPayments'), AdminPayouts = L('admin', 'AdminPayouts'),
  AdminRecap = L('admin', 'AdminRecap'), AdminSettings = L('admin', 'AdminSettings'), AdminZones = L('admin', 'AdminZones');

const merchantNav: NavItem[] = [
  { to: '/m', icon: 'home', label: 'Vue d’ensemble', end: true },
  { to: '/m/livraisons', icon: 'box', label: 'Mes livraisons' },
  { to: '/m/nouvelle', icon: 'plus', label: 'Nouvelle', mobile: true },
  { to: '/m/paiements', icon: 'wallet', label: 'Paiements' },
  { to: '/m/compte', icon: 'settings', label: 'Mon compte' },
];
const courierNav: NavItem[] = [
  { to: '/l', icon: 'home', label: 'Mes courses', end: true },
  { to: '/l/gains', icon: 'wallet', label: 'Mes gains' },
  { to: '/l/compte', icon: 'user', label: 'Mon compte' },
];
const adminNav: NavItem[] = [
  { to: '/a', icon: 'grid', label: 'Vue d’ensemble', end: true },
  { to: '/a/paiements', icon: 'wallet', label: 'Paiements' },
  { to: '/a/incidents', icon: 'alert', label: 'Incidents' },
  { to: '/a/livreurs', icon: 'user', label: 'Livreurs' },
  { to: '/a/plus', icon: 'list', label: 'Plus', mobile: true },
  { to: '/a/livraisons', icon: 'box', label: 'Livraisons', mobile: false },
  { to: '/a/reversements', icon: 'bike', label: 'Reversements', mobile: false },
  { to: '/a/zones', icon: 'settings', label: 'Zones & tarifs', mobile: false },
  { to: '/a/recap', icon: 'clock', label: 'Récap & export', mobile: false },
  { to: '/a/messages', icon: 'chat', label: 'Messages WhatsApp', mobile: false },
  { to: '/a/parametres', icon: 'settings', label: 'Paramètres', mobile: false },
];

function AdminMore() {
  return (
    <section className="card">
      {adminNav.filter((n) => n.mobile === false).map((n) => <Link key={n.to} className="delivery between" to={n.to}><b>{n.label}</b>↗</Link>)}
    </section>
  );
}

function NotFound() {
  return <div className="authwrap"><div className="card state"><h2>Page introuvable</h2><Link className="primary" to="/">Retour à l’accueil</Link></div></div>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <SessionProvider>
          <Suspense fallback={<div className="authwrap"><div className="card pad" aria-busy="true">Chargement…</div></div>}>
          <Routes>
            <Route path="/" element={<RootRedirect />} />
            <Route path="/connexion" element={<Login />} />
            <Route path="/inscription" element={<Register />} />
            <Route path="/c" element={<ClientShell />}>
              <Route index element={<ClientHome />} />
              <Route path="position" element={<ClientLocation />} />
              <Route path="paiement" element={<ClientPayment />} />
              <Route path="aide" element={<ClientHelp />} />
            </Route>
            <Route path="/m" element={<RoleLayout role="merchant" label="Commerçant" nav={merchantNav} />}>
              <Route index element={<MerchantHome />} />
              <Route path="livraisons" element={<MerchantOrders />} />
              <Route path="livraisons/:id" element={<MerchantOrder />} />
              <Route path="nouvelle" element={<NewOrder />} />
              <Route path="paiements" element={<MerchantWallet />} />
              <Route path="compte" element={<MerchantProfile />} />
            </Route>
            <Route path="/l" element={<RoleLayout role="courier" label="Livreur" nav={courierNav} />}>
              <Route index element={<CourierHome />} />
              <Route path="course/:id" element={<CourierMission />} />
              <Route path="gains" element={<CourierWallet />} />
              <Route path="compte" element={<CourierProfile />} />
            </Route>
            <Route path="/a" element={<RoleLayout role="admin" label="Admin" nav={adminNav} />}>
              <Route index element={<AdminOverview />} />
              <Route path="livraisons" element={<AdminOrders />} />
              <Route path="livraisons/:id" element={<AdminOrder />} />
              <Route path="paiements" element={<AdminPayments />} />
              <Route path="incidents" element={<AdminIncidents />} />
              <Route path="livreurs" element={<AdminCouriers />} />
              <Route path="reversements" element={<AdminPayouts />} />
              <Route path="zones" element={<AdminZones />} />
              <Route path="recap" element={<AdminRecap />} />
              <Route path="messages" element={<AdminMessages />} />
              <Route path="parametres" element={<AdminSettings />} />
              <Route path="plus" element={<AdminMore />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
          </Suspense>
        </SessionProvider>
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
