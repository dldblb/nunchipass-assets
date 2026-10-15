import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { NetlifyDB } from '@netlify/database-dev';
import pg from 'pg';
import { createHandler, koreanDay, cutoffDay } from '../server/handler.mjs';

let local, pool, handler;
before(async () => {
  local = new NetlifyDB();
  const connectionString = await local.start();
  pool = new pg.Pool({ connectionString });
  await pool.query(await readFile(new URL('../netlify/database/migrations/20261015113000_create_tip_views.sql', import.meta.url), 'utf8'));
  const sql = async (parts, ...values) => {
    const text = parts.reduce((out, part, i) => out + (i ? '$' + i : '') + part, '');
    return (await pool.query(text, values)).rows;
  };
  handler = createHandler(() => ({ sql }), new Set(['content-1', 'content-2', 'content-3']));
});
after(async () => { await pool?.end(); await local?.stop(); });
const post = (id, visitorId, options = {}) => new Request('https://example.test/api/popularity', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://example.test', ...options }, body: JSON.stringify({ id, visitorId })
});
test('Korean date boundaries and 7/30 day cutoff', () => {
  assert.equal(koreanDay(new Date('2026-10-15T15:00:00Z')), '2026-10-16');
  assert.equal(cutoffDay('7', new Date('2026-10-15T10:00:00Z')), '2026-10-09');
  assert.equal(cutoffDay('30', new Date('2026-10-15T10:00:00Z')), '2026-09-16');
});
test('concurrent duplicate views count once; distinct browsers accumulate', async () => {
  const visitor = randomUUID();
  const responses = await Promise.all(Array.from({ length: 12 }, () => handler(post('content-1', visitor))));
  const bodies = await Promise.all(responses.map(r => r.json()));
  assert.equal(bodies.filter(r => r.counted).length, 1);
  const second = await handler(post('content-1', randomUUID()));
  assert.equal((await second.json()).counted, true);
  const rank = await handler(new Request('https://example.test/api/popularity?period=7'));
  assert.deepEqual((await rank.json()).items, [{ id: 'content-1', count: 2 }]);
});
test('periods filter older views and counts survive new handler instance', async () => {
  const today = koreanDay();
  const daysAgo = days => { const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - days); return d.toISOString().slice(0, 10); };
  await pool.query('INSERT INTO tip_views(tip_id,visitor_id,view_day) VALUES ($1,$2,$3),($4,$5,$6)', ['content-2', randomUUID(), daysAgo(10), 'content-3', randomUUID(), daysAgo(40)]);
  for (const [period, expected] of [['7', ['content-1']], ['30', ['content-1', 'content-2']], ['all', ['content-1', 'content-2', 'content-3']]]) {
    const res = await handler(new Request('https://example.test/api/popularity?period=' + period));
    assert.deepEqual((await res.json()).items.map(i => i.id), expected);
  }
  const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM tip_views');
  assert.equal(rows[0].count, 4);
});
test('invalid article, malformed JSON, foreign origin and invalid period are rejected', async () => {
  assert.equal((await handler(post('made-up', randomUUID()))).status, 400);
  assert.equal((await handler(post('content-1', 'bad'))).status, 400);
  assert.equal((await handler(post('content-1', randomUUID(), { Origin: 'https://other.test' }))).status, 403);
  assert.equal((await handler(new Request('https://example.test/api/popularity?period=8'))).status, 400);
  assert.equal((await handler(new Request('https://example.test/api/popularity', { method: 'DELETE' }))).status, 405);
});
test('storage outage returns a visible failure rather than fabricated rankings', async () => {
  const broken = createHandler(() => { throw new Error('offline'); }, new Set());
  assert.equal((await broken(new Request('https://example.test/api/popularity'))).status, 503);
});
test('built page preserves article data, images and the compressed game payload', async () => {
  const original = await readFile('index.html', 'utf8');
  const built = await readFile('public/index.html', 'utf8');
  for (const id of ['content-data', 'np-game-payload']) {
    const pattern = new RegExp('<script\\b[^>]*id=["\']' + id + '["\'][^>]*>([\\s\\S]*?)<\\/script>');
    const a = original.match(pattern)?.[1];
    const b = built.match(pattern)?.[1];
    assert.ok(a && b, id);
    assert.equal(createHash('sha256').update(a).digest('hex'), createHash('sha256').update(b).digest('hex'));
  }
  assert.equal(built.includes('다른 사용자 기록은 반영되지 않습니다'), false);
  assert.ok(built.includes('<script src="/popularity.js"></script>'));
});
test('client records a real read then renders shared ranking; refresh stays deduplicated', async () => {
  const storage = new Map();
  const article = { id: 'content-2', title: '실제 열람 테스트', summary: '서버 집계', cat: 'work', core: '본문' };
  let output = '';
  const sandbox = {
    Map, Set, Date, Intl, crypto: { randomUUID }, console, queueMicrotask,
    localStorage: { getItem: k => storage.get(k), setItem: (k,v) => storage.set(k,v) },
    window: {}, document: { addEventListener() {} },
    DATA: [article], cat: () => ({ name: '직장' }), esc: s => String(s),
    route: { view: 'detail', id: article.id },
    fetch: (url, opts = {}) => handler(new Request('https://example.test' + url, opts)),
    render() { output = sandbox.window.npPopularity.html(sandbox.route.period); }
  };
  vm.runInNewContext(await readFile('client/popularity.js', 'utf8'), sandbox);
  await new Promise(resolve => setTimeout(resolve, 100));
  sandbox.route = { view: 'top10', period: '7' };
  output = sandbox.window.npPopularity.html('7');
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.match(output, /실제 열람 테스트/);
  assert.match(output, /1회 열람/);
  await sandbox.window.npPopularity.record(article.id);
  const res = await handler(new Request('https://example.test/api/popularity?period=7'));
  assert.equal((await res.json()).items.find(i => i.id === article.id).count, 1);
});
