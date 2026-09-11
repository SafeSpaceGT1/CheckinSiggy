import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';

const root = resolve('dist/siggy/browser');
const port = Number(process.env.PORT || 4173);
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json', '.svg':'image/svg+xml', '.ico':'image/x-icon', '.woff2':'font/woff2', '.png':'image/png' };
if (!existsSync(resolve(root, 'index.html'))) throw new Error('Run npm run build before previewing.');
createServer((request, response) => {
  if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return; }
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
  catch { response.writeHead(400); response.end(); return; }
  let file = resolve(root, '.' + pathname);
  if (!file.startsWith(root + sep) && file !== root) { response.writeHead(403); response.end(); return; }
  if (!existsSync(file) || !statSync(file).isFile()) {
    if (extname(pathname)) { response.writeHead(404); response.end(); return; }
    file = resolve(root, 'index.html');
  }
  response.writeHead(200, { 'Content-Type':mime[extname(file)] || 'application/octet-stream', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' });
  if (request.method === 'HEAD') response.end();
  else createReadStream(file).on('error', () => response.destroy()).pipe(response);
}).listen(port, '127.0.0.1', () => console.info(`SIGGY preview: http://127.0.0.1:${port}`));
