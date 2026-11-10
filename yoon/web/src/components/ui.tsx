import { Fragment, createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from './Icon';
import { ApiError } from '../lib/api';
import { longToday } from '../lib/format';
import { ORDER_STATUS_LABEL, OBLIGATION_STATUS_LABEL, type OrderStatus, type ObligationStatus } from '../../../shared/contract';

// ---------- Toasts ----------
type ToastT = { text: string; err?: boolean } | null;
const ToastCtx = createContext<(text: string, err?: boolean) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<ToastT>(null);
  const timer = useRef<number>(0);
  const show = useCallback((text: string, err = false) => {
    setT({ text, err });
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setT(null), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div aria-live="polite" role="status">{t && <div className={`toast ${t.err ? 'err' : ''}`}>{t.text}</div>}</div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

/** Exécute une action serveur : bouton occupé, erreur affichée, succès seulement après réponse du serveur. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      if (success) toast(success);
      return r;
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Erreur inattendue.';
      setError(msg);
      toast(msg, true);
      return undefined;
    } finally {
      setBusy(false);
    }
  }, [toast]);
  return { run, busy, error, setError };
}

// ---------- Mise en forme ----------
export function Intro({ title, sub, action, eyebrow }: { title: ReactNode; sub?: ReactNode; action?: ReactNode; eyebrow?: string }) {
  return (
    <div className="between intro">
      <div>
        <div className="eyebrow">{eyebrow ?? `Dakar, Sénégal  /  ${longToday()}`}</div>
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {action}
    </div>
  );
}

export function Stat({ label, value, sub, icon, to }: { label: string; value: ReactNode; sub?: ReactNode; icon: string; to?: string }) {
  const inner = (
    <>
      <div className="between"><small>{label}</small><Icon name={icon} /></div>
      <div className="statvalue">{value}</div>
      {sub && <small>{sub}</small>}
    </>
  );
  return to ? <Link className="stat" to={to}>{inner}</Link> : <div className="stat">{inner}</div>;
}

const ORANGE: OrderStatus[] = ['awaiting_location', 'ready', 'offered'];
export function StatusTag({ status }: { status: OrderStatus }) {
  const cls = status === 'incident' ? 'red' : status === 'cancelled' ? 'grey' : ORANGE.includes(status) ? 'orange' : '';
  return <span className={`tag ${cls}`}>{ORDER_STATUS_LABEL[status] ?? status}</span>;
}
export function PayTag({ status }: { status: ObligationStatus | null }) {
  if (!status) return null;
  const cls = status === 'confirmed' ? '' : status === 'rejected' ? 'red' : status === 'waived' ? 'grey' : 'orange';
  return <span className={`tag ${cls}`}>{OBLIGATION_STATUS_LABEL[status]}</span>;
}

// ---------- États ----------
export function Loading({ lines = 3 }: { lines?: number }) {
  return <div className="pad" aria-busy="true" aria-label="Chargement">{Array.from({ length: lines }, (_, i) => <div key={i} className="skeleton" style={{ width: `${90 - i * 15}%` }} />)}</div>;
}
export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
export function ErrorState({ error, retry }: { error: ApiError; retry?: () => void }) {
  const title = error.code === 'offline' ? 'Hors connexion' : error.status === 403 ? 'Accès refusé' : error.status === 404 ? 'Introuvable'
    : error.status === 401 ? 'Session expirée' : 'Un problème est survenu';
  return (
    <div className="card state" role="alert">
      <h2>{title}</h2>
      <p>{error.message}</p>
      {error.status === 401 ? <Link className="primary" to="/connexion">Se reconnecter</Link> : retry && <button className="primary" onClick={retry}>Réessayer <Icon name="refresh" /></button>}
    </div>
  );
}

/** Rend loading / error / contenu de façon homogène. */
export function Async<T>({ q, children, lines }: { q: { data: T | null; error: ApiError | null; loading: boolean; reload: () => void }; children: (d: T) => ReactNode; lines?: number }) {
  if (q.error && !q.data) return <ErrorState error={q.error} retry={q.reload} />;
  if (!q.data) return <div className="card"><Loading lines={lines} /></div>;
  return <>{children(q.data)}</>;
}

// ---------- Modale ----------
export function Modal({ title, onClose, children, eyebrow = 'Yoon' }: { title: string; onClose: () => void; children: ReactNode; eyebrow?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input,select,textarea,button:not([aria-label=Fermer])')?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); prev?.focus(); };
  }, [onClose]);
  return (
    <div className="modalback" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="modal" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="between"><span className="eyebrow">{eyebrow}</span><button className="round" aria-label="Fermer" onClick={onClose}><Icon name="x" /></button></div>
        <h2>{title}</h2>
        {children}
      </section>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="field">{label}{children}{hint && <span className="hint">{hint}</span>}</label>;
}

export function Kv({ rows }: { rows: [string, ReactNode][] }) {
  return <dl className="kv">{rows.filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl>;
}
