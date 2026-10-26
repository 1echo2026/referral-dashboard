'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DATA_FILE = path.join(__dirname, 'data', 'rankings.json');
const FEISHU_CACHE = path.join(__dirname, 'data', 'feishu-cache.json');

const consultant = [
  ['西安', '高界', 34100], ['西安', '姚先慧', 33960], ['合肥', '闵悦', 33933],
  ['南京', '崔红宇', 25840], ['西安', '陈钟', 23580], ['成都', '余迪', 21000],
  ['西安', '李泽宇', 20940], ['合肥', '曹跃', 20800], ['成都', '容宇', 20629],
  ['成都', '符拓宇', 19900], ['西安', '许佳萍', 19620], ['合肥', '王伟', 18920],
  ['西安', '张峻于', 18920], ['合肥', '潘青松', 18180], ['合肥', '余先娥', 18180],
  ['合肥', '汪慧敏', 17240], ['成都', '魏先岭', 16946], ['合肥', '李文龙', 16940],
  ['合肥', '刘佳佳', 16320], ['合肥', '任玉娟', 16300], ['西安', '张楠', 15680],
  ['成都', '蒙博', 15560], ['成都', '王宇', 15560], ['成都', '唐思舟', 15520],
  ['西安', '张家瑞', 14800]
].map(([base, name, performance], i) => ({ rank: i + 1, base, name, performance }));

const supervisor = [
  ['合肥', '陆婷婷', 57661, 188889], ['成都', '张梓朔', 89883, 189171], ['西安', '姚先慧', 39006, 65783],
  ['新世界', '别热克·木拉提', 71228, 113201], ['成都', '林钦科', 74620, 113712], ['西安', '张净妍', 115322, 169876],
  ['南京', '邹陈明', 25439, 33980], ['成都', '张盼', 64444, 80411], ['合肥', '程鹏', 27135, 32420],
  ['合肥', '聂宇', 98363, 115580], ['合肥', '徐志远', 50877, 58556], ['西安', '李辉', 67836, 71905],
  ['合肥', '甄福民', 47485, 42200], ['合肥', '程浩', 32222, 27280], ['西安', '张浩', 47485, 24921],
  ['南京', '张学', 94971, 45875], ['南京', '刘媛', 81404, 37380], ['成都', '王津雯', 52573, 16340],
  ['西安', '穆伟强', 98363, 20020], ['西安', '王鹏刚', 96667, 12840], ['西安', '姜睿麒', 44094, 0],
  ['成都', '梁辰', 86491, 0], ['新世界', '徐黎', 37310, 0]
].map(([base, name, target, performance], i) => ({
  rank: i + 1, base, name, target, performance,
  rate: target ? Math.round((performance / target) * 100) : 0
}));

const leader = [
  ['西安', '许佳萍', 16959, 64950], ['成都', '陈明睿', 15263, 55546], ['合肥', '闵悦', 18655, 67273],
  ['成都', '张诗曼', 23743, 78239], ['合肥', '姜杨丹瑞', 10175, 24500], ['合肥', '韩圣洁', 22047, 49940],
  ['合肥', '朱国韬', 37310, 83736], ['西安', '王宝', 22047, 44740], ['新世界', '满龙', 26406, 51182],
  ['西安', '雷城城', 22047, 42720], ['成都', '余迪', 25439, 48712], ['西安', '罗江斌', 23743, 43640],
  ['合肥', '刘思雅', 15263, 27860], ['成都', '任欣', 30526, 53535], ['合肥', '高奥琪', 11871, 19620],
  ['合肥', '李星宇', 15263, 24516], ['南京', '申青', 10175, 15150], ['成都', '柯俊旭', 16959, 24320],
  ['成都', '张久强', 10175, 14340], ['合肥', '吴昊', 10175, 14120], ['西安', '张家瑞', 16959, 23063],
  ['南京', '邹陈明', 25439, 33980], ['合肥', '魏晓杰', 15263, 18920], ['合肥', '马云龙', 10175, 12340],
  ['合肥', '李风格', 16959, 20080], ['合肥', '王志辉', 10175, 11540]
].map(([base, name, target, performance], i) => ({
  rank: i + 1, base, name, target, performance,
  rate: target ? Math.round((performance / target) * 100) : 0
}));

const BOARDS = [
  {
    key: 'consultant',
    title: '转介绍9月辅导直推业绩排行榜',
    subtitle: '数据截止 9.30',
    note: '每周五更新，暂未扣除退费，且业绩补登等特殊情况暂未计算，后续核算业绩会统一核算进去。',
    columns: [
      ['rank', '序号'], ['base', '基地'], ['name', '辅导姓名'], ['performance', '辅导业绩'], ['rankLabel', '暂时排名']
    ],
    rows: consultant
  },
  {
    key: 'supervisor',
    title: '转介绍9月辅导直推主管团队业绩排行榜',
    subtitle: '数据截止 9.30',
    note: '每周五更新，暂未扣除退费，且业绩补登等特殊情况暂未计算，后续核算业绩会统一核算进去。',
    columns: [
      ['rank', '序号'], ['base', '基地'], ['name', '主管'], ['target', '目标'], ['performance', '辅导直推业绩'],
      ['rate', '目标完成度'], ['rankLabel', '暂时排名']
    ],
    rows: supervisor
  },
  {
    key: 'leader',
    title: '转介绍9月辅导直推组长团队业绩排行榜',
    subtitle: '数据截止 9.30',
    note: '每周五更新，暂未扣除退费，且业绩补登等特殊情况暂未计算，后续核算业绩会统一核算进去。',
    columns: [
      ['rank', '序号'], ['base', '基地'], ['name', '组长'], ['target', '目标'], ['performance', '辅导直推业绩'],
      ['rate', '目标完成度'], ['rankLabel', '暂时排名']
    ],
    rows: leader
  }
];

function withLabels(boards = BOARDS) {
  return boards.map((b) => ({
    ...b,
    rows: b.rows.map((r) => {
      const label = r.rank === 1 ? 'TOP1 👑' : r.rank === 2 ? 'TOP2 🥈' : r.rank === 3 ? 'TOP3 🥉' : '';
      return { ...r, rankLabel: label };
    })
  }));
}

function getRankings() {
  let boards = BOARDS;
  if (fs.existsSync(FEISHU_CACHE)) {
    try {
      const synced = JSON.parse(fs.readFileSync(FEISHU_CACHE, 'utf8'));
      if (synced.rankings) {
        boards = BOARDS.map((b) => ({
          ...b,
          rows: Array.isArray(synced.rankings[b.key]) ? synced.rankings[b.key] : b.rows
        }));
      }
    } catch { /* ignore bad cache */ }
  }
  if (fs.existsSync(DATA_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch { /* ignore */ }
  }
  return withLabels(boards);
}

function saveRankings(data) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

module.exports = { BOARDS, getRankings, saveRankings, DATA_FILE };
