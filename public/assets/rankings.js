'use strict';

const state = { boards: [], active: 'consultant', viewer: null };

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}
function n(value) { return Number(value || 0).toLocaleString('zh-CN'); }

async function api(path) {
  const res = await fetch(path, { headers: { Accept: 'application/json' } });
  if (res.status === 401) {
    location.href = `/login?next=${encodeURIComponent(location.pathname)}`;
    throw new Error('请先登录');
  }
  if (!res.ok) {
    let message = '请求失败';
    try { message = (await res.json()).error || message; } catch { /* ignore */ }
    throw new Error(message);
  }
  return res.json();
}

function board() {
  return state.boards.find((b) => b.key === state.active) || state.boards[0];
}

function cell(key, value, row) {
  if (key === 'rank') return `<td class="num">${value}</td>`;
  if (key === 'base') return `<td><span class="badge badge-base">${esc(value)}</span></td>`;
  if (key === 'name') return `<td class="cell-left rank-name">${esc(value)}</td>`;
  if (key === 'performance' || key === 'target') return `<td class="num">${n(value)}</td>`;
  if (key === 'rate') {
    const rate = Number(value || 0);
    return `<td><span class="rank-bar"><span class="rank-bar-track"><span class="rank-bar-fill" style="width:${Math.min(100, rate)}%"></span></span><span class="rank-bar-val">${rate}%</span></span></td>`;
  }
  if (key === 'rankLabel') return `<td>${value ? `<span class="rank-label">${esc(value)}</span>` : ''}</td>`;
  return `<td>${esc(value ?? '')}</td>`;
}

function renderSummary() {
  const b = board();
  const top = b.rows[0];
  const best = Math.max(...b.rows.map((r) => Number(r.performance || 0)));
  const avgRate = b.rows.some((r) => typeof r.rate === 'number')
    ? Math.round(b.rows.reduce((s, r) => s + Number(r.rate || 0), 0) / b.rows.length)
    : 0;
  const avgPerf = Math.round(b.rows.reduce((s, r) => s + Number(r.performance || 0), 0) / b.rows.length);
  const thirdLabel = b.key === 'consultant' ? '平均业绩' : '平均完成度';
  const thirdValue = b.key === 'consultant' ? n(avgPerf) : `${avgRate}%`;
  $('#rankSummary').innerHTML = `
    <div class="rank-stat"><div class="rank-stat-label">上榜人数</div><div class="rank-stat-value">${n(b.rows.length)}</div><div class="rank-stat-foot">${esc(b.title)}</div></div>
    <div class="rank-stat"><div class="rank-stat-label">当前榜首</div><div class="rank-stat-value" style="font-size:21px">${esc(top.name)}</div><div class="rank-stat-foot">${esc(top.base)} · ${n(top.performance)} 业绩</div></div>
    <div class="rank-stat"><div class="rank-stat-label">${thirdLabel}</div><div class="rank-stat-value">${thirdValue}</div><div class="rank-stat-foot">最高业绩 ${n(best)}</div></div>`;
}

function renderTable() {
  const b = board();
  if (!b) return;
  $('#rankTitle').textContent = b.title;
  $('#rankSub').textContent = b.subtitle || '数据截止 9.30';
  $('#rankNote').textContent = b.note || '';
  $('#rankHead').innerHTML = `<tr>${b.columns.map(([, label]) => `<th>${esc(label)}</th>`).join('')}</tr>`;
  $('#rankBody').innerHTML = b.rows.length
    ? b.rows.map((row) => `<tr class="${row.rank <= 3 ? `top-${row.rank}` : ''}">${b.columns.map(([key]) => cell(key, row[key], row)).join('')}</tr>`).join('')
    : `<tr><td colspan="${b.columns.length}"><div class="rank-empty">暂无排行数据</div></td></tr>`;
  $('#rankFoot').textContent = `共 ${n(b.rows.length)} 人 · ${b.subtitle || ''} · 数据仅供内部参考`;
  $$('.table-tab').forEach((btn) => btn.classList.toggle('active', btn.dataset.key === b.key));
}

function tsv() {
  const b = board();
  const lines = [b.columns.map(([, label]) => label).join('\t')];
  for (const row of b.rows) lines.push(b.columns.map(([key]) => String(row[key] ?? '')).join('\t'));
  return lines.join('\n');
}

function csv() {
  const b = board();
  const lines = [b.columns.map(([, label]) => `"${label}"`).join(',')];
  for (const row of b.rows) {
    lines.push(b.columns.map(([key]) => `"${String(row[key] ?? '').replace(/"/g, '""')}"`).join(','));
  }
  return '\uFEFF' + lines.join('\r\n');
}

async function copyTable() {
  try {
    await navigator.clipboard.writeText(tsv());
    toast('表格已复制，可直接粘贴到 Excel');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = tsv();
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast('表格已复制');
  }
}

function toast(message) {
  let el = document.getElementById('rankToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'rankToast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.style.position = 'fixed';
  el.style.right = '18px';
  el.style.bottom = '18px';
  el.style.zIndex = '200';
  el.style.display = 'block';
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.style.display = 'none'; }, 2200);
}

function exportCsv() {
  const b = board();
  const blob = new Blob([csv()], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${b.title}_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function init() {
  try {
    const [meta, payload] = await Promise.all([
      api('/api/meta'),
      api('/api/rankings')
    ]);
    state.viewer = meta.viewer;
    if (state.viewer?.role !== 'admin') {
      $('#globalError').classList.remove('hidden');
      $('#globalError').textContent = '业绩排行榜仅管理员可见';
      $('#rankBody').innerHTML = '';
      return;
    }
    state.boards = payload.boards || [];
    state.active = state.boards[0]?.key || 'consultant';
    if (payload.syncedAt) {
      $('#rankUpdated').textContent = `飞书同步于 ${new Date(payload.syncedAt).toLocaleString('zh-CN', { hour12: false })}`;
    }
    $('#viewerChip').textContent = '管理员 · 全部基地';
    $$('.table-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.active = btn.dataset.key;
        renderSummary();
        renderTable();
      });
    });
    $('#copyRank').addEventListener('click', copyTable);
    $('#exportRank').addEventListener('click', exportCsv);
    $('#logoutBtn').addEventListener('click', async () => {
      try { await fetch('/api/logout', { method: 'POST' }); } catch { /* ignore */ }
      location.href = '/login';
    });
    renderSummary();
    renderTable();
    setInterval(async () => {
      try {
        const fresh = await api('/api/rankings');
        state.boards = fresh.boards || state.boards;
        if (fresh.syncedAt) {
          $('#rankUpdated').textContent = `飞书同步于 ${new Date(fresh.syncedAt).toLocaleString('zh-CN', { hour12: false })}`;
        }
        renderSummary();
        renderTable();
      } catch { /* keep last data */ }
    }, 30000);
  } catch (err) {
    if (err.message === '请先登录') return;
    $('#globalError').classList.remove('hidden');
    $('#globalError').textContent = err.message || '加载失败';
  }
}

document.addEventListener('DOMContentLoaded', init);
