'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

function loadSecret() {
  const env = process.env.SESSION_SECRET;
  if (env && env.length >= 24) return env;
  const file = path.join(DATA_DIR, '.session-secret');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const secret = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

const SECRET = loadSecret();
const ADMIN_COOKIE = 'rd_session';
const BASE_COOKIE = 'rd_base_session';
const MAX_AGE = 8 * 60 * 60 * 1000;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  try {
    const [salt, hash] = String(stored).split(':');
    const candidate = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(hash, 'hex');
    return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

function sign(value) {
  return crypto.createHmac('sha256', SECRET).update(value).digest('base64url');
}

function createToken(data) {
  const payload = Buffer.from(JSON.stringify({ ...data, exp: Date.now() + MAX_AGE })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function readToken(token) {
  if (!token || !token.includes('.')) return null;
  const [payload, signature] = token.split('.');
  const expected = sign(payload);
  if (signature.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.u || !data.exp || data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

function createSession(username) {
  return createToken({ u: username, role: 'admin' });
}

function createBaseSession(username, baseId, baseName) {
  return createToken({ u: username, role: 'base', baseId, baseName });
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function cookieHeader(name, token) {
  return `${name}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(MAX_AGE / 1000)}`;
}

function sessionCookie(token) {
  return cookieHeader(ADMIN_COOKIE, token);
}

function baseSessionCookie(token) {
  return cookieHeader(BASE_COOKIE, token);
}

function clearCookie() {
  return `${ADMIN_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

function clearBaseCookie() {
  return `${BASE_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

function currentUser(req) {
  const data = readToken(parseCookies(req)[ADMIN_COOKIE]);
  if (!data) return null;
  if (data.role && data.role !== 'admin') return null;
  return data;
}

function currentBaseUser(req) {
  const data = readToken(parseCookies(req)[BASE_COOKIE]);
  if (!data || data.role !== 'base') return null;
  return data;
}

const loginAttempts = new Map();

function checkLoginRate(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip) || { count: 0, reset: now + 10 * 60 * 1000 };
  if (entry.reset < now) {
    entry.count = 0;
    entry.reset = now + 10 * 60 * 1000;
  }
  entry.count++;
  loginAttempts.set(ip, entry);
  return entry.count <= 20;
}

module.exports = {
  hashPassword,
  verifyPassword,
  createSession,
  createBaseSession,
  currentUser,
  currentBaseUser,
  sessionCookie,
  baseSessionCookie,
  clearCookie,
  clearBaseCookie,
  checkLoginRate
};
