(() => {
  const cache = new Map();
  const inflight = new Map();
  const day = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
  let visitor;
  try { visitor = localStorage.getItem('np-reader-v1'); } catch {}
  if (!/^[0-9a-f-]{36}$/i.test(visitor || '')) {
    visitor = crypto.randomUUID();
    try { localStorage.setItem('np-reader-v1', visitor); } catch {}
  }
  const seen = new Set();
  async function record(id) {
    const key = day() + ':' + id;
    if (seen.has(key) || inflight.has(key)) return;
    try { if (localStorage.getItem('np-view:' + key)) return; } catch {}
    const pending = (async () => {
      try {
        const res = await fetch('/api/popularity', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, visitorId: visitor }) });
        if (!res.ok) throw new Error('Could not record view');
        seen.add(key);
        try { localStorage.setItem('np-view:' + key, '1'); } catch {}
        cache.clear();
      } catch (err) { console.warn('열람 기록을 저장하지 못했습니다. 다음 열람 때 다시 시도합니다.'); }
      finally { inflight.delete(key); }
    })();
    inflight.set(key, pending);
  }
  async function load(period) {
    try {
      await Promise.allSettled([...inflight.values()]);
      const res = await fetch('/api/popularity?period=' + period, { cache: 'no-store' });
      if (!res.ok) throw new Error('Could not load ranking');
      const body = await res.json();
      cache.set(period, { state: 'ready', items: body.items, at: Date.now() });
    } catch { cache.set(period, { state: 'error', at: Date.now() }); }
    if (route.view === 'top10' && (route.period || '7') === period) render(false);
  }
  function html(raw) {
    const period = ['7', '30', 'all'].includes(raw) ? raw : '7';
    let entry = cache.get(period);
    if (!entry || Date.now() - entry.at > 30000) {
      entry = { state: 'loading', at: Date.now() };
      cache.set(period, entry);
      queueMicrotask(() => load(period));
    }
    const items = (entry.items || []).map(row => ({ t: DATA.find(t => t.id === row.id && !t.archived), count: row.count })).filter(row => row.t);
    const tabs = [['7', '최근 7일'], ['30', '최근 30일'], ['all', '전체 기간']].map(([p, label]) => `<a class="${p === period ? 'active' : ''}" href="#top10/${p}">${label}</a>`).join('');
    let content;
    if (entry.state === 'loading') content = '<p role="status">인기 순위를 불러오고 있어요.</p>';
    else if (entry.state === 'error') content = '<p role="alert">인기 순위를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.</p><button type="button" data-popularity-retry>다시 시도</button>';
    else if (!items.length) content = '<p role="status">아직 열람 기록이 없어요. 생활 팁을 읽으면 순위에 반영됩니다.</p><a class="btn" href="#tips">생활 팁 둘러보기</a>';
    else content = items.map(({ t, count }, i) => `<a class="rank-item" href="#tip/${t.id}"><b class="rank-num">${i + 1}</b><div class="rank-content"><span class="badge">${cat(t.cat).name}</span><h2>${esc(t.title)}</h2><p>${esc(t.summary)}</p></div><span class="rank-count">${Number(count).toLocaleString('ko-KR')}회 열람</span></a>`).join('');
    return `<div class="page-end"><div class="page-top"><div class="eyebrow">Reading chart</div><h1>생활 팁 TOP 10</h1><p>방문자 전체의 실제 열람 기록으로 집계한 인기 생활 팁입니다.</p></div><div class="period-tabs">${tabs}</div><div class="top-notice">한국 시간 기준으로 같은 브라우저의 같은 글은 하루 1회 집계합니다. 기록이 있는 항목만 표시합니다.</div><div class="ranking-list" aria-live="polite">${content}</div></div>`;
  }
  window.npPopularity = { record, html };
  document.addEventListener('click', e => {
    if (e.target.closest('[data-popularity-retry]')) { cache.delete(route.period || '7'); render(false); }
  });
  if (route.view === 'detail' && DATA.some(t => t.id === route.id && !t.archived && String(t.core || '').trim())) record(route.id);
  if (route.view === 'top10') render(false);
})();
