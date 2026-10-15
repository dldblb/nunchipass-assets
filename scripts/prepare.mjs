import { readFile, writeFile, mkdir, cp } from 'node:fs/promises';
let html = await readFile('index.html', 'utf8');
const content = html.match(/<script\b[^>]*id=["']content-data["'][^>]*>([\s\S]*?)<\/script>/);
if (!content) throw new Error('Original content data not found');
const data = JSON.parse(content[1]);
const ids = data.filter(t => !t.archived && String(t.core || '').trim()).map(t => t.id);
await mkdir('server', { recursive: true });
await writeFile('server/tip-ids.mjs', 'export const tipIds = ' + JSON.stringify(ids) + ';\n');
const recordStart = html.indexOf('function recordView(id)');
const topEnd = html.indexOf('\nconst SEASONS=', recordStart);
if (recordStart < 0 || topEnd < 0) throw new Error('Ranking section not found');
html = html.slice(0, recordStart) + `function recordView(id){window.npPopularity?.record(id)}
function topPage(){return window.npPopularity?.html(route.period)||'<div class="page-end"><h1>생활 팁 TOP 10</h1><p role="status">인기 순위를 불러오고 있어요.</p></div>'}
` + html.slice(topEnd);
const end = html.lastIndexOf('</body>');
if (end < 0) throw new Error('HTML body not found');
html = html.slice(0, end) + '<script src="/popularity.js"></script>\n' + html.slice(end);
await mkdir('public', { recursive: true });
await writeFile('public/index.html', html);
await cp('images', 'public/images', { recursive: true });
await cp('client/popularity.js', 'public/popularity.js');
console.log('Prepared original content and live popularity for', ids.length, 'articles');
