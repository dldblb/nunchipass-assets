import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { NetlifyDB } from '@netlify/database-dev';
import { createHandler } from '../server/handler.mjs';
import { tipIds } from '../server/tip-ids.mjs';

await mkdir('.local-data', { recursive: true });
const database = new NetlifyDB({ directory: path.resolve('.local-data') });
const connectionString = await database.start();
await database.applyMigrations('./netlify/database/migrations');
const pool = new pg.Pool({ connectionString });
const sql = async (parts, ...values) => (await pool.query(parts.reduce((s, part, i) => s + (i ? '$' + i : '') + part, ''), values)).rows;
const handler = createHandler(() => ({ sql }), new Set(tipIds));
const port = Number(process.env.PORT || 4173);
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost:' + port);
    if (url.pathname === '/api/popularity') {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 1024) { res.writeHead(413).end(); return; }
        chunks.push(chunk);
      }
      const response = await handler(new Request(url, { method: req.method, headers: req.headers, ...(['GET', 'HEAD'].includes(req.method) ? {} : { body: Buffer.concat(chunks) }) }));
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
    const filename = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).slice(1);
    if (!/^(index\.html|popularity\.js|images\/asset_\d{3}\.(png|webp|svg))$/.test(filename)) { res.writeHead(404).end(); return; }
    const data = await readFile(path.join('public', filename));
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
    res.writeHead(200, { 'Content-Type': types[path.extname(filename)], 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch (err) { console.error(err.message); res.writeHead(500).end('Server error'); }
});
server.listen(port, '127.0.0.1', () => console.log('눈치패스 간이 서버: http://localhost:' + port));
async function shutdown() { server.close(); await pool.end(); await database.stop(); process.exit(0); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
