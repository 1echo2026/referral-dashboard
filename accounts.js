'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DATA_DIR = path.join(__dirname, 'data');
const CSV_FILE = path.join(DATA_DIR, 'base-accounts.csv');
fs.mkdirSync(DATA_DIR, { recursive: true });

const BASE_META = {
  '北京基地': { code: 'bj', color: '#2563eb' },
  '郑州基地': { code: 'zz', color: '#0891b2' },
  '南京基地': { code: 'nj', color: '#7c3aed' },
  '武汉基地': { code: 'wh', color: '#3b82f6' },
  '合肥基地': { code: 'hf', color: '#059669' },
  '西安基地': { code: 'xa', color: '#d97706' },
  '成都基地': { code: 'cd', color: '#db2777' },
  '新乡基地': { code: 'xx', color: '#4f46e5' }
};

const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const DIGIT = '23456789';
const SYMBOL = '!#$%^&*?';
const ALL = UPPER + LOWER + DIGIT + SYMBOL;

function pick(chars) {
  return chars[crypto.randomInt(0, chars.length)];
}

function shuffle(chars) {
  const arr = [...chars];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.join('');
}

function generatePassword(length = 18) {
  const required = [pick(UPPER), pick(LOWER), pick(DIGIT), pick(SYMBOL)];
  const rest = Array.from({ length: Math.max(4, length - required.length) }, () => pick(ALL));
  return shuffle(required.concat(rest).join(''));
}

function generateUsername(baseName) {
  const meta = BASE_META[baseName] || { code: 'base' };
  const suffix = Array.from({ length: 4 }, () => pick('abcdefghjkmnpqrstuvwxyz23456789')).join('');
  return `${meta.code}-ops-${suffix}`;
}

function parseCsvLine(line) {
  const out = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') quoted = false;
      else current += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(current); current = ''; }
    else current += ch;
  }
  out.push(current);
  return out;
}

function readAccounts() {
  if (!fs.existsSync(CSV_FILE)) return [];
  const text = fs.readFileSync(CSV_FILE, 'utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length <= 1) return [];
  return lines.slice(1).map((line) => {
    const cols = parseCsvLine(line);
    return { baseName: cols[0] || '', username: cols[1] || '', password: cols[2] || '', loginUrl: cols[3] || '/login' };
  }).filter((r) => r.baseName && r.username);
}

function writeAccounts(rows) {
  const header = ['基地', '登录账号', '密码', '登录地址'];
  const lines = [header.join(',')];
  for (const row of rows) {
    const values = [row.baseName, row.username, row.password, row.loginUrl || '/login'];
    lines.push(values.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','));
  }
  fs.writeFileSync(CSV_FILE, '\uFEFF' + lines.join('\r\n') + '\r\n', { encoding: 'utf8', mode: 0o600 });
}

function upsertAccount(row) {
  const rows = readAccounts();
  const index = rows.findIndex((r) => r.username === row.username);
  if (index >= 0) rows[index] = { ...rows[index], ...row };
  else rows.push(row);
  writeAccounts(rows);
  return rows;
}

function findAccount(username) {
  return readAccounts().find((r) => r.username === username) || null;
}

function updateAccountPassword(username, password) {
  const rows = readAccounts();
  const row = rows.find((r) => r.username === username);
  if (!row) return false;
  row.password = password;
  writeAccounts(rows);
  return true;
}

function updateAccountIdentity(oldUsername, newUsername, newPassword) {
  const rows = readAccounts();
  const row = rows.find((r) => r.username === oldUsername);
  if (!row) return false;
  row.username = newUsername;
  if (newPassword) row.password = newPassword;
  writeAccounts(rows);
  return true;
}

function removeAccount(username) {
  const rows = readAccounts().filter((r) => r.username !== username);
  writeAccounts(rows);
}

module.exports = {
  BASE_META,
  CSV_FILE,
  generatePassword,
  generateUsername,
  readAccounts,
  writeAccounts,
  upsertAccount,
  findAccount,
  updateAccountPassword,
  updateAccountIdentity,
  removeAccount
};
