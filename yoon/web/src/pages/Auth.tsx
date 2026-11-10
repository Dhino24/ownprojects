import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { Field, useAction } from '../components/ui';
import { Icon } from '../components/Icon';
import { Banners, HOME, useSession } from '../components/Layout';

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Banners />
      <div className="authwrap">
        <div style={{ width: '100%', maxWidth: 440 }}>
          <div className="brand" style={{ marginBottom: 6 }}><span className="mark">↗</span>yoon<span style={{ color: '#97b96a' }}>.</span></div>
          <div className="subtitle" style={{ marginBottom: 20 }}>La livraison, simplement.</div>
          <section className="card authcard">{children}</section>
          <p className="bottomnote">Pensé pour Dakar. Fait pour vous. ↗</p>
        </div>
      </div>
    </>
  );
}

export function Login() {
  const { me, reload } = useSession();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const { run, busy, error } = useAction();
  if (me) return <Navigate to={params.get('retour') || HOME[me.user.role]} replace />;
  return (
    <Shell>
      <h2>Bon retour.</h2>
      <p className="muted">Connectez-vous avec votre numéro WhatsApp.</p>
      <form onSubmit={async (e) => {
        e.preventDefault();
        const ok = await run(() => api('/api/auth/login', { body: { phone, password } }));
        if (ok) { await reload(); navigate(params.get('retour') || '/', { replace: true }); }
      }}>
        <Field label="Téléphone"><input required type="tel" inputMode="tel" autoComplete="tel" placeholder="77 000 00 00" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        <Field label="Mot de passe"><input required type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        {error && <p className="err-text" role="alert">{error}</p>}
        <button className="primary block" disabled={busy}>{busy ? 'Connexion…' : 'Se connecter'}<Icon name="arrow" /></button>
      </form>
      <p className="muted" style={{ fontSize: 13 }}>Pas encore de compte ? <Link to="/inscription">Créer un compte commerçant ou livreur</Link></p>
      <p className="muted" style={{ fontSize: 12 }}>Vous attendez un colis ? Ouvrez le lien reçu sur WhatsApp : aucun compte n’est nécessaire.</p>
    </Shell>
  );
}

export function Register() {
  const { me, reload } = useSession();
  const navigate = useNavigate();
  const [role, setRole] = useState<'merchant' | 'courier'>('merchant');
  const [zones, setZones] = useState<any[]>([]);
  const [f, setF] = useState({ name: '', phone: '', password: '', shopName: '', zoneId: '', pickupAddress: '', wave: '', om: '', vehicle: 'moto', homeZoneId: '' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const { run, busy, error } = useAction();
  useEffect(() => { api('/api/zones').then(setZones).catch(() => {}); }, []);
  if (me) return <Navigate to={HOME[me.user.role]} replace />;
  const active = zones.filter((z) => z.active);
  return (
    <Shell>
      <h2>Créer votre compte</h2>
      <div className="filters" style={{ padding: '14px 0' }} role="radiogroup" aria-label="Profil">
        {(['merchant', 'courier'] as const).map((r) => <button key={r} type="button" role="radio" aria-checked={role === r} className={role === r ? 'active' : ''} onClick={() => setRole(r)}>{r === 'merchant' ? 'Je suis commerçant' : 'Je suis livreur'}</button>)}
      </div>
      <form onSubmit={async (e) => {
        e.preventDefault();
        const body: any = { role, name: f.name, phone: f.phone, password: f.password };
        if (role === 'merchant') body.shop = { name: f.shopName, zoneId: Number(f.zoneId), pickupAddress: f.pickupAddress, waveNumber: f.wave || undefined, orangeMoneyNumber: f.om || undefined };
        else body.courier = { vehicle: f.vehicle, homeZoneId: f.homeZoneId ? Number(f.homeZoneId) : undefined };
        const ok = await run(() => api('/api/auth/register', { body }));
        if (ok) { await reload(); navigate(role === 'merchant' ? '/m' : '/l', { replace: true }); }
      }}>
        <Field label="Prénom et nom"><input required minLength={2} autoComplete="name" value={f.name} onChange={set('name')} /></Field>
        <Field label="Téléphone WhatsApp"><input required type="tel" inputMode="tel" autoComplete="tel" placeholder="77 000 00 00" value={f.phone} onChange={set('phone')} /></Field>
        <Field label="Mot de passe" hint="8 caractères minimum."><input required type="password" minLength={8} autoComplete="new-password" value={f.password} onChange={set('password')} /></Field>
        {role === 'merchant' ? (
          <>
            <Field label="Nom de la boutique"><input required value={f.shopName} onChange={set('shopName')} /></Field>
            <Field label="Zone de retrait" hint={active.length ? 'Seules les zones ouvertes pendant le pilote sont proposées.' : 'Aucune zone n’est encore ouverte : l’équipe doit en activer.'}>
              <select required value={f.zoneId} onChange={set('zoneId')}><option value="">Choisir…</option>{active.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}</select>
            </Field>
            <Field label="Lieu de retrait" hint="Ex. Mermoz, en face de la station."><input required minLength={3} value={f.pickupAddress} onChange={set('pickupAddress')} /></Field>
            <div className="two">
              <Field label="Numéro Wave (facultatif)"><input type="tel" value={f.wave} onChange={set('wave')} /></Field>
              <Field label="Numéro Orange Money (facultatif)"><input type="tel" value={f.om} onChange={set('om')} /></Field>
            </div>
          </>
        ) : (
          <>
            <Field label="Véhicule"><select value={f.vehicle} onChange={set('vehicle')}><option value="moto">Moto</option><option value="scooter">Scooter</option></select></Field>
            <Field label="Zone habituelle (facultatif)"><select value={f.homeZoneId} onChange={set('homeZoneId')}><option value="">—</option>{zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}</select></Field>
            <div className="notice">Votre profil sera validé par l’équipe avant de recevoir des courses.</div>
          </>
        )}
        {error && <p className="err-text" role="alert">{error}</p>}
        <button className="primary block" disabled={busy}>{busy ? 'Création…' : 'Créer mon compte'}<Icon name="check" /></button>
      </form>
      <p className="muted" style={{ fontSize: 13 }}>Déjà inscrit ? <Link to="/connexion">Se connecter</Link></p>
    </Shell>
  );
}

export function RootRedirect() {
  const { me, loading } = useSession();
  if (loading) return null;
  return <Navigate to={me ? HOME[me.user.role] : '/connexion'} replace />;
}
