'use strict';

const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, '.env');
if (fs.existsSync(file)) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const text = line.trim();
    if (!text || text.startsWith('#')) continue;
    const idx = text.indexOf('=');
    if (idx < 1) continue;
    const key = text.slice(0, idx).trim();
    let value = text.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
