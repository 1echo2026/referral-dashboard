'use strict';

const state = { tables: [], viewer: null, active: 'direct-unconverted', meta: null };

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}
function n(value) { return Number(value || 0).toLocaleString('zh-CN'); }

function redirectLogin() {
  location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
}

async function api(path) {
  const res = await fetch(path, { headers: { Accept: 'application/json' } });
  if (res.status === 401) { redirectLogin(); throw new Error('请先登录'); }
  if (!res.ok) {
    let message = '请求失败';
    try { message = (await res.json()).error || message; } catch { /* ignore */ }
    throw new Error(message);
  }
  return res.json();
}

function applyViewer(meta, payload) {
  state.meta = meta;
  state.viewer = payload.viewer || meta.viewer || { role: 'admin' };
  const isBase = state.viewer.role === 'base';
  $('#brandName').textContent = meta.title || '转介绍数据看板';
  $('#pageTitle').textContent = isBase ? `${state.viewer.baseName}专项明细表` : '专项明细表';
  $('#pageSubtitle').textContent = isBase
    ? '仅展示本基地的 4 类转介绍名单明细'
    : '按业务场景查看 8 个基地的 4 类转介绍名单明细';
  $('#viewerChip').textContent = isBase ? state.viewer.baseName : '管理员 · 全部基地';
  $('#adminLink').classList.toggle('hidden', isBase);
  $('#compareNav').classList.toggle('hidden', isBase);
  $('#rankingsNav')?.classList.toggle('hidden', isBase);
  const stamp = payload?.syncedAt || meta.updatedAt;
  $('#updatedAt').textContent = stamp
    ? `${payload?.syncedAt ? '飞书同步于' : '更新于'} ${new Date(stamp).toLocaleString('zh-CN', { hour12: false })}`
    : '演示数据';
}

function renderTabs() {
  const counts = {
    'direct-unconverted': 'count-direct',
    'assigned-leads': 'count-assigned',
    'high-potential': 'count-high',
    'diamond-unused': 'count-diamond'
  };
  for (const table of state.tables) {
    const el = document.getElementById(counts[table.key]);
    if (el) el.textContent = n(table.rows.length);
  }
  $$('.table-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.key === state.active);
    btn.onclick = () => {
      state.active = btn.dataset.key;
      renderTabs();
      renderTable();
    };
  });
}

function cellClass(key) {
  return ['userId', 'name', 'a', 'b', 'c', 'activityId', 'phone'].includes(key) ? 'cell-left' : '';
}

function formatValue(key, value) {
  if (key === 'baseName') return `<span class="badge badge-base">${esc(value || '—')}</span>`;
  if (value === null || value === undefined || value === '') return '<span class="empty-cell">/</span>';
  if (typeof value === 'number') return n(value);
  return esc(value);
}

function renderTable() {
  const table = state.tables.find((t) => t.key === state.active) || state.tables[0];
  if (!table) return;
  const theme = table.theme || 'green';
  const card = $('#sheetCard');
  card.className = `sheet-card`;
  $('#sheetTitlebar').className = `sheet-titlebar theme-${theme}`;
  $('#sheetTitle').textContent = `${table.index}｜${table.title}`;
  $('#sheetTag').textContent = table.tag || '';
  $('#sheetNote').className = `sheet-note theme-${theme}`;
  $('#sheetNote').textContent = table.note || '';

  const isAdmin = state.viewer?.role !== 'base';
  const cols = [
    { key: '__index', label: '序号' },
    ...(isAdmin ? [{ key: 'baseName', label: '基地' }] : []),
    ...table.columns.map(([key, label]) => ({ key, label }))
  ];

  $('#sheetHead').innerHTML = `<tr>${cols.map((c) => `<th class="theme-${theme}">${esc(c.label)}</th>`).join('')}</tr>`;
  const rows = table.rows || [];
  $('#sheetBody').innerHTML = rows.length
    ? rows.map((row, i) => `<tr>${cols.map((c) => {
      if (c.key === '__index') return `<td class="num">${i + 1}</td>`;
      const cls = [cellClass(c.key), c.key === 'amount' || c.key === 'diamonds' ? 'num' : ''].filter(Boolean).join(' ');
      return `<td class="${cls}">${formatValue(c.key, row[c.key])}</td>`;
    }).join('')}</tr>`).join('')
    : `<tr><td colspan="${cols.length}"><div class="empty-state"><h3>暂无数据</h3><p>请在后台上传或更新该类名单</p></div></td></tr>`;

  $('#sheetFoot').textContent = `共 ${n(rows.length)} 条${isAdmin ? ' · 全部基地' : ` · ${state.viewer.baseName}`} · 表格可左右滚动查看全部字段`;
}

async function init() {
  try {
    const [meta, payload] = await Promise.all([
      api('/api/meta'),
      api('/api/tables')
    ]);
    applyViewer(meta, payload);
    state.tables = payload.tables || [];
    state.active = state.tables[0]?.key || 'direct-unconverted';
    renderTabs();
    renderTable();
    setInterval(async () => {
      try {
        const payload = await api('/api/tables');
        applyViewer(state.meta, payload);
        state.tables = payload.tables || [];
        if (!state.tables.some((t) => t.key === state.active)) state.active = state.tables[0]?.key;
        renderTabs();
        renderTable();
      } catch { /* keep last data */ }
    }, 30000);
  } catch (err) {
    if (err.message === '请先登录') return;
    $('#globalError').classList.remove('hidden');
    $('#globalError').textContent = err.message || '加载失败';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const logout = $('#logoutBtn');
  if (logout) {
    logout.addEventListener('click', async () => {
      try { await fetch('/api/logout', { method: 'POST' }); } catch { /* ignore */ }
      location.href = '/login';
    });
  }
  init();
});
