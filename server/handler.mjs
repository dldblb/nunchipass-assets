export function koreanDay(now = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(now);
}
export function cutoffDay(period, now = new Date()) {
  if (period === 'all') return '1970-01-01';
  const date = new Date(koreanDay(now) + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() - Number(period) + 1);
  return date.toISOString().slice(0, 10);
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function json(body, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}
export function createHandler(database, tipIds) {
  return async function handler(req) {
    const url = new URL(req.url);
    if (!['GET', 'POST'].includes(req.method)) return json({ error: 'Method not allowed' }, 405);
    try {
      if (req.method === 'POST') {
        const origin = req.headers.get('origin');
        if (origin && origin !== url.origin) return json({ error: 'Invalid origin' }, 403);
        if (!req.headers.get('content-type')?.startsWith('application/json')) return json({ error: 'JSON required' }, 415);
        if (Number(req.headers.get('content-length') || 0) > 1024) return json({ error: 'Payload too large' }, 413);
        const text = await req.text();
        if (text.length > 1024) return json({ error: 'Payload too large' }, 413);
        let body;
        try { body = JSON.parse(text); } catch { return json({ error: 'Invalid JSON' }, 400); }
        if (!body || !tipIds.has(body.id) || !uuid.test(body.visitorId || '')) return json({ error: 'Invalid article or visitor' }, 400);
        const db = database();
        const rows = await db.sql`INSERT INTO tip_views (tip_id, visitor_id, view_day)
          VALUES (${body.id}, ${body.visitorId}, ${koreanDay()})
          ON CONFLICT (tip_id, visitor_id, view_day) DO NOTHING RETURNING tip_id`;
        return json({ ok: true, counted: rows.length > 0 });
      }
      const period = url.searchParams.get('period') || '7';
      if (!['7', '30', 'all'].includes(period)) return json({ error: 'Invalid period' }, 400);
      const db = database();
      const rows = await db.sql`SELECT tip_id AS id, COUNT(*)::int AS count FROM tip_views
        WHERE view_day >= ${cutoffDay(period)}::date GROUP BY tip_id
        ORDER BY count DESC, tip_id ASC LIMIT 10`;
      return json({ period, items: rows.filter(row => tipIds.has(row.id)), updatedAt: new Date().toISOString() });
    } catch (err) {
      console.error('Popularity storage failed:', err.message);
      return json({ error: '인기 순위를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' }, 503);
    }
  };
}
