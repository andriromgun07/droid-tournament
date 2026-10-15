// Server lokal untuk tes: file statis + /api/* via Netlify Function asli, DB = PGlite.
// node test/dev-server.mjs  (port 8888)
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
const root = new URL('..', import.meta.url).pathname;
const db = new PGlite();
const migDir = join(root, 'netlify/database/migrations');
for (const f of (await readdir(migDir)).sort()) await db.exec(await readFile(join(migDir, f), 'utf8'));
await new PGLiteSocketServer({ db, port: 55433, host: '127.0.0.1' }).start();
process.env.NETLIFY_DB_URL = 'postgres://postgres:postgres@127.0.0.1:55433/postgres?sslmode=disable';
process.env.NETLIFY_DB_DRIVER = 'server';
const { default: handler } = await import(join(root, 'netlify/functions/api.mjs'));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api')) {
    const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await new Promise(r => { let d = ''; req.on('data', c => d += c); req.on('end', () => r(d)); });
    const r = await handler(new Request(url, { method: req.method, body }));
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(await r.text()); return;
  }
  const file = normalize(join(root, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  try { const data = await readFile(file); res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' }); res.end(data); }
  catch { res.writeHead(404); res.end('not found'); }
}).listen(8888, () => console.log('http://localhost:8888'));
