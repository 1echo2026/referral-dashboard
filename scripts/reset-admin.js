'use strict';

const readline = require('node:readline');
const { db } = require('../db');

const count = db.prepare('SELECT COUNT(*) AS n FROM admin_users').get().n;
if (!count) {
  console.log('当前没有管理员账号。打开 /admin 即可进入首次初始化页面。');
  process.exit(0);
}

function reset() {
  db.prepare('DELETE FROM admin_users').run();
  console.log(`已删除 ${count} 个管理员账号。请重新打开 /admin 初始化。`);
}

if (process.argv.includes('--yes')) {
  reset();
  process.exit(0);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question(`将删除 ${count} 个管理员账号并回到初始化页面。输入 RESET 确认：`, (answer) => {
  rl.close();
  if (answer.trim() === 'RESET') reset();
  else console.log('已取消。');
});
