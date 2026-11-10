import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { compressImage, uploadMedia } from '../lib/api';
import { useAction } from './ui';

/** Photo : compressée puis envoyée ; l'identifiant n'est rendu qu'après confirmation du serveur. */
export function PhotoButton({ orderId, kind = 'photo', client, onUploaded, label = 'Ajouter une photo' }: {
  orderId: string; kind?: 'photo' | 'proof'; client?: boolean; onUploaded: (id: string, preview: string) => void; label?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const { run, busy } = useAction();
  return (
    <>
      <button type="button" className="secondary" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? 'Envoi…' : label}<Icon name="camera" />
      </button>
      <input ref={input} type="file" accept="image/*" capture="environment" hidden onChange={async (e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (!f) return;
        if (f.size > 15 * 1024 * 1024) return alert('Photo trop lourde.');
        const blob = await compressImage(f);
        const id = await run(() => uploadMedia(blob, orderId, kind, client), 'Photo envoyée.');
        if (id) onUploaded(id, URL.createObjectURL(blob));
      }} />
    </>
  );
}

const pickMime = () => ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'].find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(m));

/** Note vocale (60 s max) : utile pour un repère en wolof ou en français. */
export function VoiceButton({ orderId, client, onUploaded }: { orderId: string; client?: boolean; onUploaded: (id: string, url: string) => void }) {
  const [state, setState] = useState<'idle' | 'rec' | 'unsupported' | 'denied'>(typeof MediaRecorder === 'undefined' ? 'unsupported' : 'idle');
  const [secs, setSecs] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const { run, busy } = useAction();
  useEffect(() => () => rec.current?.stream.getTracks().forEach((t) => t.stop()), []);

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = pickMime();
      const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      r.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: r.mimeType || 'audio/webm' });
        setState('idle');
        const id = await run(() => uploadMedia(blob, orderId, 'voice', client), 'Note vocale envoyée.');
        if (id) onUploaded(id, URL.createObjectURL(blob));
      };
      r.start();
      rec.current = r;
      setSecs(0);
      setState('rec');
    } catch {
      setState('denied');
    }
  }
  useEffect(() => {
    if (state !== 'rec') return;
    const t = setInterval(() => setSecs((s) => {
      if (s >= 59) rec.current?.stop();
      return s + 1;
    }), 1000);
    return () => clearInterval(t);
  }, [state]);

  if (state === 'unsupported') return <button type="button" className="secondary" disabled title="Non pris en charge par ce navigateur">Note vocale indisponible<Icon name="mic" /></button>;
  return (
    <div>
      {state === 'rec'
        ? <button type="button" className="primary" style={{ width: '100%' }} onClick={() => rec.current?.stop()}>Arrêter · {secs}s<Icon name="check" /></button>
        : <button type="button" className="secondary" style={{ width: '100%' }} disabled={busy} onClick={start}>{busy ? 'Envoi…' : 'Note vocale'}<Icon name="mic" /></button>}
      {state === 'denied' && <p className="err-text">Micro refusé. Autorisez-le dans les réglages du navigateur, ou écrivez votre repère.</p>}
    </div>
  );
}
