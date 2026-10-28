// node scripts/serve-static.mjs [dir=out] [port=3701] — serves the static demo locally, the way GitHub Pages
// would: under NEXT_PUBLIC_BASE_PATH if the site was built with one. Listens on 127.0.0.1 only.
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const [dir = 'out', port = '3701'] = process.argv.slice(2);
const base = process.env.NEXT_PUBLIC_BASE_PATH || '';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.ico': 'image/x-icon', '.txt': 'text/plain', '.woff2': 'font/woff2' };

createServer((req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (base && !path.startsWith(base)) { res.writeHead(302, { location: base + '/' }); res.end(); return; }
  path = normalize(path.slice(base.length)).replace(/^(\.\.[/\\])+/, '');
  let file = join(dir, path);
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) { file = join(dir, '404.html'); res.statusCode = 404; }
  res.setHeader('content-type', TYPES[extname(file)] || 'application/octet-stream');
  createReadStream(file).pipe(res);
}).listen(+port, '127.0.0.1', () => console.log(`static demo: http://127.0.0.1:${port}${base}/`));
