'use strict';

require('./env');

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const XLSX = require('xlsx');
const { db, getSetting, setSetting, audit, nowIso, DEFAULT_SETTINGS } = require('./db');
const {
  hashPassword, verifyPassword, createSession, createBaseSession,
  currentUser, currentBaseUser, sessionCookie, baseSessionCookie,
  clearCookie, clearBaseCookie, checkLoginRate
} = require('./auth');
const { parseWorkbook } = require('./import');
const {
  BASE_META, generatePassword, generateUsername, readAccounts,
  updateAccountPassword, updateAccountIdentity, upsertAccount, removeAccount
} = require('./accounts');
const { getTables, saveTable } = require('./tables');
const { getRankings, saveRankings } = require('./rankings');
const { configStatus: feishuStatus, syncFeishu, readCache: feishuCache } = require('./feishu');

const PORT = Number(process.env.PORT || 4310);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY = 20 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('请求体过大，单次导入请控制在 15MB 以内'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('请求格式不正确'));
      }
    });
    req.on('error', reject);
  });
}

function activeVersion() {
  const id = Number(getSetting('active_version_id', '0'));
  if (id) {
    const row = db.prepare('SELECT * FROM versions WHERE id = ?').get(id);
    if (row) return row;
  }
  const latest = db.prepare("SELECT * FROM versions WHERE status = 'published' ORDER BY id DESC LIMIT 1").get();
  if (latest) {
    setSetting('active_version_id', latest.id);
    return latest;
  }
  return null;
}

function bases() {
  return db.prepare('SELECT id, name, code, color, sort_order AS sortOrder, active FROM bases ORDER BY sort_order, id').all();
}

function resolveViewer(req) {
  const admin = currentUser(req);
  if (admin) return { role: 'admin', username: admin.u };
  const baseUser = currentBaseUser(req);
  if (!baseUser) return null;
  const base = db.prepare('SELECT id, name, color, active FROM bases WHERE id = ?').get(Number(baseUser.baseId));
  if (!base || !base.active) return null;
  return {
    role: 'base',
    username: baseUser.u,
    baseId: base.id,
    baseName: base.name,
    baseColor: base.color
  };
}

function requireViewer(req, res) {
  const viewer = resolveViewer(req);
  if (!viewer) {
    sendJson(res, 401, { error: '请先登录', login: '/login' });
    return null;
  }
  return viewer;
}

function orgName(req) {
  try {
    return new URL(req.url, 'http://localhost').pathname;
  } catch {
    return req.url;
  }
}

function whereFilters(params, alias = 'r') {
  const clauses = [];
  const values = [];
  if (params.base && params.base !== 'all') {
    const id = Number(params.base);
    if (Number.isFinite(id)) {
      clauses.push(`${alias}.base_id = ?`);
      values.push(id);
    }
  }
  if (params.from && /^\d{4}-\d{2}-\d{2}$/.test(params.from)) {
    clauses.push(`${alias}.created_at >= ?`);
    values.push(params.from);
  }
  if (params.to && /^\d{4}-\d{2}-\d{2}$/.test(params.to)) {
    clauses.push(`${alias}.created_at <= ?`);
    values.push(params.to);
  }
  if (params.source && params.source !== 'all') {
    clauses.push(`${alias}.source_type = ?`);
    values.push(params.source);
  }
  if (params.status && params.status !== 'all') {
    clauses.push(`${alias}.status = ?`);
    values.push(params.status);
  }
  if (params.owner && params.owner !== 'all') {
    clauses.push(`${alias}.owner = ?`);
    values.push(params.owner);
  }
  if (params.q) {
    clauses.push(`(${alias}.customer_name LIKE ? OR ${alias}.phone LIKE ? OR ${alias}.owner LIKE ? OR ${alias}.tags LIKE ?)`);
    const q = `%${params.q}%`;
    values.push(q, q, q, q);
  }
  return { clauses, values };
}

function maskName(name) {
  const text = String(name || '');
  if (text.length <= 1) return text || '-';
  if (text.length === 2) return text[0] + '*';
  return text[0] + '*'.repeat(Math.min(text.length - 2, 2)) + text[text.length - 1];
}

function maskPhone(phone) {
  const text = String(phone || '').replace(/\s/g, '');
  if (!text) return '';
  if (text.includes('*')) return text;
  if (text.length >= 7) return text.slice(0, 3) + '****' + text.slice(-4);
  return text[0] + '****';
}

function mapRecord(row, mask = true) {
  return {
    id: row.id,
    baseId: row.base_id,
    baseName: row.base_name,
    baseColor: row.base_color,
    sourceType: row.source_type,
    customerName: mask ? maskName(row.customer_name) : row.customer_name,
    phone: mask ? maskPhone(row.phone) : row.phone,
    owner: row.owner,
    status: row.status,
    createdAt: row.created_at,
    lastFollowUp: row.last_follow_up,
    tags: row.tags,
    note: mask ? '' : row.note
  };
}

function overviewData(params, viewer) {
  if (viewer?.role === 'base') params = { ...params, base: String(viewer.baseId) };
  const version = activeVersion();
  if (!version) {
    return { version: null, kpis: { total: 0 }, trend: [], sources: [], statuses: [], bases: [], owners: [] };
  }
  const { clauses, values } = whereFilters(params);
  const where = ['r.version_id = ?', ...clauses].join(' AND ');
  const args = [version.id, ...values];

  const kpi = db.prepare(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN r.source_type = '新用户直推未转化' THEN 1 ELSE 0 END) AS newUnconverted,
      SUM(CASE WHEN r.source_type = '高潜老用户' THEN 1 ELSE 0 END) AS highPotential,
      SUM(CASE WHEN r.status = '已转化' THEN 1 ELSE 0 END) AS converted,
      SUM(CASE WHEN r.status != '待跟进' THEN 1 ELSE 0 END) AS followed
    FROM records r WHERE ${where}
  `).get(...args);

  const total = Number(kpi.total || 0);
  const converted = Number(kpi.converted || 0);
  const followed = Number(kpi.followed || 0);

  const trendRows = db.prepare(`
    SELECT substr(r.created_at, 1, 7) AS month, COUNT(*) AS total,
      SUM(CASE WHEN r.status = '已转化' THEN 1 ELSE 0 END) AS converted
    FROM records r WHERE ${where} AND r.created_at != ''
    GROUP BY substr(r.created_at, 1, 7) ORDER BY month
  `).all(...args);

  const trend = fillMonths(trendRows, params.from, params.to);

  const sources = db.prepare(`
    SELECT r.source_type AS name, COUNT(*) AS value FROM records r
    WHERE ${where} GROUP BY r.source_type ORDER BY value DESC
  `).all(...args);

  const statuses = db.prepare(`
    SELECT r.status AS name, COUNT(*) AS value FROM records r
    WHERE ${where} GROUP BY r.status ORDER BY value DESC
  `).all(...args);

  const baseRows = db.prepare(`
    SELECT b.id, b.name, b.color, COUNT(r.id) AS total,
      SUM(CASE WHEN r.status = '已转化' THEN 1 ELSE 0 END) AS converted,
      SUM(CASE WHEN r.source_type = '新用户直推未转化' THEN 1 ELSE 0 END) AS newUnconverted,
      SUM(CASE WHEN r.source_type = '高潜老用户' THEN 1 ELSE 0 END) AS highPotential,
      COUNT(DISTINCT r.owner) AS ownerCount
    FROM records r JOIN bases b ON b.id = r.base_id
    WHERE ${where} GROUP BY b.id ORDER BY total DESC
  `).all(...args).map((row) => ({
    id: row.id,
    name: row.name,
    color: row.color,
    total: Number(row.total || 0),
    converted: Number(row.converted || 0),
    newUnconverted: Number(row.newUnconverted || 0),
    highPotential: Number(row.highPotential || 0),
    ownerCount: Number(row.ownerCount || 0),
    conversionRate: row.total ? Number(row.converted || 0) / Number(row.total) : 0
  }));

  const owners = db.prepare(`
    SELECT r.owner, b.name AS base_name, b.color AS base_color, COUNT(*) AS total,
      SUM(CASE WHEN r.status = '已转化' THEN 1 ELSE 0 END) AS converted
    FROM records r JOIN bases b ON b.id = r.base_id
    WHERE ${where} AND r.owner != ''
    GROUP BY r.owner, b.id ORDER BY total DESC LIMIT 8
  `).all(...args).map((row) => ({
    owner: row.owner,
    baseName: row.base_name,
    baseColor: row.base_color,
    total: Number(row.total || 0),
    converted: Number(row.converted || 0),
    conversionRate: row.total ? Number(row.converted || 0) / Number(row.total) : 0
  }));

  const ownerBreakdown = db.prepare(`
    SELECT r.owner, b.id AS base_id, b.name AS base_name, b.color AS base_color,
      COUNT(*) AS total, SUM(CASE WHEN r.status = '已转化' THEN 1 ELSE 0 END) AS converted
    FROM records r JOIN bases b ON b.id = r.base_id
    WHERE ${where} AND r.owner != ''
    GROUP BY r.owner, b.id ORDER BY b.sort_order, total DESC LIMIT 200
  `).all(...args).map((row) => ({
    owner: row.owner,
    baseId: row.base_id,
    baseName: row.base_name,
    baseColor: row.base_color,
    total: Number(row.total || 0),
    converted: Number(row.converted || 0),
    conversionRate: row.total ? Number(row.converted || 0) / Number(row.total) : 0
  }));

  return {
    version: {
      id: version.id,
      label: version.label,
      rowCount: version.row_count,
      publishedAt: version.published_at || version.created_at
    },
    kpis: {
      total,
      newUnconverted: Number(kpi.newUnconverted || 0),
      highPotential: Number(kpi.highPotential || 0),
      converted,
      followed,
      conversionRate: total ? converted / total : 0,
      followUpRate: total ? followed / total : 0
    },
    trend,
    sources,
    statuses,
    bases: baseRows,
    owners,
    ownerBreakdown
  };
}

function fillMonths(rows, from, to) {
  const map = new Map(rows.map((r) => [r.month, r]));
  if (!rows.length) return [];
  let start = from && /^\d{4}-\d{2}/.test(from) ? from.slice(0, 7) : rows[0].month;
  let end = to && /^\d{4}-\d{2}/.test(to) ? to.slice(0, 7) : rows[rows.length - 1].month;
  if (!start || !end || start > end) return rows;
  const out = [];
  let [y, m] = start.split('-').map(Number);
  for (let guard = 0; guard < 36; guard++) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    const row = map.get(key);
    out.push({ month: key, total: Number(row?.total || 0), converted: Number(row?.converted || 0) });
    if (key >= end) break;
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

function publicMeta(viewer) {
  const version = activeVersion();
  const settings = {};
  for (const key of Object.keys(DEFAULT_SETTINGS)) settings[key] = getSetting(key);
  let allBases = bases().filter((b) => b.active);
  if (viewer?.role === 'base') allBases = allBases.filter((b) => b.id === viewer.baseId);
  return {
    title: settings.dashboard_title,
    subtitle: settings.dashboard_subtitle,
    announcement: settings.announcement,
    dataNote: settings.data_note,
    kpiVisibility: safeJson(settings.kpi_visibility, []),
    visibleColumns: safeJson(settings.visible_columns, []),
    bases: allBases,
    viewer: viewer?.role === 'base'
      ? { role: 'base', baseId: viewer.baseId, baseName: viewer.baseName, baseColor: viewer.baseColor, username: viewer.username }
      : { role: 'admin', username: viewer?.username || null },
    version: version ? { label: version.label, rowCount: version.row_count, publishedAt: version.published_at || version.created_at } : null,
    updatedAt: version ? (version.published_at || version.created_at) : null
  };
}

function safeJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function adminStats() {
  const version = activeVersion();
  const total = version ? db.prepare('SELECT COUNT(*) AS n FROM records WHERE version_id = ?').get(version.id).n : 0;
  const baseCount = db.prepare('SELECT COUNT(*) AS n FROM bases WHERE active = 1').get().n;
  const userCount = db.prepare('SELECT COUNT(*) AS n FROM admin_users').get().n;
  const versions = db.prepare('SELECT * FROM versions ORDER BY id DESC LIMIT 5').all();
  const logs = db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 6').all();
  return {
    total: Number(total),
    baseCount: Number(baseCount),
    userCount: Number(userCount),
    version,
    versions,
    logs
  };
}

function requireAdmin(req, res) {
  const user = currentUser(req);
  if (!user) {
    sendJson(res, 401, { error: '未登录或登录已过期' });
    return null;
  }
  return user;
}

function ipOf(req) {
  return (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();
}

async function handleApi(req, res, url) {
  const p = url.pathname;
  const method = req.method;

  if (p === '/api/meta' && method === 'GET') {
    const viewer = requireViewer(req, res);
    if (!viewer) return;
    return sendJson(res, 200, publicMeta(viewer));
  }

  if (p === '/api/tables' && method === 'GET') {
    const viewer = requireViewer(req, res);
    if (!viewer) return;
    return sendJson(res, 200, { viewer, syncedAt: feishuCache()?.syncedAt || null, tables: getTables(viewer) });
  }

  if (p === '/api/rankings' && method === 'GET') {
    const viewer = requireViewer(req, res);
    if (!viewer) return;
    if (viewer.role !== 'admin') return sendJson(res, 403, { error: '业绩排行榜仅管理员可见' });
    return sendJson(res, 200, { viewer, syncedAt: feishuCache()?.syncedAt || null, boards: getRankings() });
  }

  if (p === '/api/admin/rankings' && method === 'PUT') {
    const user = requireAdmin(req, res);
    if (!user) return;
    const body = await readBody(req);
    if (!Array.isArray(body.boards)) return sendJson(res, 400, { error: 'boards 必须是数组' });
    saveRankings(body.boards);
    audit(user.u, '更新业绩排行数据', '', ipOf(req));
    return sendJson(res, 200, { ok: true });
  }

  if (p === '/api/session' && method === 'GET') {
    const viewer = resolveViewer(req);
    return sendJson(res, 200, { authenticated: Boolean(viewer), viewer });
  }

  if (p === '/api/login' && method === 'POST') {
    if (!checkLoginRate(ipOf(req))) return sendJson(res, 429, { error: '尝试次数过多，请 10 分钟后再试' });
    const body = await readBody(req);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const row = db.prepare(`
      SELECT bu.*, b.name AS base_name, b.color AS base_color, b.active AS base_active
      FROM base_users bu JOIN bases b ON b.id = bu.base_id WHERE bu.username = ?
    `).get(username);
    if (!row || !row.active || !row.base_active || !verifyPassword(password, row.password_hash)) {
      return sendJson(res, 401, { error: '账号或密码不正确' });
    }
    db.prepare('UPDATE base_users SET last_login_at = ? WHERE id = ?').run(nowIso(), row.id);
    audit(row.username, '基地账号登录', row.base_name, ipOf(req));
    res.setHeader('Set-Cookie', baseSessionCookie(createBaseSession(row.username, row.base_id, row.base_name)));
    return sendJson(res, 200, {
      ok: true,
      viewer: { role: 'base', baseId: row.base_id, baseName: row.base_name, baseColor: row.base_color, username: row.username }
    });
  }

  if (p === '/api/logout' && method === 'POST') {
    res.setHeader('Set-Cookie', clearBaseCookie());
    return sendJson(res, 200, { ok: true });
  }

  if (p === '/api/template.xlsx' && method === 'GET') {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ['基地', '客户姓名', '手机号', '来源类型', '负责人', '状态', '创建日期', '最近跟进', '标签', '备注'],
      ['武汉基地', '示例客户', '13800000000', '新用户直推未转化', '杨帆', '待跟进', '2026-10-19', '', '高意向', '示例行，导入前可删除'],
      ['武汉基地', '示例客户二', '13900000000', '高潜老用户', '刘伟', '跟进中', '2026-10-19', '2026-10-19', '已加微信', '']
    ]);
    ws['!cols'] = [{ wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 20 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 24 }];
    XLSX.utils.book_append_sheet(wb, ws, '转介绍名单');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.writeHead(200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="referral-import-template.xlsx"',
      'Content-Length': buffer.length,
      'Cache-Control': 'no-store'
    });
    return res.end(buffer);
  }

  if (p === '/api/overview' && method === 'GET') {
    const viewer = requireViewer(req, res);
    if (!viewer) return;
    const params = Object.fromEntries(url.searchParams.entries());
    return sendJson(res, 200, overviewData(params, viewer));
  }

  if (p === '/api/records' && method === 'GET') {
    const viewer = requireViewer(req, res);
    if (!viewer) return;
    const version = activeVersion();
    if (!version) return sendJson(res, 200, { rows: [], total: 0, page: 1, pageSize: 20 });
    const params = Object.fromEntries(url.searchParams.entries());
    if (viewer.role === 'base') params.base = String(viewer.baseId);
    const { clauses, values } = whereFilters(params);
    const where = ['r.version_id = ?', ...clauses].join(' AND ');
    const args = [version.id, ...values];
    const page = Math.max(1, Number(params.page || 1));
    const pageSize = Math.min(5000, Math.max(1, Number(params.pageSize || 20)));
    const sortMap = {
      createdAt: 'r.created_at',
      customerName: 'r.customer_name',
      status: 'r.status',
      owner: 'r.owner',
      base: 'b.name'
    };
    const sort = sortMap[params.sort] || 'r.created_at';
    const order = String(params.order || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    const total = db.prepare(`
      SELECT COUNT(*) AS n FROM records r JOIN bases b ON b.id = r.base_id WHERE ${where}
    `).get(...args).n;

    const rows = db.prepare(`
      SELECT r.*, b.name AS base_name, b.color AS base_color
      FROM records r JOIN bases b ON b.id = r.base_id
      WHERE ${where} ORDER BY ${sort} ${order}, r.id DESC LIMIT ? OFFSET ?
    `).all(...args, pageSize, (page - 1) * pageSize).map((r) => mapRecord(r, true));

    return sendJson(res, 200, { rows, total: Number(total), page, pageSize });
  }

  if (p === '/api/admin/me' && method === 'GET') {
    const user = currentUser(req);
    const setupRequired = db.prepare('SELECT COUNT(*) AS n FROM admin_users').get().n === 0;
    return sendJson(res, 200, {
      authenticated: Boolean(user),
      username: user?.u || null,
      setupRequired
    });
  }

  if (p === '/api/admin/setup' && method === 'POST') {
    const count = db.prepare('SELECT COUNT(*) AS n FROM admin_users').get().n;
    if (count > 0) return sendJson(res, 409, { error: '管理员已初始化，请直接登录' });
    const body = await readBody(req);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    if (username.length < 3) return sendJson(res, 400, { error: '用户名至少 3 个字符' });
    if (password.length < 6) return sendJson(res, 400, { error: '密码至少 6 个字符' });
    db.prepare('INSERT INTO admin_users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)')
      .run(username, hashPassword(password), 'admin', nowIso());
    audit(username, '初始化管理员', '创建首个管理员账号', ipOf(req));
    const token = createSession(username);
    res.setHeader('Set-Cookie', sessionCookie(token));
    return sendJson(res, 200, { ok: true, username });
  }

  if (p === '/api/admin/login' && method === 'POST') {
    if (!checkLoginRate(ipOf(req))) return sendJson(res, 429, { error: '尝试次数过多，请 10 分钟后再试' });
    const body = await readBody(req);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const user = db.prepare('SELECT * FROM admin_users WHERE username = ?').get(username);
    if (!user || !verifyPassword(password, user.password_hash)) {
      return sendJson(res, 401, { error: '用户名或密码不正确' });
    }
    audit(username, '登录后台', '', ipOf(req));
    res.setHeader('Set-Cookie', sessionCookie(createSession(username)));
    return sendJson(res, 200, { ok: true, username });
  }

  if (p === '/api/admin/logout' && method === 'POST') {
    res.setHeader('Set-Cookie', clearCookie());
    return sendJson(res, 200, { ok: true });
  }

  if (p === '/api/admin/stats' && method === 'GET') {
    if (!requireAdmin(req, res)) return;
    return sendJson(res, 200, adminStats());
  }

  if (p === '/api/admin/feishu/status' && method === 'GET') {
    if (!requireAdmin(req, res)) return;
    return sendJson(res, 200, feishuStatus());
  }

  if (p === '/api/admin/feishu/sync' && method === 'POST') {
    const user = requireAdmin(req, res);
    if (!user) return;
    try {
      const result = await syncFeishu();
      audit(user.u, '同步飞书多维表格', JSON.stringify(result.counts), ipOf(req));
      return sendJson(res, 200, { ok: true, ...result });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  if (p === '/api/admin/records' && method === 'GET') {
    if (!requireAdmin(req, res)) return;
    const version = activeVersion();
    if (!version) return sendJson(res, 200, { rows: [], total: 0 });
    const params = Object.fromEntries(url.searchParams.entries());
    const { clauses, values } = whereFilters(params);
    const where = ['r.version_id = ?', ...clauses].join(' AND ');
    const args = [version.id, ...values];
    const page = Math.max(1, Number(params.page || 1));
    const pageSize = Math.min(200, Math.max(1, Number(params.pageSize || 20)));
    const total = db.prepare(`SELECT COUNT(*) AS n FROM records r WHERE ${where}`).get(...args).n;
    const rows = db.prepare(`
      SELECT r.*, b.name AS base_name, b.color AS base_color
      FROM records r JOIN bases b ON b.id = r.base_id
      WHERE ${where} ORDER BY r.created_at DESC, r.id DESC LIMIT ? OFFSET ?
    `).all(...args, pageSize, (page - 1) * pageSize).map((r) => mapRecord(r, false));
    return sendJson(res, 200, { rows, total: Number(total), page, pageSize });
  }

  if (p === '/api/admin/records' && method === 'POST') {
    const user = requireAdmin(req, res);
    if (!user) return;
    const version = activeVersion();
    if (!version) return sendJson(res, 409, { error: '没有可用的数据版本' });
    const body = await readBody(req);
    const name = String(body.customerName || '').trim();
    const baseId = Number(body.baseId);
    if (!name) return sendJson(res, 400, { error: '客户姓名不能为空' });
    if (!baseId) return sendJson(res, 400, { error: '请选择基地' });
    const result = db.prepare(`
      INSERT INTO records (version_id, base_id, source_type, customer_name, phone, owner, status, created_at, last_follow_up, tags, note, created_at_db)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      version.id, baseId, String(body.sourceType || '新用户直推未转化'),
      name, String(body.phone || ''), String(body.owner || ''), String(body.status || '待跟进'),
      String(body.createdAt || new Date().toISOString().slice(0, 10)),
      String(body.lastFollowUp || ''), String(body.tags || ''), String(body.note || ''), nowIso()
    );
    refreshVersionCount(version.id);
    audit(user.u, '新增名单', `${name} / 基地 ${baseId}`, ipOf(req));
    return sendJson(res, 200, { ok: true, id: Number(result.lastInsertRowid) });
  }

  const recordMatch = p.match(/^\/api\/admin\/records\/(\d+)$/);
  if (recordMatch && (method === 'PUT' || method === 'DELETE')) {
    const user = requireAdmin(req, res);
    if (!user) return;
    const version = activeVersion();
    if (!version) return sendJson(res, 409, { error: '没有可用的数据版本' });
    const id = Number(recordMatch[1]);
    const existing = db.prepare('SELECT * FROM records WHERE id = ? AND version_id = ?').get(id, version.id);
    if (!existing) return sendJson(res, 404, { error: '记录不存在或不属于当前版本' });

    if (method === 'DELETE') {
      db.prepare('DELETE FROM records WHERE id = ? AND version_id = ?').run(id, version.id);
      refreshVersionCount(version.id);
      audit(user.u, '删除名单', `#${id} ${existing.customer_name}`, ipOf(req));
      return sendJson(res, 200, { ok: true });
    }

    const body = await readBody(req);
    db.prepare(`
      UPDATE records SET base_id = ?, source_type = ?, customer_name = ?, phone = ?, owner = ?, status = ?,
        created_at = ?, last_follow_up = ?, tags = ?, note = ? WHERE id = ? AND version_id = ?
    `).run(
      Number(body.baseId || existing.base_id),
      String(body.sourceType || existing.source_type),
      String(body.customerName || existing.customer_name).trim(),
      String(body.phone ?? existing.phone),
      String(body.owner ?? existing.owner),
      String(body.status || existing.status),
      String(body.createdAt || existing.created_at),
      String(body.lastFollowUp ?? existing.last_follow_up),
      String(body.tags ?? existing.tags),
      String(body.note ?? existing.note),
      id, version.id
    );
    audit(user.u, '编辑名单', `#${id}`, ipOf(req));
    return sendJson(res, 200, { ok: true });
  }

  if (p === '/api/admin/bases' && method === 'GET') {
    if (!requireAdmin(req, res)) return;
    const rows = bases().map((b) => ({
      ...b,
      recordCount: db.prepare('SELECT COUNT(*) AS n FROM records WHERE base_id = ?').get(b.id).n
    }));
    return sendJson(res, 200, rows);
  }

  if (p === '/api/admin/bases' && method === 'POST') {
    const user = requireAdmin(req, res);
    if (!user) return;
    const body = await readBody(req);
    const name = String(body.name || '').trim();
    if (!name) return sendJson(res, 400, { error: '基地名称不能为空' });
    try {
      const result = db.prepare('INSERT INTO bases (name, code, color, sort_order, active) VALUES (?, ?, ?, ?, 1)')
        .run(name, String(body.code || ''), String(body.color || '#3b82f6'), Number(body.sortOrder || 99));
      const baseId = Number(result.lastInsertRowid);
      const accountName = generateUsername(name);
      const accountPwd = generatePassword();
      db.prepare('INSERT INTO base_users (base_id, username, password_hash, active, created_at) VALUES (?, ?, ?, 1, ?)')
        .run(baseId, accountName, hashPassword(accountPwd), nowIso());
      upsertAccount({ baseName: name, username: accountName, password: accountPwd, loginUrl: '/login' });
      audit(user.u, '新增基地与账号', `${name} / ${accountName}`, ipOf(req));
      return sendJson(res, 200, { ok: true, id: baseId, account: { username: accountName, password: accountPwd } });
    } catch (err) {
      return sendJson(res, 409, { error: '基地名称已存在' });
    }
  }

  const baseMatch = p.match(/^\/api\/admin\/bases\/(\d+)$/);
  if (baseMatch && (method === 'PUT' || method === 'DELETE')) {
    const user = requireAdmin(req, res);
    if (!user) return;
    const id = Number(baseMatch[1]);
    const existing = db.prepare('SELECT * FROM bases WHERE id = ?').get(id);
    if (!existing) return sendJson(res, 404, { error: '基地不存在' });
    if (method === 'DELETE') {
      const count = db.prepare('SELECT COUNT(*) AS n FROM records WHERE base_id = ?').get(id).n;
      if (count > 0) return sendJson(res, 409, { error: `该基地下还有 ${count} 条名单，不能删除，可先停用` });
      const account = db.prepare('SELECT username FROM base_users WHERE base_id = ?').get(id);
      if (account) removeAccount(account.username);
      db.prepare('DELETE FROM base_users WHERE base_id = ?').run(id);
      db.prepare('DELETE FROM bases WHERE id = ?').run(id);
      audit(user.u, '删除基地', existing.name, ipOf(req));
      return sendJson(res, 200, { ok: true });
    }
    const body = await readBody(req);
    db.prepare('UPDATE bases SET name = ?, code = ?, color = ?, sort_order = ?, active = ? WHERE id = ?')
      .run(
        String(body.name || existing.name).trim(),
        String(body.code ?? existing.code),
        String(body.color || existing.color),
        Number(body.sortOrder ?? existing.sort_order),
        body.active === false ? 0 : 1,
        id
      );
    audit(user.u, '编辑基地', String(body.name || existing.name), ipOf(req));
    return sendJson(res, 200, { ok: true });
  }

  if (p === '/api/admin/base-accounts' && method === 'GET') {
    if (!requireAdmin(req, res)) return;
    const rows = db.prepare(`
      SELECT bu.id, bu.base_id AS baseId, bu.username, bu.active, bu.created_at AS createdAt,
        bu.last_login_at AS lastLoginAt, b.name AS baseName, b.color AS baseColor
      FROM base_users bu JOIN bases b ON b.id = bu.base_id
      ORDER BY b.sort_order, bu.id
    `).all();
    return sendJson(res, 200, rows);
  }

  const accountEditMatch = p.match(/^\/api\/admin\/base-accounts\/(\d+)$/);
  if (accountEditMatch && method === 'PUT') {
    const user = requireAdmin(req, res);
    if (!user) return;
    const row = db.prepare(`
      SELECT bu.*, b.name AS base_name FROM base_users bu JOIN bases b ON b.id = bu.base_id WHERE bu.id = ?
    `).get(Number(accountEditMatch[1]));
    if (!row) return sendJson(res, 404, { error: '账号不存在' });
    const body = await readBody(req);
    const username = String(body.username || row.username).trim();
    const newPassword = String(body.password || '');
    if (username.length < 3 || username.length > 64) {
      return sendJson(res, 400, { error: '账号长度需在 3–64 个字符之间' });
    }
    if (!/^[A-Za-z0-9._-]+$/.test(username)) {
      return sendJson(res, 400, { error: '账号只能包含字母、数字、点、下划线或短横线' });
    }
    const duplicate = db.prepare('SELECT id FROM base_users WHERE username = ? AND id != ?').get(username, row.id);
    if (duplicate) return sendJson(res, 409, { error: '该账号已被其他基地使用' });
    if (newPassword) {
      const strong = newPassword.length >= 8
        && /[A-Z]/.test(newPassword)
        && /[a-z]/.test(newPassword)
        && /[0-9]/.test(newPassword)
        && /[^A-Za-z0-9]/.test(newPassword);
      if (!strong) return sendJson(res, 400, { error: '密码至少 8 位，并同时包含大写字母、小写字母、数字和符号' });
    }
    db.prepare('UPDATE base_users SET username = ?, password_hash = ? WHERE id = ?')
      .run(username, newPassword ? hashPassword(newPassword) : row.password_hash, row.id);
    if (!updateAccountIdentity(row.username, username, newPassword)) {
      if (newPassword) upsertAccount({ baseName: row.base_name, username, password: newPassword, loginUrl: '/login' });
    }
    audit(user.u, '修改基地账号', `${row.base_name} / ${row.username} → ${username}`, ipOf(req));
    return sendJson(res, 200, { ok: true, username });
  }

  const accountResetMatch = p.match(/^\/api\/admin\/base-accounts\/(\d+)\/reset$/);
  if (accountResetMatch && method === 'POST') {
    const user = requireAdmin(req, res);
    if (!user) return;
    const row = db.prepare(`
      SELECT bu.*, b.name AS base_name FROM base_users bu JOIN bases b ON b.id = bu.base_id WHERE bu.id = ?
    `).get(Number(accountResetMatch[1]));
    if (!row) return sendJson(res, 404, { error: '账号不存在' });
    const pwd = generatePassword();
    db.prepare('UPDATE base_users SET password_hash = ? WHERE id = ?').run(hashPassword(pwd), row.id);
    if (!updateAccountPassword(row.username, pwd)) {
      upsertAccount({ baseName: row.base_name, username: row.username, password: pwd, loginUrl: '/login' });
    }
    audit(user.u, '重置基地账号密码', `${row.base_name} / ${row.username}`, ipOf(req));
    return sendJson(res, 200, { ok: true, username: row.username, password: pwd });
  }

  const accountToggleMatch = p.match(/^\/api\/admin\/base-accounts\/(\d+)\/toggle$/);
  if (accountToggleMatch && method === 'POST') {
    const user = requireAdmin(req, res);
    if (!user) return;
    const row = db.prepare('SELECT * FROM base_users WHERE id = ?').get(Number(accountToggleMatch[1]));
    if (!row) return sendJson(res, 404, { error: '账号不存在' });
    const active = row.active ? 0 : 1;
    db.prepare('UPDATE base_users SET active = ? WHERE id = ?').run(active, row.id);
    audit(user.u, active ? '启用基地账号' : '停用基地账号', row.username, ipOf(req));
    return sendJson(res, 200, { ok: true, active });
  }

  if (p === '/api/admin/settings' && method === 'GET') {
    if (!requireAdmin(req, res)) return;
    const out = {};
    for (const key of Object.keys(DEFAULT_SETTINGS)) out[key] = getSetting(key);
    out.kpiVisibility = safeJson(out.kpi_visibility, []);
    out.visibleColumns = safeJson(out.visible_columns, []);
    return sendJson(res, 200, out);
  }

  if (p === '/api/admin/settings' && method === 'PUT') {
    const user = requireAdmin(req, res);
    if (!user) return;
    const body = await readBody(req);
    const allowed = ['dashboard_title', 'dashboard_subtitle', 'announcement', 'data_note', 'kpi_visibility', 'visible_columns'];
    for (const key of allowed) {
      if (body[key] !== undefined) {
        const value = Array.isArray(body[key]) ? JSON.stringify(body[key]) : String(body[key]);
        setSetting(key, value);
      }
    }
    audit(user.u, '更新展示配置', '', ipOf(req));
    return sendJson(res, 200, { ok: true });
  }

  if (p === '/api/admin/versions' && method === 'GET') {
    if (!requireAdmin(req, res)) return;
    const rows = db.prepare(`
      SELECT v.*, (SELECT COUNT(*) FROM records r WHERE r.version_id = v.id) AS actual_count
      FROM versions v ORDER BY v.id DESC
    `).all();
    return sendJson(res, 200, { activeVersionId: Number(getSetting('active_version_id', '0')), rows });
  }

  const versionMatch = p.match(/^\/api\/admin\/versions\/(\d+)\/activate$/);
  if (versionMatch && method === 'POST') {
    const user = requireAdmin(req, res);
    if (!user) return;
    const id = Number(versionMatch[1]);
    const version = db.prepare('SELECT * FROM versions WHERE id = ?').get(id);
    if (!version) return sendJson(res, 404, { error: '版本不存在' });
    setSetting('active_version_id', id);
    audit(user.u, '切换数据版本', version.label, ipOf(req));
    return sendJson(res, 200, { ok: true });
  }

  if (p === '/api/admin/import/preview' && method === 'POST') {
    const user = requireAdmin(req, res);
    if (!user) return;
    const body = await readBody(req);
    if (!body.base64) return sendJson(res, 400, { error: '请选择要导入的文件' });
    const buffer = Buffer.from(String(body.base64), 'base64');
    if (buffer.length > 15 * 1024 * 1024) return sendJson(res, 413, { error: '文件超过 15MB' });
    let parsed;
    try {
      parsed = parseWorkbook(buffer, {
        bases: bases(),
        defaultBaseId: body.baseId,
        defaultSource: body.sourceType
      });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
    const draftId = crypto.randomUUID();
    db.prepare('INSERT INTO import_drafts (id, payload, created_by, created_at) VALUES (?, ?, ?, ?)')
      .run(draftId, JSON.stringify(parsed.rows), user.u, nowIso());
    return sendJson(res, 200, {
      draftId,
      fileName: String(body.fileName || '未命名文件'),
      sheetName: parsed.sheetName,
      headerRow: parsed.headerRow,
      headerFields: parsed.headerFields,
      stats: parsed.stats,
      errors: parsed.errors.slice(0, 50),
      warnings: parsed.warnings.slice(0, 50),
      preview: parsed.rows.slice(0, 20)
    });
  }

  if (p === '/api/admin/import/commit' && method === 'POST') {
    const user = requireAdmin(req, res);
    if (!user) return;
    const body = await readBody(req);
    const draft = db.prepare('SELECT * FROM import_drafts WHERE id = ?').get(String(body.draftId || ''));
    if (!draft) return sendJson(res, 404, { error: '导入草稿已失效，请重新上传' });
    const rows = JSON.parse(draft.payload);
    if (!rows.length) return sendJson(res, 400, { error: '没有可导入的数据' });

    const current = activeVersion();
    const mode = body.mode === 'replace' ? 'replace' : 'append';
    const label = String(body.label || `导入 ${new Date().toLocaleString('zh-CN')}`).slice(0, 100);

    db.exec('BEGIN');
    try {
      const version = db.prepare(
        'INSERT INTO versions (label, file_name, row_count, status, created_by, created_at, published_at) VALUES (?, ?, 0, ?, ?, ?, ?)'
      ).run(label, String(body.fileName || ''), 'published', user.u, nowIso(), nowIso());
      const versionId = Number(version.lastInsertRowid);

      let skippedDuplicates = 0;
      if (mode === 'append' && current) {
        const existing = db.prepare('SELECT * FROM records WHERE version_id = ?').all(current.id);
        const seen = new Set(existing.map((r) => `${r.base_id}|${r.customer_name}|${r.phone}|${r.source_type}`));
        const insert = db.prepare(`
          INSERT INTO records (version_id, base_id, source_type, customer_name, phone, owner, status, created_at, last_follow_up, tags, note, created_at_db)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const r of existing) {
          insert.run(versionId, r.base_id, r.source_type, r.customer_name, r.phone, r.owner, r.status, r.created_at, r.last_follow_up, r.tags, r.note, nowIso());
        }
        for (const r of rows) {
          const key = `${r.baseId}|${r.customerName}|${r.phone}|${r.sourceType}`;
          if (seen.has(key)) { skippedDuplicates++; continue; }
          seen.add(key);
          insert.run(versionId, r.baseId, r.sourceType, r.customerName, r.phone, r.owner, r.status, r.createdAt, r.lastFollowUp, r.tags, r.note, nowIso());
        }
      } else {
        const insert = db.prepare(`
          INSERT INTO records (version_id, base_id, source_type, customer_name, phone, owner, status, created_at, last_follow_up, tags, note, created_at_db)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const r of rows) {
          insert.run(versionId, r.baseId, r.sourceType, r.customerName, r.phone, r.owner, r.status, r.createdAt, r.lastFollowUp, r.tags, r.note, nowIso());
        }
      }

      const count = db.prepare('SELECT COUNT(*) AS n FROM records WHERE version_id = ?').get(versionId).n;
      db.prepare('UPDATE versions SET row_count = ? WHERE id = ?').run(count, versionId);
      setSetting('active_version_id', versionId);
      db.prepare('DELETE FROM import_drafts WHERE id = ?').run(draft.id);
      db.exec('COMMIT');

      audit(user.u, '导入并发布数据', `${label} · ${count} 条${skippedDuplicates ? ` · 跳过重复 ${skippedDuplicates} 条` : ''}`, ipOf(req));
      return sendJson(res, 200, { ok: true, versionId, rowCount: count, skippedDuplicates });
    } catch (err) {
      db.exec('ROLLBACK');
      return sendJson(res, 500, { error: `导入失败：${err.message}` });
    }
  }

  if (p === '/api/admin/audit' && method === 'GET') {
    if (!requireAdmin(req, res)) return;
    const rows = db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 200').all();
    return sendJson(res, 200, rows);
  }

  return sendJson(res, 404, { error: '接口不存在' });
}

function refreshVersionCount(versionId) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM records WHERE version_id = ?').get(versionId).n;
  db.prepare('UPDATE versions SET row_count = ? WHERE id = ?').run(count, versionId);
}

function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/' || pathname === '') pathname = '/index.html';
  if (pathname === '/records') pathname = '/records.html';
  if (pathname === '/admin') pathname = '/admin.html';
  if (pathname === '/login') pathname = '/login.html';
  if (pathname === '/tables') pathname = '/tables.html';
  if (pathname === '/rankings') pathname = '/rankings.html';
  if (pathname === '/compare') pathname = '/index.html';

  const filePath = path.join(PUBLIC_DIR, pathname.replace(/^\/+/, ''));
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(PUBLIC_DIR))) {
    return sendText(res, 403, 'Forbidden');
  }
  fs.stat(resolved, (err, stat) => {
    if (err || !stat.isFile()) {
      if (!path.extname(pathname)) {
        const fallback = path.join(PUBLIC_DIR, 'index.html');
        return fs.readFile(fallback, (e, data) => {
          if (e) return sendText(res, 404, 'Not found');
          res.writeHead(200, { 'Content-Type': MIME['.html'] });
          res.end(data);
        });
      }
      return sendText(res, 404, 'Not found');
    }
    const ext = path.extname(resolved).toLowerCase();
    const cache = 'no-cache';
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': cache
    });
    fs.createReadStream(resolved).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  if (url.pathname.startsWith('/api/')) {
    try {
      await handleApi(req, res, url);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) sendJson(res, 500, { error: err.message || '服务器内部错误' });
    }
    return;
  }
  serveStatic(req, res, url);
});

server.listen(PORT, HOST, () => {
  console.log(`Referral dashboard running at http://localhost:${PORT}`);
  console.log(`Admin: http://localhost:${PORT}/admin`);
});

const syncInterval = Number(process.env.FEISHU_SYNC_INTERVAL_SECONDS || 0);
if (syncInterval > 0 && process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET && process.env.FEISHU_APP_TOKEN) {
  const runSync = () => {
    syncFeishu()
      .then((result) => console.log(`[feishu] synced at ${result.syncedAt}`))
      .catch((err) => console.error(`[feishu] sync failed: ${err.message}`));
  };
  setTimeout(runSync, 5000);
  setInterval(runSync, syncInterval * 1000);
  console.log(`Feishu auto sync every ${syncInterval}s`);
}
