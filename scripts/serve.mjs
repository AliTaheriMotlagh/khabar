// Local preview of the built site *with* the /api functions (in-memory store, nothing persists).
// Usage: npm run build && npm run serve   → http://localhost:4322
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

process.env.KHABAR_MEMORY_STORE = '1';
const ROOT = path.resolve('dist');
const PORT = Number(process.env.PORT || 4322);
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.xml': 'application/xml', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain', '.woff2': 'font/woff2', '.pf_meta': 'application/octet-stream' };
const routes = {};
for (const f of fs.readdirSync('api').filter((f) => f.endsWith('.js') && !f.startsWith('_'))) routes[f.slice(0, -3)] = await import(path.resolve('api', f));

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const api = url.pathname.match(/^\/api\/([\w-]+)\/?$/);
    if (api) {
      const handler = routes[api[1]]?.[req.method];
      if (!handler) return res.writeHead(404).end();
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      // A function that fails (an upstream timing out mid-body, say) fails that request, not the server.
      try {
        const out = await handler(new Request(url, { method: req.method, headers: { ...req.headers, 'x-forwarded-for': '127.0.0.1' }, body }));
        const data = Buffer.from(await out.arrayBuffer());
        res.writeHead(out.status, Object.fromEntries(out.headers));
        return res.end(data);
      } catch (e) {
        console.error(`${url.pathname}: ${e.message}`);
        return res.writeHead(502).end();
      }
    }
    let file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (!file.startsWith(ROOT)) return res.writeHead(403).end();
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) file = path.join(ROOT, '404.html');
    res.writeHead(file.endsWith('404.html') && !url.pathname.endsWith('404.html') ? 404 : 200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  })
  .listen(PORT, () => console.log(`site + api on http://localhost:${PORT}`));
