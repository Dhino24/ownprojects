// Petit serveur statique pour le développement : node serve.mjs [port]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const racine = new URL('.', import.meta.url).pathname;
const port = +process.argv[2] || 8080;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ics': 'text/calendar',
};

createServer(async (req, res) => {
  let chemin = normalize(decodeURIComponent(req.url.split('?')[0]));
  if (chemin.endsWith('/')) chemin += 'index.html';
  if (chemin.includes('..')) { res.writeHead(403).end(); return; }
  try {
    const data = await readFile(join(racine, chemin));
    res.writeHead(200, {
      'content-type': TYPES[extname(chemin)] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404');
  }
}).listen(port, () => console.log(`http://localhost:${port}/`));
