'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DATA_FILE = path.join(__dirname, 'data', 'tables.json');
const FEISHU_CACHE = path.join(__dirname, 'data', 'feishu-cache.json');

const DEFS = [
  {
    key: 'direct-unconverted',
    index: '表1',
    theme: 'mint',
    title: '26年转介绍销售直推（绑定关系）但未转化明细',
    tag: '精准意向新用户转化',
    note: '数据范围：26年截至9月20日，已绑定但尚未转化的转介绍用户明细。转介绍日期即绑定关系时间，建议从最新绑定用户开始优先沟通。',
    columns: [
      ['date', '转介绍日期'], ['gaofeng', '高峰'], ['manager', '经理'], ['supervisor', '主管'], ['leader', '组长'],
      ['name', '姓名'], ['empNo', '工号'], ['a', 'a'], ['b', 'b（老用户）'], ['c', 'c（新用户）'],
      ['activityId', '活动ID'], ['level', '转化等级'], ['amount', '转化金额']
    ]
  },
  {
    key: 'assigned-leads',
    index: '表2',
    theme: 'peach',
    title: '26年转介绍分配项目团队承接的辅导leads但未转化明细',
    tag: '待跟进新用户转化高清名单',
    note: '数据范围：26年截至9月28日，已分配的leads但尚未转化的转介绍用户明细。',
    columns: [
      ['date', '分配日期'], ['splitTime', '拆课时间'], ['grade', '年级'], ['userId', '用户ID'], ['phone', '手机号'],
      ['city', '城市'], ['gaofeng', '高峰'], ['manager', '经理'], ['receiver', '承接人'], ['firstLineSales', '一线承接销售'],
      ['amount', '转化金额']
    ]
  },
  {
    key: 'high-potential',
    index: '表1',
    theme: 'lavender',
    title: '26年以来推荐成功转化的老用户',
    tag: '可挖掘的高潜老用户名单',
    note: '使用指南：帮助老师们更有针对性地找到可邀约转介绍的老用户（数据截止 9.28）。近期有推荐记录，可继续邀请参与转介绍推荐。',
    columns: [
      ['userId', '老用户ID'], ['newTrial', '新体验用户数量'], ['newPaid', '新正价用户数量'], ['totalAmount', '累计金额'],
      ['sales', '销售'], ['empNo', '工号'], ['gaofeng', '高峰'], ['manager', '经理'], ['supervisor', '主管'], ['leader', '组长'],
      ['totalTrial', '累计体验'], ['totalPaid', '累计正价'], ['focus', '重点关注']
    ]
  },
  {
    key: 'diamond-unused',
    index: '表1',
    theme: 'sky',
    title: '26年转介绍钻石已解冻但还未消耗完毕',
    tag: '待跟进老用户高清名单',
    note: '数据范围：26年截至4月20日转介绍成功，钻石已发放解冻但未使用完的老用户。温馨提示：提醒用户到账后及时使用，避免过期。',
    columns: [
      ['date', '转介绍日期'], ['gaofeng', '高峰'], ['manager', '经理'], ['supervisor', '主管'], ['leader', '组长'],
      ['name', '姓名'], ['empNo', '工号'], ['a', 'a'], ['b', 'b'], ['c', 'c'],
      ['conversionDate', '转化日期'], ['amount', '转化金额'], ['diamonds', '应发放钻石']
    ]
  }
];

const BASES = ['北京基地', '郑州基地', '南京基地', '武汉基地', '合肥基地', '西安基地', '成都基地', '新乡基地'];
const GAOFENG = ['张楼', '李峰', '王磊', '赵宁', '陈涛', '孙浩', '周敏', '吴昊'];
const MANAGERS = ['刘浩然', '杨雪', '马超', '陈静', '黄磊', '高鹏', '何雪', '彭辉'];
const SUPERVISORS = ['李健', '周航', '朱琳', '周凯', '马丽', '郑涛', '许婷', '肖楠'];
const LEADERS = ['李智雄', '吴敏', '胡杰', '王莉', '赵敏', '梁晨', '邓凯', '田浩'];
const NAMES = ['张思恒', '袁凯华', '王浩宇', '陈光辉', '柯民', '胡胜', '周全营', '盖家文', '李珂', '李雨哲'];
const SALES = ['陈光辉', '胡胜', '周全营', '柯民', '盖家文', '李雨哲'];

function pad(n) { return String(n).padStart(2, '0'); }

function buildRows() {
  const out = {};
  for (const def of DEFS) out[def.key] = [];
  BASES.forEach((baseName, bi) => {
    const gaofeng = GAOFENG[bi];
    const manager = MANAGERS[bi];
    const supervisor = SUPERVISORS[bi];
    const leader = LEADERS[bi];
    for (let i = 0; i < 4; i++) {
      const day = 6 - i * 2;
      const date = `2026/8/${String(day).padStart(1, '0')}`;
      out['direct-unconverted'].push({
        baseName,
        date,
        gaofeng,
        manager,
        supervisor: i % 2 === 0 ? supervisor : '/',
        leader: i % 2 === 0 ? leader : '/',
        name: NAMES[(bi + i) % NAMES.length],
        empNo: `YD${2973 - i}${bi}`,
        a: `ig01@mesg.cor.td${bi}${i}a544c${i}`,
        b: `c2a455ac${bi}${i}a544c`,
        c: `b044e0e${bi}${i}`,
        activityId: ['13616', '13316', '13316', '13616'][i],
        level: ['高一', '高二', '高三', '高一'][i],
        amount: 0
      });
      out['assigned-leads'].push({
        baseName,
        date: `2026/9/${26 - i * 2}`,
        splitTime: `09:${26 - i}:18`,
        grade: ['高一', '高二', '高三', '高一'][i],
        userId: `c7a5ac95a4a${bi}${i}5719927${i}98`,
        phone: `15${bi}${i}${String(100000 + bi * 100 + i).slice(-6)}`,
        city: baseName.replace('基地', ''),
        gaofeng,
        manager,
        receiver: '柯民',
        firstLineSales: SALES[(bi + i) % SALES.length],
        amount: 0
      });
      out['high-potential'].push({
        baseName,
        userId: `urs-phoneyd.8904a2876e413${bi}${i}9a@163.com`,
        newTrial: 3 - (i % 2),
        newPaid: 3 - (i % 2),
        totalAmount: 14339 - bi * 120 - i * 300,
        sales: SALES[(bi + i) % SALES.length],
        empNo: `YD${22315 + bi}${i}`,
        gaofeng,
        manager,
        supervisor: i % 2 === 0 ? supervisor : '/',
        leader: i % 2 === 0 ? leader : '/',
        totalTrial: 3 - (i % 2),
        totalPaid: 3 - (i % 2),
        focus: (bi % 4) + 1
      });
      out['diamond-unused'].push({
        baseName,
        date: `2026/4/${20 - i * 3}`,
        gaofeng,
        manager,
        supervisor: i % 2 === 0 ? supervisor : '/',
        leader: i % 2 === 0 ? leader : '/',
        name: NAMES[(bi + i + 3) % NAMES.length],
        empNo: `YD${25660 + bi}${i}`,
        a: `03@mesg.cor.td${bi}${i}bb99a`,
        b: `c2a455ac${bi}${i}bb99a`,
        c: `b044e0e${bi}${i}bb99a`,
        conversionDate: `2026/4/${18 - i * 2}`,
        amount: 7197 - i * 400,
        diamonds: 50000
      });
    }
  });
  return out;
}

let cache = null;
function load() {
  if (cache) return cache;
  if (fs.existsSync(DATA_FILE)) {
    try {
      cache = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      return cache;
    } catch { /* fall through */ }
  }
  cache = buildRows();
  return cache;
}

function getTables(viewer) {
  let rows = load();
  if (fs.existsSync(FEISHU_CACHE)) {
    try {
      const synced = JSON.parse(fs.readFileSync(FEISHU_CACHE, 'utf8'));
      if (synced.tables) rows = { ...rows, ...synced.tables };
    } catch { /* ignore bad cache */ }
  }
  return DEFS.map((def) => {
    let list = rows[def.key] || [];
    if (viewer?.role === 'base') list = list.filter((r) => r.baseName === viewer.baseName);
    return { ...def, rows: list };
  });
}

function saveTable(key, rows) {
  if (!DEFS.some((d) => d.key === key)) throw new Error('未知的表格类型');
  const all = load();
  all[key] = rows;
  cache = all;
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(all, null, 2), 'utf8');
}

module.exports = { DEFS, getTables, saveTable, DATA_FILE };
