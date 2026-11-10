import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ApiError, clientToken } from './api';

// --- Statut réseau ---
const subscribeOnline = (cb: () => void) => {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
};
export const useOnline = () => useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);

// --- Flux temps réel (SSE lu via fetch pour pouvoir envoyer l'en-tête client) ---
type Listener = (ev: { kind: string; orderId: string | null }) => void;
const listeners = new Set<Listener>();
let running: { client: boolean; abort: AbortController } | null = null;

async function loop(client: boolean, ctrl: AbortController) {
  let delay = 2000;
  while (!ctrl.signal.aborted) {
    try {
      const res = await fetch('/api/live', { headers: client ? { 'x-client-token': clientToken.get() } : {}, signal: ctrl.signal, credentials: 'same-origin' });
      if (!res.ok || !res.body) throw new Error('live');
      delay = 2000;
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const line = chunk.split('\n').find((l) => l.startsWith('data: '));
          if (line) {
            try { const ev = JSON.parse(line.slice(6)); listeners.forEach((l) => l(ev)); } catch { /* ignore */ }
          }
        }
      }
    } catch {
      if (ctrl.signal.aborted) return;
    }
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 2, 30000);
  }
}

export function useLiveEvents(cb: Listener, client = false) {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => {
    const l: Listener = (e) => ref.current(e);
    listeners.add(l);
    if (!running || running.client !== client) {
      running?.abort.abort();
      running = { client, abort: new AbortController() };
      loop(client, running.abort);
    }
    return () => { listeners.delete(l); };
  }, [client]);
}

export function stopLive() {
  running?.abort.abort();
  running = null;
}

// --- Chargement de données avec rafraîchissement temps réel + filet de sécurité périodique ---
export function useData<T>(fetcher: () => Promise<T>, deps: unknown[], opts: { live?: boolean; client?: boolean; every?: number } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;
  const seq = useRef(0);
  const reload = useCallback(async () => {
    const n = ++seq.current;
    try {
      const d = await fetchRef.current();
      if (n === seq.current) { setData(d); setError(null); }
    } catch (e) {
      if (n === seq.current) setError(e instanceof ApiError ? e : new ApiError(0, 'error', String(e)));
    } finally {
      if (n === seq.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    setLoading(true);
    setData(null);
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  const timer = useRef<number>(0);
  useLiveEvents(() => {
    if (!opts.live) return;
    clearTimeout(timer.current);
    timer.current = window.setTimeout(reload, 250);
  }, !!opts.client);
  useEffect(() => {
    if (!opts.live) return;
    const t = window.setInterval(reload, opts.every ?? 20000);
    const on = () => reload();
    window.addEventListener('online', on);
    window.addEventListener('focus', on);
    return () => { clearInterval(t); window.removeEventListener('online', on); window.removeEventListener('focus', on); };
  }, [opts.live, opts.every, reload]);
  return { data, error, loading, reload, setData };
}
