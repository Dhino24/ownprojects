// Jeu d'icônes repris de la maquette (traits simples, sans dépendance).
const paths: Record<string, string> = {
  home: 'M3 10 12 3l9 7v10h-6v-6H9v6H3z',
  box: 'm3 7 9-4 9 4v10l-9 4-9-4z M3 7l9 4 9-4 M12 11v10 M7 5l10 4',
  plus: 'M12 5v14 M5 12h14',
  arrow: 'M5 12h14 M13 6l6 6-6 6',
  pin: 'M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0z M12 8v4 M10 10h4',
  clock: 'M12 8v5l3 2 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  wallet: 'M3 5h16v15H3z M3 5V3h13 M15 10h6v5h-6z',
  chat: 'M21 11a9 9 0 0 1-9 9H3l2-4a9 9 0 1 1 16-5z M8 10h8 M8 14h5',
  bell: 'M6 9a6 6 0 0 1 12 0v6l2 3H4l2-3z M10 21h4',
  check: 'm5 12 4 4L19 6',
  user: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M4 21v-2a8 8 0 0 1 16 0v2',
  phone: 'M8 3H4c-2 9 8 19 17 17v-4l-5-2-2 2-6-6 2-2z',
  back: 'm14 5-7 7 7 7 M7 12h14',
  location: 'm3 10 18-7-7 18-3-8z',
  camera: 'M3 7h5l2-3h4l2 3h5v14H3z M16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  mic: 'M9 4a3 3 0 0 1 6 0v8a3 3 0 0 1-6 0z M6 10v2a6 6 0 0 0 12 0v-2 M12 18v4 M9 22h6',
  settings: 'M4 6h16 M4 12h16 M4 18h16 M8 3v6 M16 9v6 M8 15v6',
  grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  alert: 'M12 3 2 21h20z M12 10v5 M12 18v.5',
  logout: 'M15 4h4v16h-4 M10 8l-4 4 4 4 M6 12h10',
  download: 'M12 4v11 M7 10l5 5 5-5 M4 20h16',
  x: 'M6 6l12 12 M18 6 6 18',
  bike: 'M5 17a3 3 0 1 0 0-.01 M19 17a3 3 0 1 0 0-.01 M5 17l4-7h6l4 7 M9 10 7 6H4 M15 10l-2-4h3',
  refresh: 'M20 11a8 8 0 1 0-2 6 M20 5v6h-6',
  list: 'M8 6h13 M8 12h13 M8 18h13 M3 6h.5 M3 12h.5 M3 18h.5',
};

export function Icon({ name, size }: { name: string; size?: number }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" style={size ? { width: size, height: size } : undefined}>
      <path d={paths[name] ?? paths.box} />
    </svg>
  );
}
