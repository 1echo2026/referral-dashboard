'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'dashboard.db'));
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS bases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    code TEXT DEFAULT '',
    color TEXT DEFAULT '#3b82f6',
    sort_order INTEGER DEFAULT 0,
    active INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,
    file_name TEXT DEFAULT '',
    row_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'published',
    created_by TEXT DEFAULT 'system',
    created_at TEXT NOT NULL,
    published_at TEXT
  );

  CREATE TABLE IF NOT EXISTS records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version_id INTEGER NOT NULL,
    base_id INTEGER NOT NULL,
    source_type TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    phone TEXT DEFAULT '',
    owner TEXT DEFAULT '',
    status TEXT DEFAULT '待跟进',
    created_at TEXT DEFAULT '',
    last_follow_up TEXT DEFAULT '',
    tags TEXT DEFAULT '',
    note TEXT DEFAULT '',
    created_at_db TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_records_version ON records(version_id);
  CREATE INDEX IF NOT EXISTS idx_records_base ON records(base_id);
  CREATE INDEX IF NOT EXISTS idx_records_date ON records(created_at);

  CREATE TABLE IF NOT EXISTS admin_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS base_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    base_id INTEGER NOT NULL,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    last_login_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_base_users_base ON base_users(base_id);

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    detail TEXT DEFAULT '',
    ip TEXT DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS import_drafts (
    id TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

const DEFAULT_SETTINGS = {
  dashboard_title: '转介绍数据看板',
  dashboard_subtitle: '2026 年基地转介绍 · 新用户直推未转化 + 高潜老用户',
  announcement: '',
  kpi_visibility: JSON.stringify(['total', 'newUnconverted', 'highPotential', 'conversionRate', 'followUpRate']),
  visible_columns: JSON.stringify(['base', 'customer', 'phone', 'source', 'owner', 'status', 'createdAt', 'lastFollowUp']),
  active_version_id: '',
  data_note: '数据来源于基地转介绍名单，前台仅展示已发布版本；姓名与手机号已脱敏。',
  admin_password_hint: ''
};

function getSetting(key, fallback = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : (fallback || DEFAULT_SETTINGS[key] || '');
}

function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value ?? ''));
}

function audit(actor, action, detail = '', ip = '') {
  db.prepare('INSERT INTO audit_logs (actor, action, detail, ip, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(actor, action, detail, ip, new Date().toISOString());
}

function nowIso() {
  return new Date().toISOString();
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pad(n) { return String(n).padStart(2, '0'); }
function dateStr(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

function seed() {
  const baseCount = db.prepare('SELECT COUNT(*) AS n FROM bases').get().n;
  if (baseCount > 0) return;

  const bases = [
    { name: '北京基地', code: 'BJ', color: '#2563eb', sort: 1 },
    { name: '郑州基地', code: 'ZZ', color: '#0891b2', sort: 2 },
    { name: '南京基地', code: 'NJ', color: '#7c3aed', sort: 3 },
    { name: '武汉基地', code: 'WH', color: '#3b82f6', sort: 4 },
    { name: '合肥基地', code: 'HF', color: '#059669', sort: 5 },
    { name: '西安基地', code: 'XA', color: '#d97706', sort: 6 },
    { name: '成都基地', code: 'CD', color: '#db2777', sort: 7 },
    { name: '新乡基地', code: 'XX', color: '#4f46e5', sort: 8 }
  ];
  const insertBase = db.prepare('INSERT INTO bases (name, code, color, sort_order, active) VALUES (?, ?, ?, ?, 1)');
  const baseIds = {};
  for (const b of bases) {
    const r = insertBase.run(b.name, b.code, b.color, b.sort);
    baseIds[b.name] = Number(r.lastInsertRowid);
  }

  const version = db.prepare(
    'INSERT INTO versions (label, file_name, row_count, status, created_by, created_at, published_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run('V2026.10.19 八基地初始数据', '26年基地转介绍明细.xlsx', 0, 'published', 'system', nowIso(), nowIso());
  const versionId = Number(version.lastInsertRowid);
  setSetting('active_version_id', versionId);

  const surnames = '张王李赵刘陈杨黄周吴徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾肖田董袁潘于蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦付方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤'.split('');
  const given = ['伟', '芳', '娜', '敏', '静', '丽', '强', '磊', '军', '洋', '勇', '艳', '杰', '娟', '涛', '明', '超', '秀英', '霞', '平', '刚', '桂英', '文', '辉', '建华', '婷', '浩', '凯', '雪', '鹏', '宇', '晨', '欣', '雨', '子涵', '思远', '嘉怡', '一诺', '梓萱', '俊杰'];
  const ownersByBase = {
    '北京基地': ['李晨', '王璐', '张弛', '刘洋', '赵倩'],
    '郑州基地': ['陈浩', '杨雪', '周航', '吴敏', '徐磊'],
    '南京基地': ['孙悦', '马超', '朱琳', '胡杰', '郭静'],
    '武汉基地': ['杨帆', '刘伟', '周凯', '陈静', '王莉'],
    '合肥基地': ['黄磊', '徐峰', '马丽', '林静', '赵敏'],
    '西安基地': ['高鹏', '罗娟', '郑涛', '梁晨', '谢宇'],
    '成都基地': ['何雪', '冯宇', '许婷', '邓凯', '曹阳'],
    '新乡基地': ['彭辉', '曾佳', '肖楠', '田浩', '董雨']
  };
  const tagsPool = ['高意向', '已加微信', '价格敏感', '待回访', '老客推荐', '活动线索', '近期到店', '需二次沟通'];
  const statuses = ['待跟进', '跟进中', '已转化', '暂缓'];
  const sources = ['新用户直推未转化', '高潜老用户'];

  const rnd = mulberry32(20261019);
  const insertRecord = db.prepare(`
    INSERT INTO records (version_id, base_id, source_type, customer_name, phone, owner, status, created_at, last_follow_up, tags, note, created_at_db)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const start = new Date(2026, 0, 2);
  const end = new Date(2026, 9, 19);
  const totalDays = Math.floor((end - start) / 86400000);
  let count = 0;

  db.exec('BEGIN');
  try {
    for (const b of bases) {
      const owners = ownersByBase[b.name];
      const rows = 52;
      for (let i = 0; i < rows; i++) {
        const day = new Date(start.getTime() + Math.floor(rnd() * totalDays) * 86400000);
        const source = rnd() < 0.56 ? sources[0] : sources[1];
        const statusRoll = rnd();
        let status;
        if (source === sources[0]) {
          status = statusRoll < 0.34 ? '待跟进' : statusRoll < 0.66 ? '跟进中' : statusRoll < 0.84 ? '已转化' : '暂缓';
        } else {
          status = statusRoll < 0.22 ? '待跟进' : statusRoll < 0.52 ? '跟进中' : statusRoll < 0.86 ? '已转化' : '暂缓';
        }
        const name = surnames[Math.floor(rnd() * surnames.length)] + given[Math.floor(rnd() * given.length)];
        const phone = `1${[3, 5, 7, 8, 9][Math.floor(rnd() * 5)]}${Math.floor(rnd() * 10)}****${String(Math.floor(rnd() * 10000)).padStart(4, '0')}`;
        const tags = [];
        const tagCount = 1 + Math.floor(rnd() * 2);
        for (let t = 0; t < tagCount; t++) {
          const tag = tagsPool[Math.floor(rnd() * tagsPool.length)];
          if (!tags.includes(tag)) tags.push(tag);
        }
        const follow = new Date(day.getTime() + Math.floor(1 + rnd() * 14) * 86400000);
        const followStr = follow <= end ? dateStr(follow) : '';
        insertRecord.run(
          versionId, baseIds[b.name], source, name, phone, owners[Math.floor(rnd() * owners.length)], status,
          dateStr(day), followStr, tags.join('、'), '', nowIso()
        );
        count++;
      }
    }
    db.prepare('UPDATE versions SET row_count = ? WHERE id = ?').run(count, versionId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  const { generatePassword, generateUsername, writeAccounts } = require('./accounts');
  const { hashPassword } = require('./auth');
  const insertUser = db.prepare(
    'INSERT INTO base_users (base_id, username, password_hash, active, created_at) VALUES (?, ?, ?, 1, ?)'
  );
  const accountRows = [];
  for (const b of bases) {
    const username = generateUsername(b.name);
    const pwd = generatePassword();
    insertUser.run(baseIds[b.name], username, hashPassword(pwd), nowIso());
    accountRows.push({ baseName: b.name, username, password: pwd, loginUrl: '/login' });
  }
  writeAccounts(accountRows);
}

seed();

module.exports = {
  db,
  getSetting,
  setSetting,
  audit,
  nowIso,
  DEFAULT_SETTINGS
};
