'use strict';

const state = {
  meta: null,
  data: null,
  filters: { base: 'all', range: 'all', from: '', to: '', source: 'all' },
  view: 'overview',
  controller: null
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function n(value) {
  return Number(value || 0).toLocaleString('zh-CN');
}

function pct(value, digits = 1) {
  return `${(Number(value || 0) * 100).toFixed(digits)}%`;
}

function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localDate(d) {
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(base, days) {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

function rangeToDates(range) {
  const today = new Date();
  if (range === '30') return { from: localDate(addDays(today, -29)), to: localDate(today) };
  if (range === '90') return { from: localDate(addDays(today, -89)), to: localDate(today) };
  if (range === 'year') return { from: `${today.getFullYear()}-01-01`, to: `${today.getFullYear()}-12-31` };
  return { from: '', to: '' };
}

function readUrl() {
  const p = new URLSearchParams(location.search);
  state.filters.base = p.get('base') || 'all';
  state.filters.range = p.get('range') || 'all';
  state.filters.source = p.get('source') || 'all';
  state.filters.from = p.get('from') || '';
  state.filters.to = p.get('to') || '';
  const hash = (location.hash || '#overview').replace('#', '');
  state.view = hash === 'compare' ? 'compare' : 'overview';
}

function writeUrl() {
  const p = new URLSearchParams();
  if (state.filters.base !== 'all') p.set('base', state.filters.base);
  if (state.filters.range !== 'all') p.set('range', state.filters.range);
  if (state.filters.source !== 'all') p.set('source', state.filters.source);
  if (state.filters.range === 'custom') {
    if (state.filters.from) p.set('from', state.filters.from);
    if (state.filters.to) p.set('to', state.filters.to);
  }
  const qs = p.toString();
  const hash = `#${state.view}`;
  const next = `${location.pathname}${qs ? `?${qs}` : ''}${hash}`;
  if (next !== `${location.pathname}${location.search}${location.hash}`) history.replaceState(null, '', next);
}

async function api(path) {
  const res = await fetch(path, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    let message = '请求失败';
    try { message = (await res.json()).error || message; } catch { /* ignore */ }
    if (res.status === 401) {
      location.href = `/login?next=${encodeURIComponent(location.pathname + location.search + location.hash)}`;
      throw new Error('请先登录');
    }
    throw new Error(message);
  }
  return res.json();
}

function applyMeta(meta) {
  state.meta = meta;
  const viewer = meta.viewer || { role: 'admin' };
  const isBase = viewer.role === 'base';
  state.viewer = viewer;
  document.title = isBase ? `${viewer.baseName} · 转介绍数据看板` : (meta.title || '转介绍数据看板');
  $('#brandName').textContent = meta.title || '转介绍数据看板';
  $('#pageTitle').textContent = isBase ? `${viewer.baseName}转介绍总览` : (meta.title || '转介绍总览');
  $('#pageSubtitle').textContent = isBase ? '仅展示本基地数据 · 新用户直推未转化 + 高潜老用户' : (meta.subtitle || '');
  $('#dataNote').textContent = meta.dataNote || '';
  $('#updatedAt').textContent = meta.updatedAt ? `更新于 ${formatDate(meta.updatedAt)}` : '尚未发布数据';
  $('#compareUpdated').textContent = meta.updatedAt ? `更新于 ${formatDate(meta.updatedAt)}` : '尚未发布数据';
  $('#versionChip').textContent = meta.version ? `${meta.version.label} · ${n(meta.version.rowCount)} 条` : '版本 —';
  $('#viewerChip').textContent = isBase ? `${viewer.baseName}` : '管理员 · 全部基地';
  $('#adminLink').classList.toggle('hidden', isBase);
  $('#compareNav').classList.toggle('hidden', isBase);
  $('#rankingsNav')?.classList.toggle('hidden', isBase);
  $('#baseFilterField').classList.toggle('hidden', isBase);
  if (isBase && state.view === 'compare') state.view = 'overview';

  const select = $('#baseFilter');
  select.innerHTML = '<option value="all">全部基地</option>' + meta.bases.map((b) =>
    `<option value="${b.id}">${esc(b.name)}</option>`
  ).join('');

  if (meta.announcement) {
    $('#announcement').classList.remove('hidden');
    $('#announcement').innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 9v4m0 4h.01M10.3 3.9 2.5 17a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg><div>${esc(meta.announcement)}</div>`;
  }

  select.value = isBase && meta.bases[0] ? String(meta.bases[0].id) : state.filters.base;
  $('#sourceFilter').value = state.filters.source;
  $('#rangeFilter').value = state.filters.range;
  if (state.filters.range === 'custom') {
    $('#fromField').classList.remove('hidden');
    $('#toField').classList.remove('hidden');
    $('#fromFilter').value = state.filters.from;
    $('#toFilter').value = state.filters.to;
  }
}

function kpiCard(key, label, value, foot, tone, icon) {
  return `<div class="kpi-card" data-tone="${tone}">
    <div class="kpi-label">${esc(label)}</div>
    <div class="kpi-value">${value}</div>
    <div class="kpi-foot">${foot}</div>
    <div class="kpi-icon" aria-hidden="true">${icon}</div>
  </div>`;
}

function renderKpis(data) {
  const k = data.kpis;
  const visible = state.meta?.kpiVisibility?.length ? state.meta.kpiVisibility : ['total', 'newUnconverted', 'highPotential', 'conversionRate', 'followUpRate'];
  const cards = {
    total: () => kpiCard('total', '名单总量', `${n(k.total)}<span class="unit">条</span>`, `覆盖 ${data.bases.length} 个基地 · ${n(data.owners.length)}+ 位负责人`, 'blue',
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M4 19V9m5 10V5m5 14v-7m5 7V8"/></svg>'),
    newUnconverted: () => kpiCard('newUnconverted', '新用户直推未转化', `${n(k.newUnconverted)}<span class="unit">人</span>`, `占名单总量 ${pct(k.total ? k.newUnconverted / k.total : 0)}`, 'cyan',
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M17 11h6m-3-3v6"/></svg>'),
    highPotential: () => kpiCard('highPotential', '高潜老用户', `${n(k.highPotential)}<span class="unit">人</span>`, `占名单总量 ${pct(k.total ? k.highPotential / k.total : 0)}`, 'violet',
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1L12 16.9 6.6 19.8l1-6.1-4.4-4.3 6.1-.9L12 3Z"/></svg>'),
    conversionRate: () => kpiCard('conversionRate', '转化率', `${pct(k.conversionRate)}`, `已转化 ${n(k.converted)} 人`, 'green',
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m3 17 6-6 4 4 8-8"/><path d="M14 7h7v7"/></svg>'),
    followUpRate: () => kpiCard('followUpRate', '跟进覆盖率', `${pct(k.followUpRate)}`, `已跟进 ${n(k.followed)} 人`, 'amber',
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4m8-4v4M3 10h18"/><rect x="3" y="4" width="18" height="18" rx="2"/><path d="m9 16 2 2 4-4"/></svg>')
  };
  const html = visible.map((key) => (cards[key] ? cards[key]() : '')).join('');
  const grid = $('#kpiGrid');
  grid.style.setProperty('--kpi-cols', String(Math.max(1, visible.length)));
  grid.innerHTML = html || '<div class="empty-state">暂无可展示的指标</div>';
}

function niceMax(value) {
  if (value <= 5) return 5;
  const pow = Math.pow(10, Math.floor(Math.log10(value)));
  const base = value / pow;
  const nice = base <= 1 ? 1 : base <= 2 ? 2 : base <= 5 ? 5 : 10;
  return nice * pow;
}

function renderTrend(trend) {
  const wrap = $('#trendChart');
  if (!trend.length) {
    wrap.innerHTML = '<div class="chart-empty">当前筛选范围暂无数据</div>';
    $('#trendTotal').textContent = '—';
    return;
  }
  const W = 760, H = 260, ml = 38, mr = 16, mt = 16, mb = 34;
  const iw = W - ml - mr, ih = H - mt - mb;
  const max = niceMax(Math.max(...trend.map((d) => Math.max(d.total, d.converted)), 1));
  const x = (i) => ml + (trend.length === 1 ? iw / 2 : (i / (trend.length - 1)) * iw);
  const y = (v) => mt + ih - (v / max) * ih;

  const grid = [];
  for (let i = 0; i <= 4; i++) {
    const gy = mt + (ih / 4) * i;
    const value = Math.round(max - (max / 4) * i);
    grid.push(`<line x1="${ml}" y1="${gy}" x2="${W - mr}" y2="${gy}" stroke="#eef2f7" stroke-width="1"/>`);
    grid.push(`<text x="${ml - 8}" y="${gy + 4}" text-anchor="end" font-size="10" fill="#94a3b8">${value}</text>`);
  }

  const totalPts = trend.map((d, i) => `${x(i)},${y(d.total)}`).join(' ');
  const convPts = trend.map((d, i) => `${x(i)},${y(d.converted)}`).join(' ');
  const area = `M ${x(0)} ${mt + ih} L ${trend.map((d, i) => `${x(i)} ${y(d.total)}`).join(' L ')} L ${x(trend.length - 1)} ${mt + ih} Z`;

  const xLabels = trend.map((d, i) => {
    const label = d.month.slice(5) + '月';
    return `<text x="${x(i)}" y="${H - 12}" text-anchor="middle" font-size="10" fill="#94a3b8">${label}</text>`;
  }).join('');

  const points = trend.map((d, i) => `
    <g class="trend-point" data-month="${d.month}" data-total="${d.total}" data-converted="${d.converted}" data-x="${x(i)}" data-y="${y(d.total)}">
      <circle cx="${x(i)}" cy="${y(d.total)}" r="9" fill="transparent"/>
      <circle cx="${x(i)}" cy="${y(d.total)}" r="3.2" fill="#fff" stroke="#3b82f6" stroke-width="2"/>
    </g>
  `).join('');

  wrap.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="名单趋势">
      <defs>
        <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#3b82f6" stop-opacity=".16"/>
          <stop offset="100%" stop-color="#3b82f6" stop-opacity="0"/>
        </linearGradient>
      </defs>
      ${grid.join('')}
      <path d="${area}" fill="url(#trendFill)"/>
      <polyline points="${totalPts}" fill="none" stroke="#3b82f6" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>
      <polyline points="${convPts}" fill="none" stroke="#10b981" stroke-width="1.8" stroke-dasharray="4 4" stroke-linejoin="round"/>
      ${xLabels}
      ${points}
    </svg>
    <div class="chart-tooltip" id="trendTip"></div>
    <div class="chart-legend">
      <span class="legend-item"><span class="legend-dot" style="background:#3b82f6"></span>名单总量</span>
      <span class="legend-item"><span class="legend-dot" style="background:#10b981"></span>已转化</span>
    </div>
  `;
  $('#trendTotal').textContent = `共 ${n(trend.reduce((s, d) => s + d.total, 0))} 条`;

  const tip = $('#trendTip');
  $$('.trend-point', wrap).forEach((g) => {
    g.addEventListener('mouseenter', () => {
      const rect = wrap.getBoundingClientRect();
      const vb = wrap.querySelector('svg').viewBox.baseVal;
      const px = (Number(g.dataset.x) / vb.width) * rect.width;
      const py = (Number(g.dataset.y) / vb.height) * rect.height;
      tip.innerHTML = `<b>${esc(g.dataset.month)}</b><br>名单 ${n(g.dataset.total)} · 已转化 ${n(g.dataset.converted)}`;
      tip.style.left = `${px}px`;
      tip.style.top = `${py}px`;
      tip.classList.add('show');
    });
    g.addEventListener('mouseleave', () => tip.classList.remove('show'));
  });
}

function renderSources(sources) {
  const wrap = $('#sourceChart');
  if (!sources.length) {
    wrap.innerHTML = '<div class="chart-empty">暂无来源数据</div>';
    return;
  }
  const total = sources.reduce((s, d) => s + Number(d.value), 0);
  const colors = ['#3b82f6', '#8b5cf6', '#06b6d4', '#f59e0b'];
  const R = 62, C = 2 * Math.PI * R;
  let offset = 0;
  const circles = sources.map((d, i) => {
    const frac = total ? Number(d.value) / total : 0;
    const dash = `${frac * C} ${C - frac * C}`;
    const el = `<circle cx="85" cy="85" r="${R}" fill="none" stroke="${colors[i % colors.length]}" stroke-width="18" stroke-dasharray="${dash}" stroke-dashoffset="${-offset}" transform="rotate(-90 85 85)"/>`;
    offset += frac * C;
    return el;
  }).join('');
  const legend = sources.map((d, i) => {
    const frac = total ? Number(d.value) / total : 0;
    return `<div class="donut-row">
      <span class="legend-dot" style="background:${colors[i % colors.length]}"></span>
      <span class="name">${esc(d.name)}</span>
      <span class="val">${n(d.value)}</span>
      <span class="pct">${pct(frac)}</span>
    </div>`;
  }).join('');
  wrap.innerHTML = `<div class="donut-layout">
    <svg class="donut-svg" viewBox="0 0 170 170" role="img" aria-label="来源结构">
      <circle cx="85" cy="85" r="${R}" fill="none" stroke="#f1f5f9" stroke-width="18"/>
      ${circles}
      <text x="85" y="80" text-anchor="middle" class="donut-center">名单总量</text>
      <text x="85" y="106" text-anchor="middle" class="donut-center-value">${n(total)}</text>
    </svg>
    <div class="donut-legend">${legend}</div>
  </div>`;
}

function renderBaseBars(basesData) {
  const wrap = $('#baseChart');
  if (!basesData.length) {
    wrap.innerHTML = '<div class="chart-empty">暂无基地数据</div>';
    return;
  }
  const max = Math.max(...basesData.map((b) => b.total), 1);
  wrap.innerHTML = `<div class="bar-list">${basesData.map((b) => `
    <div class="bar-row">
      <span class="bar-name" title="${esc(b.name)}">${esc(b.name)}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${(b.total / max) * 100}%;background:${esc(b.color || '#3b82f6')}"></span></span>
      <span class="bar-val">${n(b.total)}</span>
    </div>`).join('')}</div>`;
}

function renderOwnerBars(owners) {
  const wrap = $('#ownerChart');
  if (!owners.length) {
    wrap.innerHTML = '<div class="chart-empty">暂无负责人数据</div>';
    return;
  }
  const max = Math.max(...owners.map((o) => o.total), 1);
  wrap.innerHTML = `<div class="bar-list">${owners.map((o) => {
    const opacity = 0.35 + Math.min(0.65, Number(o.conversionRate || 0) * 1.8);
    return `<div class="bar-row" title="${esc(o.baseName)} · 转化率 ${pct(o.conversionRate)}">
      <span class="bar-name">${esc(o.owner)}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${(o.total / max) * 100}%;background:rgba(59,130,246,${opacity.toFixed(2)})"></span></span>
      <span class="bar-val">${n(o.total)}</span>
    </div>`;
  }).join('')}</div>`;
}

function renderDrilldown(basesData, ownerBreakdown = []) {
  const wrap = $('#drilldown');
  if (!basesData.length) {
    wrap.innerHTML = '<div class="chart-empty">暂无基地数据</div>';
    return;
  }
  const grouped = new Map();
  for (const row of ownerBreakdown) {
    if (!grouped.has(row.baseId)) grouped.set(row.baseId, []);
    grouped.get(row.baseId).push(row);
  }
  wrap.innerHTML = basesData.map((b, index) => {
    const owners = grouped.get(b.id) || [];
    const max = Math.max(...owners.map((o) => o.total), 1);
    const rows = owners.length ? owners.map((o) => `
      <div class="owner-row">
        <span class="chevron" style="visibility:hidden"></span>
        <span class="owner-name">${esc(o.owner)}</span>
        <span class="owner-bar"><span style="width:${(o.total / max) * 100}%;background:${esc(b.color)}"></span></span>
        <span class="owner-count">${n(o.total)}</span>
      </div>`).join('') : '<div class="owner-row"><span></span><span class="owner-name">暂无负责人信息</span><span></span><span></span></div>';
    return `<div class="drill-base ${index === 0 ? 'open' : ''}">
      <button class="drill-toggle" type="button" aria-expanded="${index === 0}">
        <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
        <span class="drill-name">${esc(b.name)}</span>
        <span class="badge badge-base" style="--base-color:${esc(b.color)}">${n(b.ownerCount)} 位负责人</span>
        <span class="drill-total">${n(b.total)} 条</span>
      </button>
      <div class="drill-body">${rows}</div>
    </div>`;
  }).join('');
  $('#drillSummary').textContent = `${basesData.length} 个基地 · ${n(basesData.reduce((s, b) => s + b.total, 0))} 条名单`;
  $$('.drill-toggle', wrap).forEach((btn) => {
    btn.addEventListener('click', () => {
      const parent = btn.closest('.drill-base');
      const open = parent.classList.toggle('open');
      btn.setAttribute('aria-expanded', String(open));
    });
  });
}

function renderCompare(basesData) {
  const grid = $('#baseGrid');
  if (!basesData.length) {
    grid.innerHTML = '<div class="empty-state"><h3>暂无基地数据</h3><p>请调整筛选条件或稍后再试</p></div>';
  } else {
    grid.innerHTML = basesData.map((b) => `
      <div class="base-card" style="--base-color:${esc(b.color)}">
        <div class="base-card-head">
          <div class="base-name"><span class="base-dot"></span>${esc(b.name)}</div>
          <span class="badge badge-base" style="--base-color:${esc(b.color)}">${n(b.ownerCount)} 人</span>
        </div>
        <div class="base-total">${n(b.total)}</div>
        <div class="base-caption">名单总量 · 已转化 ${n(b.converted)} 人</div>
        <div class="progress-line"><span style="width:${Math.min(100, Number(b.conversionRate) * 100)}%"></span></div>
        <div class="base-metrics">
          <span>新用户直推<br><b>${n(b.newUnconverted)}</b></span>
          <span>高潜老用户<br><b>${n(b.highPotential)}</b></span>
          <span>转化率<br><b>${pct(b.conversionRate)}</b></span>
          <span>负责人<br><b>${n(b.ownerCount)}</b></span>
        </div>
      </div>`).join('');
  }
  const tbody = $('#compareTable tbody');
  tbody.innerHTML = basesData.map((b) => `
    <tr>
      <td><span class="badge badge-base" style="--base-color:${esc(b.color)}">${esc(b.name)}</span></td>
      <td class="num cell-strong">${n(b.total)}</td>
      <td class="num">${n(b.newUnconverted)}</td>
      <td class="num">${n(b.highPotential)}</td>
      <td class="num">${n(b.converted)}</td>
      <td class="num">${pct(b.conversionRate)}</td>
      <td class="num">${n(b.ownerCount)}</td>
    </tr>`).join('') || '<tr><td colspan="7"><div class="empty-state"><p>暂无数据</p></div></td></tr>';
}

function renderAll(data) {
  state.data = data;
  renderKpis(data);
  renderTrend(data.trend);
  renderSources(data.sources);
  renderBaseBars(data.bases);
  renderOwnerBars(data.owners);
  renderDrilldown(data.bases, data.ownerBreakdown || []);
  renderCompare(data.bases);
}

async function loadData() {
  if (state.controller) state.controller.abort();
  state.controller = new AbortController();
  $('#globalError').classList.add('hidden');
  try {
    const p = new URLSearchParams();
    if (state.viewer?.role !== 'base' && state.filters.base !== 'all') p.set('base', state.filters.base);
    if (state.filters.source !== 'all') p.set('source', state.filters.source);
    let from = state.filters.from;
    let to = state.filters.to;
    if (state.filters.range !== 'custom' && state.filters.range !== 'all') {
      const r = rangeToDates(state.filters.range);
      from = r.from;
      to = r.to;
    }
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    const res = await fetch(`/api/overview?${p.toString()}`, { signal: state.controller.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('数据加载失败');
    const data = await res.json();
    renderAll(data);
  } catch (err) {
    if (err.name === 'AbortError') return;
    $('#globalError').classList.remove('hidden');
    $('#globalError').textContent = err.message || '数据加载失败，请稍后重试';
  }
}

function syncView() {
  if (state.viewer?.role === 'base') state.view = 'overview';
  const overview = $('#view-overview');
  const compare = $('#view-compare');
  const isCompare = state.view === 'compare';
  overview.classList.toggle('hidden', isCompare);
  compare.classList.toggle('hidden', !isCompare);
  $$('.nav-link[data-view]').forEach((a) => a.classList.toggle('active', a.dataset.view === state.view));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function bindEvents() {
  $('#baseFilter').addEventListener('change', (e) => {
    state.filters.base = e.target.value;
    writeUrl();
    loadData();
  });
  $('#sourceFilter').addEventListener('change', (e) => {
    state.filters.source = e.target.value;
    writeUrl();
    loadData();
  });
  $('#rangeFilter').addEventListener('change', (e) => {
    state.filters.range = e.target.value;
    const custom = e.target.value === 'custom';
    $('#fromField').classList.toggle('hidden', !custom);
    $('#toField').classList.toggle('hidden', !custom);
    if (!custom) {
      state.filters.from = '';
      state.filters.to = '';
    }
    writeUrl();
    loadData();
  });
  $('#fromFilter').addEventListener('change', (e) => {
    state.filters.from = e.target.value;
    writeUrl();
    loadData();
  });
  $('#toFilter').addEventListener('change', (e) => {
    state.filters.to = e.target.value;
    writeUrl();
    loadData();
  });
  $('#resetFilters').addEventListener('click', () => {
    state.filters = { base: 'all', range: 'all', from: '', to: '', source: 'all' };
    $('#baseFilter').value = 'all';
    $('#rangeFilter').value = 'all';
    $('#sourceFilter').value = 'all';
    $('#fromField').classList.add('hidden');
    $('#toField').classList.add('hidden');
    writeUrl();
    loadData();
  });
  const logout = $('#logoutBtn');
  if (logout) {
    logout.addEventListener('click', async () => {
      try { await fetch('/api/logout', { method: 'POST' }); } catch { /* ignore */ }
      location.href = '/login';
    });
  }
  $$('.nav-link[data-view]').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      state.view = a.dataset.view;
      writeUrl();
      syncView();
    });
  });
  window.addEventListener('hashchange', () => {
    readUrl();
    syncView();
  });
}

async function init() {
  readUrl();
  bindEvents();
  syncView();
  try {
    const meta = await api('/api/meta');
    applyMeta(meta);
    await loadData();
  } catch (err) {
    $('#globalError').classList.remove('hidden');
    $('#globalError').textContent = err.message || '初始化失败';
    $('#updatedAt').textContent = '数据加载失败';
  }
}

document.addEventListener('DOMContentLoaded', init);
