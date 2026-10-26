'use strict';

const state = {
  meta: null,
  page: 1,
  pageSize: 20,
  total: 0,
  filters: { base: 'all', source: 'all', status: 'all', q: '' },
  rows: [],
  controller: null,
  visibleColumns: ['base', 'customer', 'phone', 'source', 'owner', 'status', 'createdAt', 'lastFollowUp']
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}
function n(value) { return Number(value || 0).toLocaleString('zh-CN'); }
function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function sourceBadge(source) {
  const cls = source === '高潜老用户' ? 'badge-source-high' : 'badge-source-new';
  return `<span class="badge ${cls}">${esc(source)}</span>`;
}
function statusBadge(status) {
  return `<span class="badge badge-${esc(status)}">${esc(status)}</span>`;
}

function readUrl() {
  const p = new URLSearchParams(location.search);
  state.filters.base = p.get('base') || 'all';
  state.filters.source = p.get('source') || 'all';
  state.filters.status = p.get('status') || 'all';
  state.filters.q = p.get('q') || '';
  state.page = Math.max(1, Number(p.get('page') || 1));
}

function writeUrl() {
  const p = new URLSearchParams();
  if (state.filters.base !== 'all') p.set('base', state.filters.base);
  if (state.filters.source !== 'all') p.set('source', state.filters.source);
  if (state.filters.status !== 'all') p.set('status', state.filters.status);
  if (state.filters.q) p.set('q', state.filters.q);
  if (state.page > 1) p.set('page', String(state.page));
  const qs = p.toString();
  history.replaceState(null, '', `${location.pathname}${qs ? `?${qs}` : ''}`);
}

function queryParams(pageSize = state.pageSize, page = state.page) {
  const p = new URLSearchParams();
  if (state.viewer?.role !== 'base' && state.filters.base !== 'all') p.set('base', state.filters.base);
  if (state.filters.source !== 'all') p.set('source', state.filters.source);
  if (state.filters.status !== 'all') p.set('status', state.filters.status);
  if (state.filters.q) p.set('q', state.filters.q);
  p.set('page', String(page));
  p.set('pageSize', String(pageSize));
  return p;
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, { headers: { Accept: 'application/json' }, ...options });
  if (!res.ok) {
    let message = '请求失败';
    try { message = (await res.json()).error || message; } catch { /* ignore */ }
    if (res.status === 401) {
      location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
      throw new Error('请先登录');
    }
    throw new Error(message);
  }
  return res.json();
}

function renderRows() {
  const tbody = $('#recordsTable tbody');
  const cols = state.visibleColumns;
  const colspan = Math.max(1, cols.length);
  if (!state.rows.length) {
    tbody.innerHTML = `<tr><td colspan="${colspan}"><div class="empty-state">
      <div class="empty-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 5h16v14H4z"/><path d="M4 9h16M8 13h8M8 16h5"/></svg></div>
      <h3>没有匹配的名单</h3><p>试试调整基地、来源或搜索关键词</p>
    </div></td></tr>`;
    return;
  }
  tbody.innerHTML = state.rows.map((r, index) => {
    const cells = {
      base: `<td><span class="badge badge-base" style="--base-color:${esc(r.baseColor)}">${esc(r.baseName)}</span></td>`,
      customer: `<td class="cell-strong">${esc(r.customerName)}</td>`,
      phone: `<td class="num">${esc(r.phone || '—')}</td>`,
      source: `<td>${sourceBadge(r.sourceType)}</td>`,
      owner: `<td>${esc(r.owner || '—')}</td>`,
      status: `<td>${statusBadge(r.status)}</td>`,
      createdAt: `<td class="num">${esc(formatDate(r.createdAt))}</td>`,
      lastFollowUp: `<td class="num">${esc(formatDate(r.lastFollowUp))}</td>`
    };
    return `<tr class="row-link" data-index="${index}" tabindex="0">${cols.map((c) => cells[c] || '').join('')}</tr>`;
  }).join('');

  $$('#recordsTable tbody .row-link').forEach((tr) => {
    const open = () => openDrawer(state.rows[Number(tr.dataset.index)]);
    tr.addEventListener('click', open);
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  });
}

function renderPager() {
  const pages = Math.max(1, Math.ceil(state.total / state.pageSize));
  const current = Math.min(state.page, pages);
  const info = state.total
    ? `第 ${(current - 1) * state.pageSize + 1}–${Math.min(current * state.pageSize, state.total)} 条，共 ${n(state.total)} 条`
    : '共 0 条';
  $('#pageInfo').textContent = info;
  $('#summary').textContent = state.total ? `当前筛选共 ${n(state.total)} 条名单 · 每页 ${state.pageSize} 条` : '当前筛选暂无名单';

  const buttons = [];
  buttons.push(`<button type="button" data-page="${current - 1}" ${current <= 1 ? 'disabled' : ''} aria-label="上一页">‹</button>`);
  const pageSet = new Set([1, pages, current - 1, current, current + 1]);
  const list = [...pageSet].filter((p) => p >= 1 && p <= pages).sort((a, b) => a - b);
  let last = 0;
  for (const p of list) {
    if (p - last > 1) buttons.push('<span class="text-muted">…</span>');
    buttons.push(`<button type="button" data-page="${p}" class="${p === current ? 'active' : ''}">${p}</button>`);
    last = p;
  }
  buttons.push(`<button type="button" data-page="${current + 1}" ${current >= pages ? 'disabled' : ''} aria-label="下一页">›</button>`);
  $('#pager').innerHTML = buttons.join('');
  $$('#pager button[data-page]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const p = Number(btn.dataset.page);
      if (!p || p < 1 || p > pages || p === state.page) return;
      state.page = p;
      writeUrl();
      loadRecords();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
}

function openDrawer(row) {
  if (!row) return;
  $('#drawerTitle').textContent = row.customerName;
  $('#drawerSub').textContent = `${row.baseName} · ${row.sourceType}`;
  $('#drawerBody').innerHTML = `<dl class="detail-list">
    <dt>客户姓名</dt><dd>${esc(row.customerName)}</dd>
    <dt>手机号</dt><dd>${esc(row.phone || '—')}</dd>
    <dt>所属基地</dt><dd>${esc(row.baseName)}</dd>
    <dt>来源类型</dt><dd>${sourceBadge(row.sourceType)}</dd>
    <dt>负责人</dt><dd>${esc(row.owner || '—')}</dd>
    <dt>跟进状态</dt><dd>${statusBadge(row.status)}</dd>
    <dt>创建日期</dt><dd>${esc(formatDate(row.createdAt))}</dd>
    <dt>最近跟进</dt><dd>${esc(formatDate(row.lastFollowUp))}</dd>
    <dt>标签</dt><dd>${esc(row.tags || '—')}</dd>
  </dl>
  <div class="notice mt-16" style="margin-bottom:0">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1"/></svg>
    <div>为保护客户隐私，前台仅展示脱敏后的姓名与手机号，不展示备注信息。</div>
  </div>`;
  $('#drawer').classList.add('open');
  $('#drawerBackdrop').classList.add('open');
  $('#drawer').setAttribute('aria-hidden', 'false');
  $('#drawerClose').focus();
}

function closeDrawer() {
  $('#drawer').classList.remove('open');
  $('#drawerBackdrop').classList.remove('open');
  $('#drawer').setAttribute('aria-hidden', 'true');
}

async function loadRecords() {
  if (state.controller) state.controller.abort();
  state.controller = new AbortController();
  $('#globalError').classList.add('hidden');
  try {
    const data = await fetchJson(`/api/records?${queryParams().toString()}`, { signal: state.controller.signal });
    state.rows = data.rows;
    state.total = data.total;
    if (state.page > 1 && state.rows.length === 0 && state.total > 0) {
      state.page = Math.max(1, Math.ceil(state.total / state.pageSize));
      return loadRecords();
    }
    renderRows();
    renderPager();
  } catch (err) {
    if (err.name === 'AbortError') return;
    $('#globalError').classList.remove('hidden');
    $('#globalError').textContent = err.message || '加载失败，请稍后重试';
    $('#recordsTable tbody').innerHTML = '<tr><td colspan="8"><div class="empty-state"><h3>加载失败</h3><p>请刷新页面重试</p></div></td></tr>';
  }
}

async function exportCsv() {
  const btn = $('#exportBtn');
  btn.disabled = true;
  btn.textContent = '正在导出…';
  try {
    const data = await fetchJson(`/api/records?${queryParams(5000, 1).toString()}`);
    const rows = data.rows || [];
    if (!rows.length) {
      alert('当前筛选没有可导出的数据');
      return;
    }
    const headers = ['基地', '客户姓名', '手机号', '来源类型', '负责人', '状态', '创建日期', '最近跟进', '标签'];
    const lines = [headers.join(',')];
    for (const r of rows) {
      const values = [r.baseName, r.customerName, r.phone, r.sourceType, r.owner, r.status, r.createdAt, r.lastFollowUp, r.tags];
      lines.push(values.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','));
    }
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `转介绍明细_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert(err.message || '导出失败');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M5 21h14"/></svg> 导出当前结果`;
  }
}

function applyMeta(meta) {
  state.meta = meta;
  const viewer = meta.viewer || { role: 'admin' };
  const isBase = viewer.role === 'base';
  state.viewer = viewer;
  document.title = isBase ? `${viewer.baseName} · 明细名单` : `明细名单 · ${meta.title || '转介绍数据看板'}`;
  $('#brandName').textContent = meta.title || '转介绍数据看板';
  $('#viewerChip').textContent = isBase ? viewer.baseName : '管理员 · 全部基地';
  $('#adminLink').classList.toggle('hidden', isBase);
  $('#compareNav').classList.toggle('hidden', isBase);
  $('#rankingsNav')?.classList.toggle('hidden', isBase);
  $('#baseFilterField').classList.toggle('hidden', isBase);
  $('#updatedAt').textContent = meta.updatedAt ? `更新于 ${formatDateTime(meta.updatedAt)}` : '尚未发布数据';
  $('#versionChip').textContent = meta.version ? `${meta.version.label} · ${n(meta.version.rowCount)} 条` : '版本 —';
  $('#dataNote').textContent = meta.dataNote || '';
  if (Array.isArray(meta.visibleColumns) && meta.visibleColumns.length) {
    state.visibleColumns = meta.visibleColumns;
  }
  $$('#recordsTable th').forEach((th) => {
    th.classList.toggle('hidden', !state.visibleColumns.includes(th.dataset.col));
  });
  const baseSelect = $('#baseFilter');
  baseSelect.innerHTML = '<option value="all">全部基地</option>' + meta.bases.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join('');
  baseSelect.value = state.filters.base;
  if (isBase && meta.bases[0]) baseSelect.value = String(meta.bases[0].id);
  $('#sourceFilter').value = state.filters.source;
  $('#statusFilter').value = state.filters.status;
  $('#searchInput').value = state.filters.q;
}

function bind() {
  const reload = () => { state.page = 1; writeUrl(); loadRecords(); };
  $('#baseFilter').addEventListener('change', (e) => { state.filters.base = e.target.value; reload(); });
  $('#sourceFilter').addEventListener('change', (e) => { state.filters.source = e.target.value; reload(); });
  $('#statusFilter').addEventListener('change', (e) => { state.filters.status = e.target.value; reload(); });
  let timer;
  $('#searchInput').addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.filters.q = e.target.value.trim();
      reload();
    }, 320);
  });
  $('#resetFilters').addEventListener('click', () => {
    state.filters = { base: 'all', source: 'all', status: 'all', q: '' };
    $('#baseFilter').value = 'all';
    $('#sourceFilter').value = 'all';
    $('#statusFilter').value = 'all';
    $('#searchInput').value = '';
    reload();
  });
  $('#exportBtn').addEventListener('click', exportCsv);
  const logout = $('#logoutBtn');
  if (logout) {
    logout.addEventListener('click', async () => {
      try { await fetch('/api/logout', { method: 'POST' }); } catch { /* ignore */ }
      location.href = '/login';
    });
  }
  $('#drawerClose').addEventListener('click', closeDrawer);
  $('#drawerBackdrop').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });
}

async function init() {
  readUrl();
  bind();
  try {
    const meta = await fetchJson('/api/meta');
    applyMeta(meta);
    await loadRecords();
  } catch (err) {
    $('#globalError').classList.remove('hidden');
    $('#globalError').textContent = err.message || '初始化失败';
  }
}

document.addEventListener('DOMContentLoaded', init);
