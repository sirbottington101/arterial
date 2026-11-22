// Minimal static server: node tools/serve.mjs [port]
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '../..');
const port = Number(process.argv[2]) || 8080;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
http.createServer(async (req, res) => {
  let p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  if (p === '' || p.endsWith('/')) p += 'index.html';
  if (p.startsWith('..')) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(join(root, p));
    res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream', 'cache-control': 'no-cache' }).end(body);
  } catch { res.writeHead(404).end('not found'); }
}).listen(port, '0.0.0.0', () => console.log(`Arterial on http://localhost:${port}`));
