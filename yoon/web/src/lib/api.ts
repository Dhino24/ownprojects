export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: any) {
    super(message);
  }
  /** Erreur réparable par l'utilisateur (saisie, conflit) vs blocage. */
  get repairable() {
    return this.status === 400 || this.status === 409 || this.status === 422;
  }
}

const CLIENT_KEY = 'yoon_client_token';
export const clientToken = {
  get: () => localStorage.getItem(CLIENT_KEY) ?? '',
  set: (t: string) => localStorage.setItem(CLIENT_KEY, t),
  clear: () => localStorage.removeItem(CLIENT_KEY),
};

type Opts = { method?: string; body?: unknown; client?: boolean; idempotencyKey?: string; form?: FormData };

export async function api<T = any>(path: string, opts: Opts = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.client) headers['x-client-token'] = clientToken.get();
  if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;
  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? (opts.body !== undefined || opts.form ? 'POST' : 'GET'),
      headers, credentials: 'same-origin',
      body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    });
  } catch {
    // Jamais présenter comme effectuée une action que le serveur n'a pas confirmée.
    throw new ApiError(0, 'offline', 'Pas de connexion : rien n’a été envoyé. Réessayez quand le réseau revient.');
  }
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const err = new ApiError(res.status, data?.error ?? 'error', data?.message ?? 'Erreur inattendue.', data?.details);
    if (res.status === 401 && !opts.client) window.dispatchEvent(new CustomEvent('yoon:unauthenticated', { detail: err }));
    throw err;
  }
  return data as T;
}

export async function uploadMedia(file: Blob, orderId: string, kind: 'photo' | 'voice' | 'proof', client = false): Promise<string> {
  const f = new FormData();
  f.append('orderId', orderId);
  f.append('kind', kind);
  f.append('file', file, kind === 'voice' ? 'note' : 'photo.jpg');
  const r = await api<{ id: string }>('/api/media', { form: f, client });
  return r.id;
}

/** Réduit une photo (≤ 1600 px, JPEG) avant envoi : moins de données sur réseau mobile. */
export async function compressImage(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new ApiError(400, 'invalid_file_type', 'Choisissez une photo.');
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('compression'))), 'image/jpeg', 0.82));
  } catch {
    return file; // le serveur contrôlera le type réel
  }
}

export const newIdempotencyKey = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
