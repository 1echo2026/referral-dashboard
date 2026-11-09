/* 公域静态版接口层：把原 Node 服务的 /api/* 在浏览器里本地实现，无需后端即可运行。
   数据来源：data/dashboard.json（由本地库导出的脱敏快照） */
(function () {
  'use strict';
  if (window.__RD_PUBLIC_API__) return;
  window.__RD_PUBLIC_API__ = true;

  var ORIG_FETCH = window.fetch ? window.fetch.bind(window) : null;
  var ADMIN_KEY = 'rd_public_admin';
  var DATA_URL = new URL('data/dashboard.json', location.href).href;
  var DATA = null;
  var LOADING = null;
  var READONLY_MSG = '公域静态版为只读快照，改数据请用本地版后台。';

  function json(obj, status) {
    return new Response(JSON.stringify(obj), {
      status: status || 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  }

  function loadData() {
    if (DATA) return Promise.resolve(DATA);
    if (!LOADING) {
      LOADING = ORIG_FETCH(DATA_URL, { cache: 'no-store' })
        .then(function (r) {
          if (!r.ok) throw new Error('数据快照加载失败 HTTP ' + r.status);
          return r.json();
        })
        .then(function (d) {
          DATA = d;
          return d;
        })
        .catch(function (e) {
          LOADING = null;
          throw e;
        });
    }
    return LOADING;
  }

  function isAdmin() {
    try {
      return localStorage.getItem(ADMIN_KEY) === '1';
    } catch (e) {
      return false;
    }
  }

  function setAdmin(on) {
    try {
      if (on) localStorage.setItem(ADMIN_KEY, '1');
      else localStorage.removeItem(ADMIN_KEY);
    } catch (e) {}
  }

  function paramMap(sp) {
    var out = {};
    if (!sp) return out;
    sp.forEach(function (v, k) {
      out[k] = v;
    });
    return out;
  }

  /* ---------- 明细筛选（对齐服务端 whereFilters） ---------- */
  function filterRows(rows, p) {
    return rows.filter(function (r) {
      if (p.base && p.base !== 'all' && Number(p.base) && Number(r.baseId) !== Number(p.base)) return false;
      if (p.from && /^\d{4}-\d{2}-\d{2}$/.test(p.from) && String(r.createdAt || '') < p.from) return false;
      if (p.to && /^\d{4}-\d{2}-\d{2}$/.test(p.to) && String(r.createdAt || '') > p.to) return false;
      if (p.source && p.source !== 'all' && r.sourceType !== p.source) return false;
      if (p.status && p.status !== 'all' && r.status !== p.status) return false;
      if (p.owner && p.owner !== 'all' && r.owner !== p.owner) return false;
      if (p.month && /^\d{4}-\d{2}$/.test(p.month) && String(r.createdAt || '').slice(0, 7) !== p.month) return false;
      if (p.q) {
        var q = String(p.q).toLowerCase();
        var hay = [r.customerName, r.phone, r.owner, r.tags].join(' ').toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  function monthSpan(rows, from, to) {
    var first = '';
    var last = '';
    rows.forEach(function (r) {
      var m = String(r.createdAt || '').slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(m)) return;
      if (!first || m < first) first = m;
      if (!last || m > last) last = m;
    });
    if (from && /^\d{4}-\d{2}/.test(from)) first = from.slice(0, 7);
    if (to && /^\d{4}-\d{2}/.test(to)) last = to.slice(0, 7);
    return { first: first, last: last };
  }

  function fillMonths(trendMap, rows, from, to) {
    var span = monthSpan(rows, from, to);
    if (!span.first || !span.last) {
      return Object.keys(trendMap)
        .sort()
        .map(function (m) {
          return { month: m, total: trendMap[m].total, converted: trendMap[m].converted };
        });
    }
    var out = [];
    var y = Number(span.first.slice(0, 4));
    var mo = Number(span.first.slice(5, 7));
    var ey = Number(span.last.slice(0, 4));
    var emo = Number(span.last.slice(5, 7));
    while (y < ey || (y === ey && mo <= emo)) {
      var key = y + '-' + String(mo).padStart(2, '0');
      var hit = trendMap[key];
      out.push({ month: key, total: hit ? hit.total : 0, converted: hit ? hit.converted : 0 });
      mo += 1;
      if (mo > 12) {
        mo = 1;
        y += 1;
      }
    }
    return out;
  }

  /* ---------- 总览聚合（对齐服务端 overviewData） ---------- */
  function overview(d) {
    var p = d.params || {};
    var rows = filterRows(d.data.records || [], p);
    var total = rows.length;
    var newUnconverted = 0;
    var highPotential = 0;
    var converted = 0;
    var followed = 0;
    var trendMap = {};
    var sourceMap = {};
    var statusMap = {};
    var baseMap = {};
    var ownerMap = {};

    rows.forEach(function (r) {
      if (r.sourceType === '新用户直推未转化') newUnconverted += 1;
      if (r.sourceType === '高潜老用户') highPotential += 1;
      if (r.status === '已转化') converted += 1;
      if (r.status !== '待跟进') followed += 1;

      var m = String(r.createdAt || '').slice(0, 7);
      if (/^\d{4}-\d{2}$/.test(m)) {
        if (!trendMap[m]) trendMap[m] = { total: 0, converted: 0 };
        trendMap[m].total += 1;
        if (r.status === '已转化') trendMap[m].converted += 1;
      }

      sourceMap[r.sourceType] = (sourceMap[r.sourceType] || 0) + 1;
      statusMap[r.status] = (statusMap[r.status] || 0) + 1;

      var bid = r.baseId;
      if (!baseMap[bid]) {
        baseMap[bid] = {
          id: bid,
          name: r.baseName,
          color: r.baseColor,
          total: 0,
          converted: 0,
          newUnconverted: 0,
          highPotential: 0,
          owners: {}
        };
      }
      var b = baseMap[bid];
      b.total += 1;
      if (r.status === '已转化') b.converted += 1;
      if (r.sourceType === '新用户直推未转化') b.newUnconverted += 1;
      if (r.sourceType === '高潜老用户') b.highPotential += 1;
      if (r.owner) b.owners[r.owner] = 1;

      if (r.owner) {
        var key = bid + '|' + r.owner;
        if (!ownerMap[key]) {
          ownerMap[key] = { owner: r.owner, baseId: bid, baseName: r.baseName, baseColor: r.baseColor, total: 0, converted: 0 };
        }
        ownerMap[key].total += 1;
        if (r.status === '已转化') ownerMap[key].converted += 1;
      }
    });

    var sortedBases = Object.keys(baseMap)
      .map(function (k) {
        var b = baseMap[k];
        return {
          id: b.id,
          name: b.name,
          color: b.color,
          total: b.total,
          converted: b.converted,
          newUnconverted: b.newUnconverted,
          highPotential: b.highPotential,
          ownerCount: Object.keys(b.owners).length,
          conversionRate: b.total ? b.converted / b.total : 0
        };
      })
      .sort(function (a, b) {
        return b.total - a.total;
      });

    var ownerList = Object.keys(ownerMap).map(function (k) {
      var o = ownerMap[k];
      return {
        owner: o.owner,
        baseName: o.baseName,
        baseColor: o.baseColor,
        total: o.total,
        converted: o.converted,
        conversionRate: o.total ? o.converted / o.total : 0
      };
    });
    ownerList.sort(function (a, b) {
      return b.total - a.total;
    });

    var breakdown = Object.keys(ownerMap).map(function (k) {
      var o = ownerMap[k];
      return {
        owner: o.owner,
        baseId: o.baseId,
        baseName: o.baseName,
        baseColor: o.baseColor,
        total: o.total,
        converted: o.converted,
        conversionRate: o.total ? o.converted / o.total : 0
      };
    });
    var orderMap = {};
    (d.data.bases || []).forEach(function (b) {
      orderMap[b.id] = b.sortOrder || b.sort_order || 0;
    });
    breakdown.sort(function (a, b) {
      var oa = orderMap[a.baseId] || 0;
      var ob = orderMap[b.baseId] || 0;
      if (oa !== ob) return oa - ob;
      return b.total - a.total;
    });

    var sources = Object.keys(sourceMap)
      .map(function (k) {
        return { name: k, value: sourceMap[k] };
      })
      .sort(function (a, b) {
        return b.value - a.value;
      });

    var statuses = Object.keys(statusMap)
      .map(function (k) {
        return { name: k, value: statusMap[k] };
      })
      .sort(function (a, b) {
        return b.value - a.value;
      });

    var version = (d.data.versions && d.data.versions.rows && d.data.versions.rows[0]) || null;
    var versionOut = null;
    if (version) {
      versionOut = {
        id: version.id,
        label: version.label,
        rowCount: version.row_count,
        publishedAt: version.published_at || version.created_at
      };
    }

    return {
      version: versionOut,
      kpis: {
        total: total,
        newUnconverted: newUnconverted,
        highPotential: highPotential,
        converted: converted,
        followed: followed,
        conversionRate: total ? converted / total : 0,
        followUpRate: total ? followed / total : 0
      },
      trend: fillMonths(trendMap, rows, p.from, p.to),
      sources: sources,
      statuses: statuses,
      bases: sortedBases,
      owners: ownerList.slice(0, 8),
      ownerBreakdown: breakdown.slice(0, 200)
    };
  }

  /* ---------- 明细列表（对齐 /api/records 与 /api/admin/records） ---------- */
  function listRecords(d) {
    var p = d.params || {};
    var rows = filterRows(d.data.records || [], p);
    var sortKey = p.sort || 'createdAt';
    var dir = String(p.order || 'desc').toLowerCase() === 'asc' ? 1 : -1;
    var fieldMap = {
      createdAt: 'createdAt',
      customerName: 'customerName',
      status: 'status',
      owner: 'owner',
      base: 'baseName'
    };
    var field = fieldMap[sortKey] || 'createdAt';
    rows.sort(function (a, b) {
      var av = String(a[field] || '');
      var bv = String(b[field] || '');
      if (av === bv) return Number(b.id) - Number(a.id);
      return av < bv ? -dir : dir;
    });
    var page = Math.max(1, Number(p.page || 1));
    var pageSize = Math.min(5000, Math.max(1, Number(p.pageSize || 20)));
    var slice = rows.slice((page - 1) * pageSize, page * pageSize);
    return { rows: slice, total: rows.length, page: page, pageSize: pageSize };
  }

  function readArgs(init) {
    var body = init && init.body;
    if (!body) return {};
    if (typeof body === 'string') {
      try {
        return JSON.parse(body);
      } catch (e) {
        return {};
      }
    }
    return {};
  }

  function handle(path, method, init, sp) {
    return loadData().then(function (data) {
      var params = paramMap(sp);

      /* 前台 */
      if (path === '/api/meta' && method === 'GET') {
        var meta = Object.assign({}, data.meta);
        meta.viewer = { role: 'admin', username: isAdmin() ? 'admin' : 'public' };
        var vrows = (data.versions && data.versions.rows) || [];
        if (vrows[0]) {
          meta.version = {
            label: vrows[0].label,
            rowCount: vrows[0].row_count,
            publishedAt: vrows[0].published_at || vrows[0].created_at
          };
        }
        meta.updatedAt = (meta.version && meta.version.publishedAt) || data.generatedAt;
        return json(meta);
      }

      if (path === '/api/session' && method === 'GET') {
        return json({ authenticated: true, viewer: { role: 'admin', username: 'public' } });
      }

      if (path === '/api/login' && method === 'POST') {
        var body = readArgs(init);
        var u = String(body.username || '').trim();
        var pw = String(body.password || '');
        if (u === 'admin' && pw === 'admin123') {
          setAdmin(true);
          return json({ ok: true, viewer: { role: 'admin', username: 'admin' } });
        }
        return json({ error: '公域版仅开放管理账号 admin 登录，基地账号请在本地版使用' }, 401);
      }

      if (path === '/api/overview' && method === 'GET') {
        return json(overview({ data: data, params: params }));
      }

      if (path === '/api/records' && method === 'GET') {
        return json(listRecords({ data: data, params: params }));
      }

      if (path === '/api/rankings' && method === 'GET') {
        var rk = Object.assign({}, data.rankings);
        rk.viewer = { role: 'admin', username: 'admin' };
        return json(rk);
      }

      if (path === '/api/tables' && method === 'GET') {
        var tb = Object.assign({}, data.tables);
        tb.viewer = { role: 'admin', username: 'admin' };
        return json(tb);
      }

      if (path === '/api/logout' && method === 'POST') {
        setAdmin(false);
        return json({ ok: true });
      }

      /* 后台 */
      if (path === '/api/admin/me' && method === 'GET') {
        return json({ authenticated: isAdmin(), username: isAdmin() ? 'admin' : null, setupRequired: false });
      }

      if (path === '/api/admin/login' && method === 'POST') {
        var b2 = readArgs(init);
        if (String(b2.username || '').trim() === 'admin' && String(b2.password || '') === 'admin123') {
          setAdmin(true);
          return json({ ok: true, username: 'admin' });
        }
        return json({ error: '用户名或密码不正确' }, 401);
      }

      if (path === '/api/admin/setup' && method === 'POST') {
        return json({ error: '管理员已初始化，请直接登录' }, 409);
      }

      if (path === '/api/admin/logout' && method === 'POST') {
        setAdmin(false);
        return json({ ok: true });
      }

      if (path.indexOf('/api/admin/') === 0) {
        if (!isAdmin()) return json({ error: '请先登录' }, 401);

        if (path === '/api/admin/stats' && method === 'GET') return json(data.stats);
        if (path === '/api/admin/bases' && method === 'GET') return json(data.bases);
        if (path === '/api/admin/base-accounts' && method === 'GET') return json(data.baseAccounts);
        if (path === '/api/admin/settings' && method === 'GET') return json(data.settings);
        if (path === '/api/admin/versions' && method === 'GET') return json(data.versions);
        if (path === '/api/admin/audit' && method === 'GET') return json(data.audit);
        if (path === '/api/admin/feishu/status' && method === 'GET') return json(data.feishuStatus);
        if (path === '/api/admin/records' && method === 'GET') return json(listRecords({ data: data, params: params }));
        return json({ error: READONLY_MSG }, 403);
      }

      return json({ error: '未支持的接口：' + path }, 404);
    });
  }

  if (ORIG_FETCH) {
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || String(input);
      var abs;
      try {
        abs = new URL(url, location.href);
      } catch (e) {
        return ORIG_FETCH(input, init);
      }
      var idx = abs.pathname.indexOf('/api/');
      if (idx === -1) return ORIG_FETCH(input, init);
      var path = abs.pathname.slice(idx);
      var method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      return handle(path, method, init, abs.searchParams);
    };
  }

  /* 静态版被禁用的下载/写入口给个提示 */
  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-static-blocked]') : null;
    if (!el) return;
    e.preventDefault();
    alert(el.getAttribute('data-static-blocked') || READONLY_MSG);
  });
})();
