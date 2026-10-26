'use strict';

const XLSX = require('xlsx');

const FIELD_ALIASES = {
  base: ['基地', '基地名称', '所属基地', '战区', '城市', '区域', '分公司'],
  customer: ['客户姓名', '姓名', '用户姓名', '客户名称', '用户名', '客户', '联系人'],
  phone: ['手机号', '手机', '电话', '联系电话', '联系方式', '客户电话', '手机号码'],
  sourceType: ['来源类型', '名单类型', '类型', '来源', '客户类型', '名单来源'],
  owner: ['负责人', '跟进人', '归属人', '销售', '顾问', '经纪人', '维护人', '所属人'],
  status: ['状态', '跟进状态', '转化状态', '客户状态'],
  createdAt: ['创建时间', '导入时间', '日期', '名单日期', '生成时间', '添加时间', '登记时间'],
  lastFollowUp: ['最近跟进', '最近跟进时间', '最后跟进', '回访时间', '最近联系', '最后联系时间'],
  tags: ['标签', '客户标签', '名单标签'],
  note: ['备注', '说明', '备注信息']
};

const STATUS_SET = new Set(['待跟进', '跟进中', '已转化', '暂缓']);
const SOURCE_SET = new Set(['新用户直推未转化', '高潜老用户']);

function normalizeHeader(value) {
  return String(value ?? '')
    .replace(/[\s\u3000]/g, '')
    .replace(/[（(].*?[）)]/g, '')
    .replace(/[：:*＊]/g, '')
    .replace(/必填|选填/g, '')
    .trim();
}

function buildAliasMap() {
  const map = new Map();
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    for (const alias of aliases) map.set(normalizeHeader(alias), field);
  }
  return map;
}

const ALIAS_MAP = buildAliasMap();

function pad(n) { return String(n).padStart(2, '0'); }
function dateStr(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

function normalizeDate(value) {
  if (value === null || value === undefined || value === '') return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) return dateStr(value);
  if (typeof value === 'number' && value > 20000 && value < 80000) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed && parsed.y) return `${parsed.y}-${pad(parsed.m)}-${pad(parsed.d)}`;
  }
  const text = String(value).trim();
  if (!text) return '';
  let m = text.match(/(20\d{2})[年/\-.](\d{1,2})[月/\-.](\d{1,2})/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = text.match(/^(\d{1,2})[月/\-.](\d{1,2})日?$/);
  if (m) return `${new Date().getFullYear()}-${pad(m[1])}-${pad(m[2])}`;
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return dateStr(parsed);
  return '';
}

function normalizeStatus(value) {
  const text = String(value ?? '').trim();
  if (STATUS_SET.has(text)) return text;
  if (/已成交|成交|转化|已报名|已签约/.test(text)) return '已转化';
  if (/跟进中|沟通中|已联系|联系中/.test(text)) return '跟进中';
  if (/无效|流失|暂缓|放弃|不考虑/.test(text)) return '暂缓';
  return '待跟进';
}

function normalizeSource(value, fallback) {
  const text = String(value ?? '').trim();
  if (SOURCE_SET.has(text)) return text;
  if (/高潜|老用户|老客|复购/.test(text)) return '高潜老用户';
  if (/新用户|直推|新客|未转化/.test(text)) return '新用户直推未转化';
  return SOURCE_SET.has(fallback) ? fallback : '新用户直推未转化';
}

function findHeaderRow(matrix) {
  let best = { index: -1, score: 0, map: null };
  const limit = Math.min(matrix.length, 16);
  for (let i = 0; i < limit; i++) {
    const row = matrix[i] || [];
    const map = {};
    let score = 0;
    for (let c = 0; c < row.length; c++) {
      const field = ALIAS_MAP.get(normalizeHeader(row[c]));
      if (field && !(field in map)) {
        map[field] = c;
        score++;
      }
    }
    if (score > best.score) best = { index: i, score, map };
  }
  return best;
}

function parseWorkbook(buffer, options = {}) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true, cellNF: false, cellText: false });
  const baseList = options.bases || [];
  const defaultBaseId = options.defaultBaseId ? Number(options.defaultBaseId) : null;
  const defaultSource = options.defaultSource || '新用户直推未转化';

  const errors = [];
  const warnings = [];
  const rows = [];
  let sheetName = '';
  let headerRow = -1;
  let headerFields = [];

  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true, blankrows: false });
    if (!matrix.length) continue;
    const header = findHeaderRow(matrix);
    if (header.score >= 3) {
      sheetName = name;
      headerRow = header.index;
      headerFields = Object.keys(header.map);
      const map = header.map;

      for (let r = header.index + 1; r < matrix.length; r++) {
        const raw = matrix[r] || [];
        const get = (field) => (map[field] !== undefined ? raw[map[field]] : '');
        const customer = String(get('customer') ?? '').trim();
        const phoneRaw = get('phone');
        const phone = phoneRaw === '' || phoneRaw === null || phoneRaw === undefined
          ? ''
          : String(phoneRaw).replace(/\.0$/, '').trim();
        const baseText = String(get('base') ?? '').trim();

        if (!customer && !phone) continue;

        let baseId = defaultBaseId;
        if (baseText) {
          const found = baseList.find((b) => b.name === baseText || b.name.includes(baseText) || baseText.includes(b.name));
          if (found) baseId = found.id;
          else {
            errors.push({ row: r + 1, message: `未识别的基地「${baseText}」，请先在基地管理中创建` });
            continue;
          }
        }
        if (!baseId) {
          errors.push({ row: r + 1, message: '缺少基地信息，请在导入时选择默认基地' });
          continue;
        }

        const name = customer || '未填写';
        if (!customer) warnings.push({ row: r + 1, message: '姓名为空，已标记为「未填写」' });

        rows.push({
          row: r + 1,
          baseId,
          baseName: baseList.find((b) => b.id === baseId)?.name || '',
          customerName: name,
          phone,
          sourceType: normalizeSource(get('sourceType'), defaultSource),
          owner: String(get('owner') ?? '').trim(),
          status: normalizeStatus(get('status')),
          createdAt: normalizeDate(get('createdAt')) || dateStr(new Date()),
          lastFollowUp: normalizeDate(get('lastFollowUp')),
          tags: String(get('tags') ?? '').trim(),
          note: String(get('note') ?? '').trim()
        });
      }
      break;
    }
  }

  if (!sheetName) {
    throw new Error('没有识别到有效表头。请确认表格包含「基地、姓名、手机号、来源类型、负责人」等列。');
  }

  if (!rows.length && !errors.length) {
    throw new Error('表格中没有可导入的数据行。');
  }

  return {
    sheetName,
    headerRow: headerRow + 1,
    headerFields,
    rows,
    errors,
    warnings,
    stats: {
      totalRows: rows.length + errors.length,
      validRows: rows.length,
      errorRows: errors.length,
      bases: [...new Set(rows.map((r) => r.baseName))],
      sources: [...new Set(rows.map((r) => r.sourceType))]
    }
  };
}

module.exports = { parseWorkbook, normalizeDate, normalizeStatus, normalizeSource };
