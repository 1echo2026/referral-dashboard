'use strict';

const { db, setSetting, nowIso, audit } = require('../db');
const { hashPassword } = require('../auth');
const { BASE_META, generatePassword, generateUsername, readAccounts, writeAccounts } = require('../accounts');

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

const surnames = '张王李赵刘陈杨黄周吴徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾肖田董袁潘于蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦付方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃戴莫孔向汤'.split('');
const given = ['伟', '芳', '娜', '敏', '静', '丽', '强', '磊', '军', '洋', '勇', '艳', '杰', '娟', '涛', '明', '超', '秀英', '霞', '平', '刚', '桂英', '文', '辉', '建华', '婷', '浩', '凯', '雪', '鹏', '宇', '晨', '欣', '雨', '子涵', '思远', '嘉怡', '一诺', '梓萱', '俊杰'];
const tagsPool = ['高意向', '已加微信', '价格敏感', '待回访', '老客推荐', '活动线索', '近期到店', '需二次沟通'];

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
const pad = (x) => String(x).padStart(2, '0');
const dateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

console.log('before:', {
  bases: db.prepare('SELECT COUNT(*) AS n FROM bases').get().n,
  records: db.prepare('SELECT COUNT(*) AS n FROM records').get().n,
  versions: db.prepare('SELECT COUNT(*) AS n FROM versions').get().n
});

db.exec('BEGIN');
try {
  db.prepare('DELETE FROM records').run();
  db.prepare('DELETE FROM versions').run();
  db.prepare('DELETE FROM bases').run();
  db.prepare('DELETE FROM base_users').run();

  const insertBase = db.prepare('INSERT INTO bases (name, code, color, sort_order, active) VALUES (?, ?, ?, ?, 1)');
  const baseIds = {};
  for (const b of bases) {
    const r = insertBase.run(b.name, b.code, b.color, b.sort);
    baseIds[b.name] = Number(r.lastInsertRowid);
  }

  const version = db.prepare(
    'INSERT INTO versions (label, file_name, row_count, status, created_by, created_at, published_at) VALUES (?, ?, 0, ?, ?, ?, ?)'
  ).run('V2026.10.19 八基地初始数据', '26年八基地转介绍明细.xlsx', 'published', 'system', nowIso(), nowIso());
  const versionId = Number(version.lastInsertRowid);
  setSetting('active_version_id', versionId);

  const insertRecord = db.prepare(`
    INSERT INTO records (version_id, base_id, source_type, customer_name, phone, owner, status, created_at, last_follow_up, tags, note, created_at_db)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const rnd = mulberry32(20261019);
  const start = new Date(2026, 0, 2);
  const end = new Date(2026, 9, 19);
  const totalDays = Math.floor((end - start) / 86400000);
  let count = 0;

  for (const b of bases) {
    const owners = ownersByBase[b.name];
    for (let i = 0; i < 52; i++) {
      const day = new Date(start.getTime() + Math.floor(rnd() * totalDays) * 86400000);
      const source = rnd() < 0.56 ? '新用户直推未转化' : '高潜老用户';
      const roll = rnd();
      let status;
      if (source === '新用户直推未转化') status = roll < 0.34 ? '待跟进' : roll < 0.66 ? '跟进中' : roll < 0.84 ? '已转化' : '暂缓';
      else status = roll < 0.22 ? '待跟进' : roll < 0.52 ? '跟进中' : roll < 0.86 ? '已转化' : '暂缓';
      const name = surnames[Math.floor(rnd() * surnames.length)] + given[Math.floor(rnd() * given.length)];
      const phone = `1${[3, 5, 7, 8, 9][Math.floor(rnd() * 5)]}${Math.floor(rnd() * 10)}****${String(Math.floor(rnd() * 10000)).padStart(4, '0')}`;
      const tags = [];
      for (let t = 0; t < 1 + Math.floor(rnd() * 2); t++) {
        const tag = tagsPool[Math.floor(rnd() * tagsPool.length)];
        if (!tags.includes(tag)) tags.push(tag);
      }
      const follow = new Date(day.getTime() + Math.floor(1 + rnd() * 14) * 86400000);
      insertRecord.run(
        versionId, baseIds[b.name], source, name, phone,
        owners[Math.floor(rnd() * owners.length)], status, dateStr(day),
        follow <= end ? dateStr(follow) : '', tags.join('、'), '', nowIso()
      );
      count++;
    }
  }
  db.prepare('UPDATE versions SET row_count = ? WHERE id = ?').run(count, versionId);

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
  db.exec('COMMIT');
  audit('system', '升级为八基地与基地账号', `${count} 条演示数据 / ${bases.length} 个基地账号`, '127.0.0.1');
  console.log(`done: ${count} records, ${bases.length} bases, ${accountRows.length} accounts`);
  console.log(`accounts file: ${require('../accounts').CSV_FILE}`);
} catch (err) {
  db.exec('ROLLBACK');
  console.error('migration failed:', err.message);
  process.exit(1);
}
