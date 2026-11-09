'use strict';

const state = {
  auth: null,
  bases: [],
  accounts: [],
  stats: null,
  records: { rows: [], total: 0, page: 1, pageSize: 20, filters: { base: 'all', source: 'all', status: 'all', q: '' } },
  import: { draft: null, fileName: '', preview: null },
  section: 'overview',
  settings: null
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}
function n(value) { return Number(value || 0).toLocaleString('zh-CN'); }
function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function formatShortDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const pad = (x) => String(x).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function today() {
  const d = new Date();
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function api(path, options = {}) {
  const opts = { headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}) }, ...options };
  const res = await fetch(path, opts);
  if (res.status === 401) {
    showAuth(false);
    throw new Error('登录已过期，请重新登录');
  }
  if (!res.ok) {
    let message = '请求失败';
    try { message = (await res.json()).error || message; } catch { /* ignore */ }
    throw new Error(message);
  }
  return res.json();
}

function toast(message, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  $('#toastWrap').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .2s'; setTimeout(() => el.remove(), 220); }, 3200);
}

function showAuth(setupRequired) {
  $('#adminApp').classList.add('hidden');
  $('#authView').classList.remove('hidden');
  $('#authTitle').textContent = setupRequired ? '初始化管理员' : '登录后台';
  $('#authSub').textContent = setupRequired ? '首次使用，请创建管理员账号。密码至少 6 位。' : '使用管理员账号登录，维护数据与展示配置。';
  $('#authPass2Field').classList.toggle('hidden', !setupRequired);
  $('#authSubmit').textContent = setupRequired ? '创建并登录' : '登录';
  $('#authError').classList.add('hidden');
  $('#authUser').focus();
}

function showApp() {
  $('#authView').classList.add('hidden');
  $('#adminApp').classList.remove('hidden');
  const name = state.auth?.username || '管理员';
  $('#adminName').textContent = name;
  $('#avatar').textContent = name.slice(0, 1).toUpperCase();
}

function sectionMeta(section) {
  const map = {
    overview: ['后台概览', '数据版本、导入记录与最近操作'],
    records: ['数据管理', '新增、编辑、删除当前版本中的名单'],
    import: ['数据导入', '上传 Excel/CSV，校验后发布为新版本'],
    bases: ['基地管理', '维护基地名称、编码、主题色与排序'],
    accounts: ['基地账号', '查看基地账号、重置密码、启用或停用'],
    settings: ['展示配置', '标题、公告、KPI 与明细列配置'],
    versions: ['版本记录', '切换版本即可回滚前台数据'],
    feishu: ['飞书同步', '从飞书多维表格同步专项表和业绩排行'],
    audit: ['操作日志', '后台操作审计记录']
  };
  return map[section] || map.overview;
}

function switchSection(section) {
  state.section = section;
  $$('.admin-nav-item').forEach((btn) => btn.classList.toggle('active', btn.dataset.section === section));
  $$('.admin-section').forEach((el) => el.classList.toggle('active', el.id === `section-${section}`));
  const [title, sub] = sectionMeta(section);
  $('#sectionTitle').textContent = title;
  $('#sectionSub').textContent = sub;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (section === 'overview') loadStats();
  if (section === 'records') loadAdminRecords();
  if (section === 'bases') loadBases();
  if (section === 'accounts') loadAccounts();
  if (section === 'settings') loadSettings();
  if (section === 'versions') loadVersions();
  if (section === 'feishu') loadFeishu();
  if (section === 'audit') loadAudit();
}

function baseOptions(selected = '') {
  return '<option value="">请选择基地</option>' + state.bases.map((b) =>
    `<option value="${b.id}" ${String(selected) === String(b.id) ? 'selected' : ''}>${esc(b.name)}</option>`
  ).join('');
}

async function loadMeta() {
  const meta = await fetch('/api/meta').then((r) => r.json());
  $('#adminUpdated').textContent = meta.updatedAt ? `数据更新于 ${formatDateTime(meta.updatedAt)}` : '尚未发布数据';
  return meta;
}

async function loadBases() {
  state.bases = await api('/api/admin/bases');
  const options = state.bases.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join('');
  const adminBase = $('#adminBase');
  if (adminBase) adminBase.innerHTML = '<option value="all">全部基地</option>' + options;
  const importBase = $('#importBase');
  if (importBase) importBase.innerHTML = '<option value="">请选择默认基地</option>' + options;
  if (state.section === 'bases') renderBases();
  return state.bases;
}

async function loadAccounts() {
  try {
    const rows = await api('/api/admin/base-accounts');
    state.accounts = rows;
    const tbody = $('#accountsTable tbody');
    tbody.innerHTML = rows.map((r) => `
      <tr>
        <td><span class="badge badge-base" style="--base-color:${esc(r.baseColor)}">${esc(r.baseName)}</span></td>
        <td><code style="font-size:12px">${esc(r.username)}</code></td>
        <td>${r.active ? '<span class="badge badge-已转化">启用</span>' : '<span class="badge badge-暂缓">已停用</span>'}</td>
        <td class="num">${r.lastLoginAt ? esc(formatShortDateTime(r.lastLoginAt)) : '—'}</td>
        <td style="text-align:right;white-space:nowrap">
          <button class="btn btn-sm" data-edit-account="${r.id}" type="button">修改账号</button>
          <button class="btn btn-sm ${r.active ? 'btn-danger' : ''}" data-toggle-account="${r.id}" type="button">${r.active ? '停用' : '启用'}</button>
        </td>
      </tr>`).join('') || '<tr><td colspan="5"><div class="empty-state"><p>暂无基地账号</p></div></td></tr>';
    $$('[data-edit-account]', tbody).forEach((btn) => btn.addEventListener('click', () => {
      const row = state.accounts.find((a) => a.id === Number(btn.dataset.editAccount));
      if (row) openAccountEdit(row);
    }));
    $$('[data-toggle-account]', tbody).forEach((btn) => btn.addEventListener('click', () => toggleAccount(Number(btn.dataset.toggleAccount))));
  } catch (err) {
    toast(err.message, 'err');
  }
}

function openAccountEdit(row) {
  $('#modalTitle').textContent = '修改基地账号';
  $('#modalBody').innerHTML = `<form id="accountEditForm">
    <div class="form-grid">
      <div class="form-field"><label>基地</label><input class="control" value="${esc(row.baseName)}" disabled></div>
      <div class="form-field"><label>登录账号 *</label><input class="control" name="username" value="${esc(row.username)}" required></div>
      <div class="form-field full"><label>新密码（留空则不修改）</label><input class="control" name="password" type="password" autocomplete="new-password" placeholder="至少 8 位，含大小写字母、数字和符号"></div>
      <div class="form-field full"><div class="hint-text">修改账号后，基地需使用新账号登录；修改密码后旧密码立即失效。</div></div>
    </div>
    <div class="form-actions"><button class="btn" type="button" data-close-modal>取消</button><button class="btn btn-primary" type="submit">保存修改</button></div>
  </form>`;
  openModal();
  $('#accountEditForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api(`/api/admin/base-accounts/${row.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          username: String(fd.get('username') || '').trim(),
          password: String(fd.get('password') || '')
        })
      });
      closeModal();
      toast('基地账号已更新', 'ok');
      await loadAccounts();
    } catch (err) {
      toast(err.message, 'err');
    }
  });
}

async function resetAccount(id, username) {
  if (!confirm(`重置「${username}」的密码？旧密码会立即失效。`)) return;
  try {
    const result = await api(`/api/admin/base-accounts/${id}/reset`, { method: 'POST' });
    showPasswordModal(result.username, result.password);
    await loadAccounts();
  } catch (err) {
    toast(err.message, 'err');
  }
}

function showPasswordModal(username, password) {
  $('#modalTitle').textContent = '新密码（仅显示一次）';
  $('#modalBody').innerHTML = `
    <p class="text-muted text-sm" style="margin-top:0">账号 <b style="color:var(--text)">${esc(username)}</b> 的新密码：</p>
    <div style="display:flex;gap:8px;align-items:center;margin:14px 0">
      <code id="newPasswordValue" style="flex:1;padding:12px;background:var(--surface-soft);border-radius:8px;font-size:14px;word-break:break-all">${esc(password)}</code>
      <button class="btn" id="copyPassword" type="button">复制</button>
    </div>
    <div class="notice" style="margin-bottom:0"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1"/></svg><div>请立即复制并通过安全渠道发给对应基地，关闭后无法再次查看。</div></div>
    <div class="form-actions"><button class="btn btn-primary" type="button" data-close-modal>我已保存</button></div>`;
  openModal();
  $('#copyPassword').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(password);
      toast('密码已复制', 'ok');
    } catch {
      toast('复制失败，请手动选择文本', 'err');
    }
  });
}

async function toggleAccount(id) {
  try {
    const result = await api(`/api/admin/base-accounts/${id}/toggle`, { method: 'POST' });
    toast(result.active ? '账号已启用' : '账号已停用', 'ok');
    await loadAccounts();
  } catch (err) {
    toast(err.message, 'err');
  }
}

function renderBases() {
  const tbody = $('#basesTable tbody');
  tbody.innerHTML = state.bases.map((b) => `
    <tr>
      <td><span class="badge badge-base" style="--base-color:${esc(b.color)}">${esc(b.name)}</span></td>
      <td>${esc(b.code || '—')}</td>
      <td><span class="flex items-center gap-8"><span class="legend-dot" style="background:${esc(b.color)}"></span>${esc(b.color)}</span></td>
      <td class="num">${n(b.recordCount)}</td>
      <td class="num">${n(b.sortOrder)}</td>
      <td>${b.active ? '<span class="badge badge-已转化">启用</span>' : '<span class="badge badge-暂缓">停用</span>'}</td>
      <td style="text-align:right">
        <button class="btn btn-sm" data-edit-base="${b.id}" type="button">编辑</button>
        <button class="btn btn-sm btn-danger" data-delete-base="${b.id}" type="button">删除</button>
      </td>
    </tr>`).join('') || '<tr><td colspan="7"><div class="empty-state"><p>暂无基地</p></div></td></tr>';

  $$('[data-edit-base]', tbody).forEach((btn) => btn.addEventListener('click', () => openBaseModal(Number(btn.dataset.editBase))));
  $$('[data-delete-base]', tbody).forEach((btn) => btn.addEventListener('click', () => deleteBase(Number(btn.dataset.deleteBase))));
}

function openBaseModal(id = null) {
  const base = id ? state.bases.find((b) => b.id === id) : null;
  $('#modalTitle').textContent = base ? '编辑基地' : '新增基地';
  $('#modalBody').innerHTML = `<form id="baseForm">
    <div class="form-grid">
      <div class="form-field"><label>基地名称 *</label><input class="control" name="name" value="${esc(base?.name || '')}" required></div>
      <div class="form-field"><label>编码</label><input class="control" name="code" value="${esc(base?.code || '')}" placeholder="如 WH"></div>
      <div class="form-field"><label>主题色</label><input class="control" name="color" type="color" value="${esc(base?.color || '#3b82f6')}" style="padding:4px 6px"></div>
      <div class="form-field"><label>排序</label><input class="control" name="sortOrder" type="number" value="${esc(base?.sortOrder ?? 99)}"></div>
      <div class="form-field full"><label class="check-item"><input type="checkbox" name="active" ${base?.active === false ? '' : 'checked'}> 启用该基地</label></div>
    </div>
    <div class="form-actions"><button class="btn" type="button" data-close-modal>取消</button><button class="btn btn-primary" type="submit">保存</button></div>
  </form>`;
  openModal();
  $('#baseForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = {
      name: fd.get('name'),
      code: fd.get('code'),
      color: fd.get('color'),
      sortOrder: Number(fd.get('sortOrder') || 99),
      active: fd.get('active') === 'on'
    };
    try {
      await api(base ? `/api/admin/bases/${base.id}` : '/api/admin/bases', {
        method: base ? 'PUT' : 'POST',
        body: JSON.stringify(payload)
      });
      closeModal();
      toast(base ? '基地已更新' : '基地已新增', 'ok');
      await loadBases();
      if (state.section === 'overview') loadStats();
    } catch (err) { toast(err.message, 'err'); }
  });
}

async function deleteBase(id) {
  const base = state.bases.find((b) => b.id === id);
  if (!base) return;
  if (!confirm(`确定删除「${base.name}」？该基地下没有名单时才允许删除。`)) return;
  try {
    await api(`/api/admin/bases/${id}`, { method: 'DELETE' });
    toast('基地已删除', 'ok');
    await loadBases();
  } catch (err) { toast(err.message, 'err'); }
}

async function loadStats() {
  try {
    const stats = await api('/api/admin/stats');
    state.stats = stats;
    $('#statTotal').textContent = n(stats.total);
    $('#statTotalFoot').textContent = stats.version ? stats.version.label : '尚无版本';
    $('#statBases').textContent = n(stats.baseCount);
    $('#statVersion').textContent = stats.version ? stats.version.label : '—';
    $('#statVersionFoot').textContent = stats.version ? `发布 ${formatDateTime(stats.version.published_at || stats.version.created_at)}` : '—';
    $('#statUsers').textContent = n(stats.userCount);
    $('#recentVersions tbody').innerHTML = stats.versions.map((v) => `
      <tr><td class="cell-strong">${esc(v.label)}</td><td class="num">${n(v.row_count)}</td><td class="num">${esc(formatDate(v.published_at || v.created_at))}</td></tr>
    `).join('') || '<tr><td colspan="3"><div class="empty-state"><p>暂无版本</p></div></td></tr>';
    $('#recentLogs tbody').innerHTML = stats.logs.map((l) => `
      <tr><td>${esc(l.action)}</td><td>${esc(l.actor)}</td><td class="num">${esc(formatShortDateTime(l.created_at))}</td></tr>
    `).join('') || '<tr><td colspan="3"><div class="empty-state"><p>暂无操作</p></div></td></tr>';
  } catch (err) { toast(err.message, 'err'); }
}

function recordQuery() {
  const f = state.records.filters;
  const p = new URLSearchParams();
  if (f.base !== 'all') p.set('base', f.base);
  if (f.source !== 'all') p.set('source', f.source);
  if (f.status !== 'all') p.set('status', f.status);
  if (f.q) p.set('q', f.q);
  p.set('page', String(state.records.page));
  p.set('pageSize', String(state.records.pageSize));
  return p;
}

async function loadAdminRecords() {
  try {
    const data = await api(`/api/admin/records?${recordQuery().toString()}`);
    state.records.rows = data.rows;
    state.records.total = data.total;
    renderAdminRecords();
  } catch (err) { toast(err.message, 'err'); }
}

function renderAdminRecords() {
  const tbody = $('#adminRecordsTable tbody');
  if (!state.records.rows.length) {
    tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><h3>暂无名单</h3><p>可新增或从 Excel 导入</p></div></td></tr>';
  } else {
    tbody.innerHTML = state.records.rows.map((r) => `
      <tr>
        <td><span class="badge badge-base" style="--base-color:${esc(r.baseColor)}">${esc(r.baseName)}</span></td>
        <td class="cell-strong">${esc(r.customerName)}</td>
        <td class="num">${esc(r.phone || '—')}</td>
        <td><span class="badge ${r.sourceType === '高潜老用户' ? 'badge-source-high' : 'badge-source-new'}">${esc(r.sourceType)}</span></td>
        <td>${esc(r.owner || '—')}</td>
        <td><span class="badge badge-${esc(r.status)}">${esc(r.status)}</span></td>
        <td style="text-align:right;white-space:nowrap">
          <button class="btn btn-sm" data-edit-record="${r.id}" type="button">编辑</button>
          <button class="btn btn-sm btn-danger" data-delete-record="${r.id}" type="button">删除</button>
        </td>
      </tr>`).join('');
    $$('[data-edit-record]', tbody).forEach((btn) => btn.addEventListener('click', () => {
      const row = state.records.rows.find((r) => r.id === Number(btn.dataset.editRecord));
      openRecordModal(row);
    }));
    $$('[data-delete-record]', tbody).forEach((btn) => btn.addEventListener('click', () => deleteRecord(Number(btn.dataset.deleteRecord))));
  }

  const pages = Math.max(1, Math.ceil(state.records.total / state.records.pageSize));
  const cur = Math.min(state.records.page, pages);
  $('#adminPageInfo').textContent = state.records.total
    ? `第 ${(cur - 1) * state.records.pageSize + 1}–${Math.min(cur * state.records.pageSize, state.records.total)} 条，共 ${n(state.records.total)} 条`
    : '共 0 条';
  const buttons = [];
  buttons.push(`<button type="button" data-page="${cur - 1}" ${cur <= 1 ? 'disabled' : ''}>‹</button>`);
  for (let p = 1; p <= pages; p++) {
    if (pages > 7 && p !== 1 && p !== pages && Math.abs(p - cur) > 1) {
      if (p === 2 || p === pages - 1) buttons.push('<span class="text-muted">…</span>');
      continue;
    }
    buttons.push(`<button type="button" data-page="${p}" class="${p === cur ? 'active' : ''}">${p}</button>`);
  }
  buttons.push(`<button type="button" data-page="${cur + 1}" ${cur >= pages ? 'disabled' : ''}>›</button>`);
  $('#adminPager').innerHTML = buttons.join('');
  $$('#adminPager button[data-page]').forEach((btn) => btn.addEventListener('click', () => {
    const p = Number(btn.dataset.page);
    if (!p || p < 1 || p > pages) return;
    state.records.page = p;
    loadAdminRecords();
  }));
}

function openRecordModal(row = null) {
  $('#modalTitle').textContent = row ? '编辑名单' : '新增名单';
  $('#modalBody').innerHTML = `<form id="recordForm">
    <div class="form-grid">
      <div class="form-field"><label>所属基地 *</label><select class="control" name="baseId" required>${baseOptions(row?.baseId)}</select></div>
      <div class="form-field"><label>客户姓名 *</label><input class="control" name="customerName" value="${esc(row?.customerName || '')}" required></div>
      <div class="form-field"><label>手机号</label><input class="control" name="phone" value="${esc(row?.phone || '')}"></div>
      <div class="form-field"><label>来源类型</label><select class="control" name="sourceType">
        <option value="新用户直推未转化" ${row?.sourceType === '新用户直推未转化' ? 'selected' : ''}>新用户直推未转化</option>
        <option value="高潜老用户" ${row?.sourceType === '高潜老用户' ? 'selected' : ''}>高潜老用户</option>
      </select></div>
      <div class="form-field"><label>负责人</label><input class="control" name="owner" value="${esc(row?.owner || '')}"></div>
      <div class="form-field"><label>跟进状态</label><select class="control" name="status">
        ${['待跟进', '跟进中', '已转化', '暂缓'].map((s) => `<option value="${s}" ${row?.status === s ? 'selected' : ''}>${s}</option>`).join('')}
      </select></div>
      <div class="form-field"><label>创建日期</label><input class="control" name="createdAt" type="date" value="${esc(row?.createdAt || today())}"></div>
      <div class="form-field"><label>最近跟进</label><input class="control" name="lastFollowUp" type="date" value="${esc(row?.lastFollowUp || '')}"></div>
      <div class="form-field full"><label>标签</label><input class="control" name="tags" value="${esc(row?.tags || '')}" placeholder="多个标签用、分隔"></div>
      <div class="form-field full"><label>备注</label><textarea class="control" name="note" placeholder="仅后台可见">${esc(row?.note || '')}</textarea></div>
    </div>
    <div class="form-actions"><button class="btn" type="button" data-close-modal>取消</button><button class="btn btn-primary" type="submit">保存</button></div>
  </form>`;
  openModal();
  $('#recordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = Object.fromEntries(fd.entries());
    payload.baseId = Number(payload.baseId);
    try {
      await api(row ? `/api/admin/records/${row.id}` : '/api/admin/records', {
        method: row ? 'PUT' : 'POST',
        body: JSON.stringify(payload)
      });
      closeModal();
      toast(row ? '名单已更新' : '名单已新增', 'ok');
      await loadAdminRecords();
      await loadStats();
    } catch (err) { toast(err.message, 'err'); }
  });
}

async function deleteRecord(id) {
  const row = state.records.rows.find((r) => r.id === id);
  if (!row) return;
  if (!confirm(`确定删除「${row.customerName}」这条名单？删除后不可恢复。`)) return;
  try {
    await api(`/api/admin/records/${id}`, { method: 'DELETE' });
    toast('名单已删除', 'ok');
    await loadAdminRecords();
    await loadStats();
  } catch (err) { toast(err.message, 'err'); }
}

const KPI_OPTIONS = [
  ['total', '名单总量'],
  ['newUnconverted', '新用户直推未转化'],
  ['highPotential', '高潜老用户'],
  ['conversionRate', '转化率'],
  ['followUpRate', '跟进覆盖率']
];
const COLUMN_OPTIONS = [
  ['base', '基地'],
  ['customer', '客户姓名'],
  ['phone', '手机号'],
  ['source', '来源类型'],
  ['owner', '负责人'],
  ['status', '状态'],
  ['createdAt', '创建日期'],
  ['lastFollowUp', '最近跟进']
];

async function loadSettings() {
  try {
    const s = await api('/api/admin/settings');
    state.settings = s;
    $('#setTitle').value = s.dashboard_title || '';
    $('#setSubtitle').value = s.dashboard_subtitle || '';
    $('#setAnnouncement').value = s.announcement || '';
    $('#setDataNote').value = s.data_note || '';
    const kpi = new Set(s.kpiVisibility || []);
    $('#kpiChecks').innerHTML = KPI_OPTIONS.map(([key, label]) =>
      `<label class="check-item"><input type="checkbox" value="${key}" ${kpi.has(key) ? 'checked' : ''}> ${label}</label>`
    ).join('');
    const cols = new Set(s.visibleColumns || []);
    $('#columnChecks').innerHTML = COLUMN_OPTIONS.map(([key, label]) =>
      `<label class="check-item"><input type="checkbox" value="${key}" ${cols.has(key) ? 'checked' : ''}> ${label}</label>`
    ).join('');
  } catch (err) { toast(err.message, 'err'); }
}

async function saveSettings(e) {
  e.preventDefault();
  const kpiVisibility = $$('#kpiChecks input:checked').map((i) => i.value);
  const visibleColumns = $$('#columnChecks input:checked').map((i) => i.value);
  if (!kpiVisibility.length) return toast('至少保留一个 KPI', 'err');
  if (!visibleColumns.length) return toast('至少保留一个明细列', 'err');
  try {
    await api('/api/admin/settings', {
      method: 'PUT',
      body: JSON.stringify({
        dashboard_title: $('#setTitle').value,
        dashboard_subtitle: $('#setSubtitle').value,
        announcement: $('#setAnnouncement').value,
        data_note: $('#setDataNote').value,
        kpi_visibility: kpiVisibility,
        visible_columns: visibleColumns
      })
    });
    toast('展示配置已保存', 'ok');
    await loadMeta();
  } catch (err) { toast(err.message, 'err'); }
}

async function loadVersions() {
  try {
    const data = await api('/api/admin/versions');
    const activeId = Number(data.activeVersionId);
    $('#versionsTable tbody').innerHTML = data.rows.map((v) => `
      <tr>
        <td class="cell-strong">${esc(v.label)}</td>
        <td>${esc(v.file_name || '—')}</td>
        <td class="num">${n(v.actual_count)}</td>
        <td>${esc(v.created_by)}</td>
        <td class="num">${esc(formatDateTime(v.published_at || v.created_at))}</td>
        <td>${v.id === activeId ? '<span class="badge badge-已转化">当前使用</span>' : '<span class="badge badge-待跟进">历史版本</span>'}</td>
        <td style="text-align:right">
          ${v.id === activeId ? '<span class="text-muted text-sm">—</span>' : `<button class="btn btn-sm" data-activate="${v.id}" type="button">切换到此版本</button>`}
        </td>
      </tr>`).join('') || '<tr><td colspan="7"><div class="empty-state"><p>暂无版本</p></div></td></tr>';
    $$('[data-activate]').forEach((btn) => btn.addEventListener('click', () => activateVersion(Number(btn.dataset.activate))));
  } catch (err) { toast(err.message, 'err'); }
}

async function activateVersion(id) {
  if (!confirm('切换版本会立即改变前台展示的数据，确定继续？')) return;
  try {
    await api(`/api/admin/versions/${id}/activate`, { method: 'POST' });
    toast('已切换数据版本', 'ok');
    await loadVersions();
    await loadStats();
  } catch (err) { toast(err.message, 'err'); }
}

async function loadFeishu() {
  try {
    const s = await api('/api/admin/feishu/status');
    const badge = (ok, text) => `<span class="badge ${ok ? 'badge-已转化' : 'badge-暂缓'}">${text}</span>`;
    const missing = [];
    if (!s.appIdConfigured) missing.push('FEISHU_APP_ID');
    if (!s.appSecretConfigured) missing.push('FEISHU_APP_SECRET');
    if (!s.appTokenConfigured) missing.push('FEISHU_APP_TOKEN');
    const tableRows = Object.entries(s.tableIds || {}).map(([key, ok]) => `<div class="flex items-center gap-8" style="justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--surface-soft)"><span class="text-sm">${esc(key)}</span>${badge(ok, ok ? '已配置' : '未配置')}</div>`).join('');
    const countText = s.counts ? Object.entries(s.counts.tables || {}).map(([k, v]) => `${k}: ${v}`).concat(Object.entries(s.counts.rankings || {}).map(([k, v]) => `排行-${k}: ${v}`)).join(' · ') : '尚未同步';
    $('#feishuStatus').innerHTML = `
      <div class="admin-grid" style="grid-template-columns:repeat(3,minmax(0,1fr));margin-bottom:14px">
        <div class="stat-card"><div class="stat-label">应用凭证</div><div class="stat-value" style="font-size:18px">${s.appIdConfigured && s.appSecretConfigured ? '已配置' : '未配置'}</div><div class="stat-foot">App ID / Secret 仅在服务器环境变量</div></div>
        <div class="stat-card"><div class="stat-label">数据表配置</div><div class="stat-value" style="font-size:22px">${s.tableCount}/${s.expectedTableCount}</div><div class="stat-foot">4 张专项表 + 3 张排行榜</div></div>
        <div class="stat-card"><div class="stat-label">最近同步</div><div class="stat-value" style="font-size:17px">${s.lastSync ? esc(formatDateTime(s.lastSync)) : '尚未同步'}</div><div class="stat-foot">${esc(countText)}</div></div>
      </div>
      ${missing.length ? `<div class="error-list" style="background:#fffbeb;color:#b45309">缺少服务器环境变量：${missing.map(esc).join('、')}</div>` : ''}
      <div style="max-width:620px">${tableRows}</div>`;
    $('#feishuSyncBtn').onclick = syncFeishuNow;
  } catch (err) {
    $('#feishuStatus').innerHTML = `<div class="error-banner">${esc(err.message)}</div>`;
  }
}

async function syncFeishuNow() {
  const btn = $('#feishuSyncBtn');
  btn.disabled = true;
  btn.textContent = '正在同步…';
  try {
    const result = await api('/api/admin/feishu/sync', { method: 'POST' });
    toast(`飞书同步完成：${Object.values(result.counts?.tables || {}).reduce((a, b) => a + b, 0)} 条专项数据`, 'ok');
    await loadFeishu();
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = '立即同步';
  }
}

async function loadAudit() {
  try {
    const rows = await api('/api/admin/audit');
    $('#auditTable tbody').innerHTML = rows.map((l) => `
      <tr>
        <td class="num">${esc(formatDateTime(l.created_at))}</td>
        <td>${esc(l.actor)}</td>
        <td class="cell-strong">${esc(l.action)}</td>
        <td>${esc(l.detail || '—')}</td>
        <td class="num">${esc(l.ip || '—')}</td>
      </tr>`).join('') || '<tr><td colspan="5"><div class="empty-state"><p>暂无日志</p></div></td></tr>';
  } catch (err) { toast(err.message, 'err'); }
}

function resetImport() {
  state.import = { draft: null, fileName: '', preview: null };
  $('#previewCard').classList.add('hidden');
  $('#fileInput').value = '';
  $('#dropzone').classList.remove('hidden');
  $('#versionLabel').value = '';
  $$('#section-import .import-step').forEach((el, i) => el.classList.toggle('active', i === 0));
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.includes(',') ? result.split(',')[1] : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function handleFile(file) {
  if (!file) return;
  if (file.size > 15 * 1024 * 1024) return toast('文件超过 15MB，请拆分后导入', 'err');
  const baseId = $('#importBase').value || '';
  if (!baseId && !state.bases.length) return toast('请先在基地管理中创建基地', 'err');
  try {
    $('#dropzone').classList.add('hidden');
    $('#previewCard').classList.remove('hidden');
    $('#previewFileName').textContent = `${file.name} · 正在解析…`;
    $('#importSummary').innerHTML = '<span class="summary-pill">正在校验文件…</span>';
    $('#previewTable thead').innerHTML = '';
    $('#previewTable tbody').innerHTML = '<tr><td><div class="skeleton skeleton-line"></div></td></tr>';
    $('#importErrors').innerHTML = '';
    const base64 = await fileToBase64(file);
    const result = await api('/api/admin/import/preview', {
      method: 'POST',
      body: JSON.stringify({
        fileName: file.name,
        base64,
        baseId: baseId || undefined,
        sourceType: $('#importSource').value
      })
    });
    state.import = { draft: result.draftId, fileName: file.name, preview: result };
    renderPreview(result);
    $$('#section-import .import-step').forEach((el, i) => el.classList.toggle('active', i <= 1));
  } catch (err) {
    $('#dropzone').classList.remove('hidden');
    $('#previewCard').classList.add('hidden');
    toast(err.message, 'err');
  }
}

function renderPreview(result) {
  $('#previewFileName').textContent = `${result.fileName} · 工作表「${result.sheetName}」 · 表头第 ${result.headerRow} 行`;
  const s = result.stats;
  $('#importSummary').innerHTML = `
    <span class="summary-pill">识别 <b>${n(s.totalRows)}</b> 行</span>
    <span class="summary-pill ok">可导入 <b>${n(s.validRows)}</b> 行</span>
    <span class="summary-pill ${s.errorRows ? 'error' : ''}">异常 <b>${n(s.errorRows)}</b> 行</span>
    <span class="summary-pill">基地 <b>${esc(s.bases.join('、') || '—')}</b></span>
    <span class="summary-pill">来源 <b>${esc(s.sources.join('、') || '—')}</b></span>`;
  $('#importErrors').innerHTML = result.errors?.length
    ? `<div class="error-list"><b>需要先处理的问题：</b><br>${result.errors.map((e) => `第 ${e.row} 行：${esc(e.message)}`).join('<br>')}</div>`
    : (result.warnings?.length ? `<div class="error-list" style="background:#fffbeb;color:#b45309">${result.warnings.map((w) => `第 ${w.row} 行：${esc(w.message)}`).join('<br>')}</div>` : '');

  const cols = ['baseName', 'customerName', 'phone', 'sourceType', 'owner', 'status', 'createdAt', 'lastFollowUp'];
  const labels = ['基地', '姓名', '手机号', '来源', '负责人', '状态', '创建日期', '最近跟进'];
  $('#previewTable thead').innerHTML = `<tr>${labels.map((l) => `<th>${l}</th>`).join('')}</tr>`;
  $('#previewTable tbody').innerHTML = result.preview.map((r) => `
    <tr>${cols.map((c) => `<td class="${c === 'customerName' ? 'cell-strong' : ''}">${esc(r[c] || '—')}</td>`).join('')}</tr>
  `).join('') || '<tr><td colspan="8"><div class="empty-state"><p>没有可预览的数据</p></div></td></tr>';
  $('#versionLabel').value = result.fileName.replace(/\.(xlsx|xls|csv)$/i, '') + ' · ' + today();
  if (!s.validRows) $('#commitImport').disabled = true;
  else $('#commitImport').disabled = false;
}

async function commitImport() {
  if (!state.import.draft) return;
  const label = $('#versionLabel').value.trim();
  if (!label) return toast('请填写版本名称', 'err');
  const mode = ($('input[name="importMode"]:checked') || {}).value || 'append';
  const btn = $('#commitImport');
  btn.disabled = true;
  btn.textContent = '正在发布…';
  try {
    const result = await api('/api/admin/import/commit', {
      method: 'POST',
      body: JSON.stringify({
        draftId: state.import.draft,
        label,
        fileName: state.import.fileName,
        mode
      })
    });
    toast(`导入成功：${n(result.rowCount)} 条${result.skippedDuplicates ? `，跳过重复 ${result.skippedDuplicates} 条` : ''}`, 'ok');
    resetImport();
    await loadStats();
    await loadBases();
    switchSection('overview');
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = '发布为新版本';
  }
}

function openModal() {
  $('#modalBackdrop').classList.add('open');
}
function closeModal() {
  $('#modalBackdrop').classList.remove('open');
  $('#modalBody').innerHTML = '';
}

function bind() {
  $('#authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#authError').classList.add('hidden');
    const username = $('#authUser').value.trim();
    const password = $('#authPass').value;
    const setup = !$('#authPass2Field').classList.contains('hidden');
    if (setup && password !== $('#authPass2').value) {
      $('#authError').textContent = '两次输入的密码不一致';
      $('#authError').classList.remove('hidden');
      return;
    }
    try {
      await api(setup ? '/api/admin/setup' : '/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      });
      state.auth = { username };
      showApp();
      await bootData();
    } catch (err) {
      $('#authError').textContent = err.message;
      $('#authError').classList.remove('hidden');
    }
  });

  $('#logoutBtn').addEventListener('click', async () => {
    try { await api('/api/admin/logout', { method: 'POST' }); } catch { /* ignore */ }
    state.auth = null;
    showAuth(false);
    $('#authPass').value = '';
  });

  $$('.admin-nav-item').forEach((btn) => btn.addEventListener('click', () => switchSection(btn.dataset.section)));
  $$('[data-goto]').forEach((btn) => btn.addEventListener('click', () => switchSection(btn.dataset.goto)));
  $('#quickImport').addEventListener('click', () => switchSection('import'));

  $('#adminBase').addEventListener('change', (e) => { state.records.filters.base = e.target.value; state.records.page = 1; loadAdminRecords(); });
  $('#adminSource').addEventListener('change', (e) => { state.records.filters.source = e.target.value; state.records.page = 1; loadAdminRecords(); });
  $('#adminStatus').addEventListener('change', (e) => { state.records.filters.status = e.target.value; state.records.page = 1; loadAdminRecords(); });
  let timer;
  $('#adminSearch').addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.records.filters.q = e.target.value.trim();
      state.records.page = 1;
      loadAdminRecords();
    }, 320);
  });
  $('#adminReset').addEventListener('click', () => {
    state.records.filters = { base: 'all', source: 'all', status: 'all', q: '' };
    state.records.page = 1;
    $('#adminBase').value = 'all';
    $('#adminSource').value = 'all';
    $('#adminStatus').value = 'all';
    $('#adminSearch').value = '';
    loadAdminRecords();
  });
  $('#addRecordBtn').addEventListener('click', () => openRecordModal());
  $('#addBaseBtn').addEventListener('click', () => openBaseModal());
  $('#settingsForm').addEventListener('submit', saveSettings);

  $('#dropzone').addEventListener('click', () => $('#fileInput').click());
  $('#dropzone').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#fileInput').click(); } });
  $('#dropzone').addEventListener('dragover', (e) => { e.preventDefault(); $('#dropzone').classList.add('dragover'); });
  $('#dropzone').addEventListener('dragleave', () => $('#dropzone').classList.remove('dragover'));
  $('#dropzone').addEventListener('drop', (e) => {
    e.preventDefault();
    $('#dropzone').classList.remove('dragover');
    handleFile(e.dataTransfer.files[0]);
  });
  $('#fileInput').addEventListener('change', (e) => handleFile(e.target.files[0]));
  $('#cancelPreview').addEventListener('click', resetImport);
  $('#cancelPreview2').addEventListener('click', resetImport);
  $('#commitImport').addEventListener('click', commitImport);

  $('#modalClose').addEventListener('click', closeModal);
  $('#modalBackdrop').addEventListener('click', (e) => { if (e.target === $('#modalBackdrop')) closeModal(); });
  document.addEventListener('click', (e) => { if (e.target.closest('[data-close-modal]')) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
}

async function bootData() {
  await loadMeta();
  await loadBases();
  await loadStats();
  if (state.section === 'records') await loadAdminRecords();
}

async function init() {
  bind();
  try {
    const me = await fetch('/api/admin/me', { headers: { Accept: 'application/json' } }).then((r) => r.json());
    state.auth = me;
    if (!me.authenticated) {
      showAuth(me.setupRequired);
      return;
    }
    showApp();
    await bootData();
  } catch (err) {
    showAuth(false);
    $('#authError').textContent = err.message || '初始化失败';
    $('#authError').classList.remove('hidden');
  }
}

document.addEventListener('DOMContentLoaded', init);
