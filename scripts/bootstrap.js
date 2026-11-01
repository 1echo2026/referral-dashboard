'use strict';

/**
 * 部署初始化脚本（Render 等平台使用）
 *
 * 免费平台的实例磁盘不持久，重启后 SQLite 会被重置。
 * 本脚本在 server.js 启动前执行，从环境变量重建：
 *   - 管理员账号：ADMIN_USERNAME / ADMIN_PASSWORD
 *   - 基地与基地账号：BASE_ACCOUNTS（JSON 数组）
 *     [{ "name": "北京基地", "code": "BJ", "color": "#2563eb", "sortOrder": 1,
 *        "username": "bj-ops-xxxx", "password": "..." }, ...]
 *
 * 本地运行时（无这些环境变量）行为不变，直接跳过。
 */

require('../env');

const { db, nowIso, audit } = require('../db');
const { hashPassword } = require('../auth');
const { writeAccounts } = require('../accounts');

let changed = false;

// 1. 管理员账号：admin_users 表为空且提供了环境变量时创建
const adminUser = process.env.ADMIN_USERNAME;
const adminPass = process.env.ADMIN_PASSWORD;
if (adminUser && adminPass) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM admin_users').get().n;
  if (count === 0) {
    db.prepare('INSERT INTO admin_users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)')
      .run(adminUser, hashPassword(adminPass), 'admin', nowIso());
    audit(adminUser, '初始化管理员', 'bootstrap 环境变量', '127.0.0.1');
    console.log(`[bootstrap] admin created: ${adminUser}`);
    changed = true;
  }
}

// 2. 基地 + 基地账号：bases 表为空且提供了 BASE_ACCOUNTS 时重建
const accountsJson = process.env.BASE_ACCOUNTS;
if (accountsJson) {
  let accounts;
  try {
    accounts = JSON.parse(accountsJson);
  } catch (err) {
    console.error('[bootstrap] BASE_ACCOUNTS 不是合法 JSON，跳过基地初始化：', err.message);
    process.exit(1);
  }
  if (!Array.isArray(accounts) || accounts.length === 0) {
    console.error('[bootstrap] BASE_ACCOUNTS 必须是非空数组，跳过基地初始化');
    process.exit(1);
  }

  const baseCount = db.prepare('SELECT COUNT(*) AS n FROM bases').get().n;
  if (baseCount === 0) {
    const insertBase = db.prepare('INSERT INTO bases (name, code, color, sort_order, active) VALUES (?, ?, ?, ?, 1)');
    const insertUser = db.prepare('INSERT INTO base_users (base_id, username, password_hash, active, created_at) VALUES (?, ?, ?, 1, ?)');
    const csvRows = [];
    for (const a of accounts) {
      if (!a.name || !a.username || !a.password) {
        console.error(`[bootstrap] 基地 ${JSON.stringify(a)} 缺少 name/username/password，跳过`);
        continue;
      }
      const r = insertBase.run(a.name, String(a.code || ''), String(a.color || '#3b82f6'), Number(a.sortOrder ?? 99));
      const baseId = Number(r.lastInsertRowid);
      insertUser.run(baseId, a.username, hashPassword(a.password), nowIso());
      csvRows.push({ baseName: a.name, username: a.username, password: a.password, loginUrl: '/login' });
      console.log(`[bootstrap] base created: ${a.name} / ${a.username}`);
    }
    if (csvRows.length) {
      writeAccounts(csvRows);
      audit('system', '初始化基地与账号', `${csvRows.length} 个基地`, '127.0.0.1');
      changed = true;
    }
  }
}

if (changed) console.log('[bootstrap] done.');
else console.log('[bootstrap] nothing to do (db already initialized or env vars missing).');
