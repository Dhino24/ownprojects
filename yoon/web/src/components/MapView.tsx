import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Carte réelle : Leaflet + tuiles OpenStreetMap (configurables via VITE_MAP_TILE_URL).
const TILE = import.meta.env.VITE_MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTR = import.meta.env.VITE_MAP_ATTRIBUTION || '© OpenStreetMap';
const DAKAR: [number, number] = [14.7167, -17.4677];

export type Marker = { lat: number; lng: number; kind: 'customer' | 'courier' | 'pickup'; label: string; stale?: boolean };

export function MapView({ markers = [], onPick, pick, height, badge, note }: {
  markers?: Marker[]; onPick?: (p: { lat: number; lng: number }) => void; pick?: { lat: number; lng: number } | null;
  height?: number; badge?: React.ReactNode; note?: React.ReactNode;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const [tilesFailed, setTilesFailed] = useState(false);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: true, attributionControl: true, zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false }).setView(DAKAR, 12);
    const tiles = L.tileLayer(TILE, { attribution: ATTR, maxZoom: 19 });
    let errors = 0;
    tiles.on('tileerror', () => { if (++errors > 4) setTilesFailed(true); });
    tiles.on('tileload', () => setTilesFailed(false));
    tiles.addTo(m);
    layer.current = L.layerGroup().addTo(m);
    m.on('click', (e: L.LeafletMouseEvent) => pickRef.current?.({ lat: e.latlng.lat, lng: e.latlng.lng }));
    map.current = m;
    return () => { m.remove(); map.current = null; };
  }, []);

  const all = [...markers, ...(pick ? [{ ...pick, kind: 'customer' as const, label: 'Votre repère' }] : [])];
  const key = JSON.stringify(all);
  useEffect(() => {
    const m = map.current, g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    for (const mk of all) {
      const cls = mk.kind === 'courier' ? `pin lime ${mk.stale ? 'stale' : ''}` : mk.kind === 'pickup' ? 'pin' : 'pin';
      const icon = L.divIcon({ className: '', html: `<div class="${cls}" style="${mk.kind === 'pickup' ? 'background:#fff;border-color:#234e42' : ''}"></div>`, iconSize: [22, 22], iconAnchor: [11, 11] });
      L.marker([mk.lat, mk.lng], { icon, title: mk.label, keyboard: false }).bindTooltip(mk.label).addTo(g);
    }
    if (all.length === 1) m.setView([all[0].lat, all[0].lng], Math.max(m.getZoom(), 15), { animate: false });
    else if (all.length > 1) m.fitBounds(L.latLngBounds(all.map((x) => [x.lat, x.lng] as [number, number])).pad(0.3), { maxZoom: 16, animate: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <div className="map" style={height ? { height } : undefined}>
      <div ref={el} style={{ height: '100%' }} role="application" aria-label={onPick ? 'Carte : touchez pour placer votre repère' : 'Carte de la livraison'} />
      {badge && <span className="mapbadge">{badge}</span>}
      {tilesFailed && <div className="mapnote">Carte indisponible (réseau). Les repères écrits restent valables.</div>}
      {!tilesFailed && note && <div className="mapnote">{note}</div>}
    </div>
  );
}
