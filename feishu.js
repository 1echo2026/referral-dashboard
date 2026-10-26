'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DEFS } = require('./tables');
const { BOARDS } = require('./rankings');

const CACHE_FILE = path.join(__dirname, 'data', 'feishu-cache.json');
const API_BASE = process.env.FEISHU_BASE_URL || 'https://open.feishu.cn/open-apis';

const TABLE_ENV = {
  'direct-unconverted': 'FEISHU_TABLE_DIRECT',
  'assigned-leads': 'FEISHU_TABLE_ASSIGNED',
  'high-potential': 'FEISHU_TABLE_HIGH',
  'diamond-unused': 'FEISHU_TABLE_DIAMOND'
};
const RANK_ENV = {
  consultant: 'FEISHU_TABLE_RANK_CONSULTANT',
  supervisor: 'FEISHU_TABLE_RANK_SUPERVISOR',
  leader: 'FEISHU_TABLE_RANK_LEADER'
};
const BASE_ALIASES = ['北京基地', '郑州基地', '南京基地', '武汉基地', '合肥基地', '西安基地', '成都基地', '新乡基地', '新世界'];
const BASE_NAMES = new Set(BASE_ALIASES);

function envConfig() {
  return {
    appId: process.env.FEISHU_APP_ID || '',
    appSecret: process.env.FEISHU_APP_SECRET || '',
    appToken: process.env.FEISHU_APP_TOKEN || '',
    tables: Object.fromEntries(Object.entries(TABLE_ENV).map(([key, env]) => [key, process.env[env] || ''])),
    rankings: Object.fromEntries(Object.entries(RANK_ENV).map(([key, env]) => [key, process.env[env] || '']))
  };
}

function configStatus() {
  const cfg = envConfig();
  const tableIds = [...Object.values(cfg.tables), ...Object.values(cfg.rankings)].filter(Boolean);
  const cache = readCache();
  return {
    appIdConfigured: Boolean(cfg.appId),
    appSecretConfigured: Boolean(cfg.appSecret),
    appTokenConfigured: Boolean(cfg.appToken),
    tableCount: tableIds.length,
    expectedTableCount: Object.keys(TABLE_ENV).length + Object.keys(RANK_ENV).length,
    tableIds: Object.fromEntries([
      ...Object.entries(cfg.tables).map(([k, v]) => [k, Boolean(v)]),
      ...Object.entries(cfg.rankings).map(([k, v]) => [`rank-${k}`, Boolean(v)])
    ]),
    lastSync: cache?.syncedAt || null,
    counts: cache?.counts || null
  };
}

function readCache() {
  if (!fs.existsSync(CACHE_FILE)) return null;
  try { return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch { return null; }
}

function normalizeHeader(value) {
  return String(value ?? '')
    .replace(/[\s\u3000]/g, '')
    .replace(/[（(].*?[）)]/g, '')
    .replace(/[：:*＊]/g, '')
    .trim();
}

function asText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join('、');
  if (typeof value === 'object') {
    if (value.text !== undefined) return asText(value.text);
    if (value.name !== undefined) return asText(value.name);
    if (value.value !== undefined) return asText(value.value);
    if (value.link !== undefined) return asText(value.link);
  }
  return String(value);
}

function asNumber(value) {
  if (typeof value === 'number') return value;
  const text = asText(value).replace(/[,，¥￥\s]/g, '');
  const num = Number(text);
  return Number.isFinite(num) ? num : 0;
}

function asDate(value) {
  if (typeof value === 'number' && value > 1e11) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) {
      const pad = (x) => String(x).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }
  }
  return asText(value);
}

function normalizeBase(value) {
  const text = asText(value).trim();
  if (!text) return '';
  const exact = BASE_ALIASES.find((b) => b === text || b.replace('基地', '') === text);
  if (exact) return exact;
  const partial = BASE_ALIASES.find((b) => text.includes(b) || b.includes(text));
  return partial || text;
}

function buildFieldMap(def) {
  const map = {};
  for (const [key, label] of def.columns) {
    if (key === 'rank' || key === 'rankLabel' || key === 'rate') continue;
    map[normalizeHeader(label)] = key;
    map[normalizeHeader(key)] = key;
  }
  map['基地'] = 'baseName';
  map['基地名称'] = 'baseName';
  map['所属基地'] = 'baseName';
  map['城市'] = 'baseName';
  return map;
}

function normalizeTableRows(def, records) {
  const fieldMap = buildFieldMap(def);
  const out = [];
  for (const record of records) {
    const fields = record.fields || record || {};
    const row = { baseName: '' };
    for (const [field, value] of Object.entries(fields)) {
      const key = fieldMap[normalizeHeader(field)];
      if (!key) continue;
      if (key === 'baseName') {
        row.baseName = normalizeBase(value);
        if (def.key === 'assigned-leads') row.city = asText(value);
      } else if (['amount', 'target', 'performance', 'newTrial', 'newPaid', 'totalAmount', 'totalTrial', 'totalPaid', 'focus', 'diamonds'].includes(key)) row[key] = asNumber(value);
      else if (['date', 'conversionDate', 'splitTime'].includes(key)) row[key] = asDate(value);
      else row[key] = asText(value);
    }
    if (!row.baseName) row.baseName = '未分配';
    out.push(row);
  }
  return out;
}

function normalizeRankingRows(board, records) {
  const nameLabels = board.key === 'consultant' ? ['辅导姓名', '姓名'] : board.key === 'supervisor' ? ['主管'] : ['组长'];
  const performanceLabels = ['辅导直推业绩', '辅导业绩', '业绩'];
  const fieldMap = {};
  for (const label of ['基地', '城市', ...nameLabels, ...performanceLabels, '目标', '目标完成度']) {
    const key = label === '基地' || label === '城市' ? 'baseName'
      : nameLabels.includes(label) ? 'name'
        : performanceLabels.includes(label) ? 'performance'
          : label === '目标' ? 'target' : 'rate';
    fieldMap[normalizeHeader(label)] = key;
  }
  const rows = [];
  for (const record of records) {
    const fields = record.fields || record || {};
    const row = { baseName: '', name: '', performance: 0, target: 0, rate: 0 };
    for (const [field, value] of Object.entries(fields)) {
      const key = fieldMap[normalizeHeader(field)];
      if (!key) continue;
      if (key === 'baseName') row.baseName = normalizeBase(value);
      else if (key === 'name') row.name = asText(value);
      else if (key === 'target' || key === 'performance') row[key] = asNumber(value);
      else if (key === 'rate') row.rate = asNumber(value);
    }
    if (!row.name) continue;
    if (!row.rate && row.target) row.rate = Math.round((row.performance / row.target) * 100);
    rows.push(row);
  }
  rows.sort((a, b) => b.performance - a.performance);
  return rows.map((row, i) => ({
    ...row,
    rank: i + 1,
    rankLabel: i === 0 ? 'TOP1 👑' : i === 1 ? 'TOP2 🥈' : i === 2 ? 'TOP3 🥉' : ''
  }));
}

async function getToken(cfg) {
  const res = await fetch(`${API_BASE}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ app_id: cfg.appId, app_secret: cfg.appSecret })
  });
  const data = await res.json();
  if (!res.ok || data.code !== 0 || !data.tenant_access_token) {
    throw new Error(`飞书鉴权失败：${data.msg || res.status}`);
  }
  return data.tenant_access_token;
}

async function fetchRecords(token, appToken, tableId) {
  let pageToken = '';
  const records = [];
  for (let guard = 0; guard < 50; guard++) {
    const params = new URLSearchParams({ page_size: '500' });
    if (pageToken) params.set('page_token', pageToken);
    const res = await fetch(`${API_BASE}/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records?${params}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok || data.code !== 0) throw new Error(`读取飞书表失败：${data.msg || res.status}`);
    const items = data.data?.items || [];
    records.push(...items);
    if (!data.data?.has_more) break;
    pageToken = data.data.page_token || '';
    if (!pageToken) break;
  }
  return records;
}

async function listTables() {
  const cfg = envConfig();
  if (!cfg.appId || !cfg.appSecret) throw new Error('未配置 FEISHU_APP_ID 或 FEISHU_APP_SECRET');
  if (!cfg.appToken) throw new Error('未配置 FEISHU_APP_TOKEN');
  const token = await getToken(cfg);
  const tables = [];
  let pageToken = '';
  for (let guard = 0; guard < 20; guard++) {
    const params = new URLSearchParams({ page_size: '100' });
    if (pageToken) params.set('page_token', pageToken);
    const res = await fetch(`${API_BASE}/bitable/v1/apps/${encodeURIComponent(cfg.appToken)}/tables?${params}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok || data.code !== 0) throw new Error(`读取飞书数据表失败：${data.msg || res.status}`);
    tables.push(...(data.data?.items || []).map((t) => ({ tableId: t.table_id, name: t.name })));
    if (!data.data?.has_more) break;
    pageToken = data.data.page_token || '';
    if (!pageToken) break;
  }
  return tables;
}

async function doSync() {
  const cfg = envConfig();
  if (!cfg.appId || !cfg.appSecret) throw new Error('未配置 FEISHU_APP_ID 或 FEISHU_APP_SECRET');
  if (!cfg.appToken) throw new Error('未配置 FEISHU_APP_TOKEN');
  const token = await getToken(cfg);
  const tables = {};
  const counts = { tables: {}, rankings: {} };

  for (const def of DEFS) {
    const tableId = cfg.tables[def.key];
    if (!tableId) continue;
    const records = await fetchRecords(token, cfg.appToken, tableId);
    tables[def.key] = normalizeTableRows(def, records);
    counts.tables[def.key] = tables[def.key].length;
  }

  const rankings = {};
  for (const board of BOARDS) {
    const tableId = cfg.rankings[board.key];
    if (!tableId) continue;
    const records = await fetchRecords(token, cfg.appToken, tableId);
    rankings[board.key] = normalizeRankingRows(board, records);
    counts.rankings[board.key] = rankings[board.key].length;
  }

  const payload = { version: 1, syncedAt: new Date().toISOString(), tables, rankings, counts };
  fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(payload, null, 2), 'utf8');
  return { syncedAt: payload.syncedAt, counts };
}

let inFlight = null;
function syncFeishu() {
  if (inFlight) return inFlight;
  inFlight = doSync().finally(() => { inFlight = null; });
  return inFlight;
}

module.exports = {
  CACHE_FILE,
  configStatus,
  syncFeishu,
  normalizeTableRows,
  normalizeRankingRows,
  normalizeBase,
  readCache,
  listTables
};
