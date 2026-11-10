import { Suspense, createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Icon } from './Icon';
import { api, ApiError } from '../lib/api';
import { useOnline, stopLive } from '../lib/live';
import { initials } from '../lib/format';
import type { Role } from '../../../shared/contract';

export type Me = { user: { id: string; name: string; phone: string; role: Role }; shop: any; courier: any };
export type Meta = { appName: string; demo: boolean; whatsappMode: string; paymentMode: string; offerTtl: number };

const SessionCtx = createContext<{ me: Me | null; meta: Meta | null; loading: boolean; error: ApiError | null; reload: () => Promise<void> }>({ me: null, meta: null, loading: true, error: null, reload: async () => {} });
export const useSession = () => useContext(SessionCtx);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const reload = async () => {
    try {
      setMe(await api<Me>('/api/me'));
      setError(null);
    } catch (e) {
      setMe(null);
      if (e instanceof ApiError && e.status !== 401) setError(e);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    reload();
    api<Meta>('/api/meta').then(setMeta).catch(() => {});
    const onUnauth = () => setMe(null);
    window.addEventListener('yoon:unauthenticated', onUnauth);
    return () => window.removeEventListener('yoon:unauthenticated', onUnauth);
  }, []);
  return <SessionCtx.Provider value={{ me, meta, loading, error, reload }}>{children}</SessionCtx.Provider>;
}

export type NavItem = { to: string; icon: string; label: string; end?: boolean; mobile?: boolean; count?: number };

export const HOME: Record<Role, string> = { merchant: '/m', courier: '/l', admin: '/a' };

export function Banners() {
  const online = useOnline();
  const { meta } = useSession();
  return (
    <>
      {meta?.demo && <div className="banner demo" role="note"><Icon name="alert" size={16} />Mode démonstration · données fictives, aucun paiement ni message réel.</div>}
      {!online && <div className="banner offline" role="status"><Icon name="alert" size={16} />Hors connexion. Rien n’est envoyé tant que le réseau n’est pas revenu.</div>}
    </>
  );
}

function Brand({ className = 'brand' }: { className?: string }) {
  return <Link to="/" className={className} aria-label="Yoon, accueil"><span className="mark">↗</span>yoon<span style={{ color: '#97b96a' }}>.</span></Link>;
}

/** Coquille d'un espace authentifié : le rôle est vérifié ici pour l'affichage, et côté serveur pour l'accès réel. */
export function RoleLayout({ role, label, nav }: { role: Role; label: string; nav: NavItem[] }) {
  const { me, loading, error, reload } = useSession();
  const loc = useLocation();
  const navigate = useNavigate();
  if (loading) return <div className="authwrap"><div className="card pad">Chargement…</div></div>;
  if (error) return <div className="authwrap"><div className="card state"><h2>Connexion impossible</h2><p>{error.message}</p><button className="primary" onClick={reload}>Réessayer</button></div></div>;
  if (!me) return <Navigate to={`/connexion?retour=${encodeURIComponent(loc.pathname)}`} replace />;
  if (me.user.role !== role) {
    return <div className="authwrap"><div className="card state"><h2>Accès réservé</h2><p>Cet espace est réservé au profil {label.toLowerCase()}.</p><Link className="primary" to={HOME[me.user.role]}>Aller à mon espace</Link></div></div>;
  }
  const current = nav.find((n) => (n.end ? loc.pathname === n.to : loc.pathname.startsWith(n.to)));
  const logout = async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    stopLive();
    await reload();
    navigate('/connexion');
  };
  return (
    <>
      <aside className="sidebar">
        <Brand />
        <div className="subtitle">La livraison, simplement.</div>
        <div className="navlabel">Espace {label.toLowerCase()}</div>
        <nav aria-label="Navigation principale">
          {nav.map((n) => <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `navbtn ${isActive ? 'active' : ''}`}><Icon name={n.icon} />{n.label}{!!n.count && <span className="count">{n.count}</span>}</NavLink>)}
        </nav>
        <div className="sidebarfooter">
          <div className="helpbox"><span className="flex"><Icon name="chat" /><b>On est ensemble.</b></span><p>Une question ? L’équipe Yoon vous répond sur WhatsApp.</p></div>
          <NavLink to={nav[nav.length - 1].to} className="navbtn"><span className="avatar">{initials(me.user.name)}</span><span><b>{me.user.name}</b><small style={{ display: 'block', marginTop: 3, fontSize: 11 }}>{me.shop?.name ?? 'Dakar, Sénégal'}</small></span></NavLink>
          <button className="navbtn" onClick={logout}><Icon name="logout" />Se déconnecter</button>
        </div>
      </aside>
      <header className="topbar">
        <div className="topcrumb"><small>Espace {label.toLowerCase()}</small><span style={{ color: '#c6cfc1', margin: '0 12px' }}>/</span><b style={{ fontSize: 13 }}>{current?.label ?? 'Détail'}</b></div>
        <Brand className="brand mobilebrand" />
        <div className="flex">
          <button className="round" aria-label="Se déconnecter" onClick={logout} title="Se déconnecter"><Icon name="logout" /></button>
        </div>
      </header>
      <Banners />
      <main className="stage" id="contenu"><div className="screen" key={loc.pathname}><Suspense fallback={<div className="card pad" aria-busy="true">Chargement…</div>}><Outlet /></Suspense></div>
        <div className="bottomnote">Pensé pour Dakar. Fait pour vous. ↗</div>
      </main>
      <nav className="bottomnav" aria-label="Navigation mobile">
        {nav.filter((n) => n.mobile !== false).slice(0, 5).map((n) => <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'active' : '')}><Icon name={n.icon} />{n.label}</NavLink>)}
      </nav>
    </>
  );
}
