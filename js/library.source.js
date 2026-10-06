/* ============================================================
 * 深海汤屋 · 汤库元信息数据源（2026-10-06 首屏瘦身版）
 * ------------------------------------------------------------
 * 报告 P1-2 的落点：2400 道汤库层元信息（js/library.list.js，546KB）
 * 不再打进首屏 <script>，改为「用到时才取」：
 *   1. 已有 window.SOUP_LIBRARY → 直接用（老包 / 上一次已加载）。
 *   2. 首选动态注入 <script> 拉 library.list.js：
 *      走 Service Worker「网络优先 + 落缓存」，二次进汤库秒开、离线可用。
 *   3. 脚本拉不动（离线且无缓存 / 被拦）→ 回落 Worker
 *      GET /api/puzzles?layer=lib 分页兜底（每页 200 道纯元信息，
 *      与浏览器包同级口径：只有汤名/分类/火候/来源，无汤面无汤底）。
 * 另提供 probeServer()：/api/puzzle-stats 校准「服务端共几道」，
 * 汤库页据此提示「汤架已更新，刷新可取新汤」，让服务端接口不再是死代码。
 * ============================================================ */

(function (root) {
  "use strict";

  var SRC_PATH = "js/library.list.js?v=20261006a";
  var SCRIPT_TIMEOUT_MS = 12000;
  var PAGE_LIMIT = 200;      /* 服务端单页上限（index.js 也钳到 200） */
  var PAGE_SAFETY_CAP = 4000; /* 分页兜底最多拉这么多，防失控 */

  var DEFAULT_BASE = "https://soup-room.57gqq9hsq.workers.dev";

  function apiBase() {
    try {
      if (root.SoupNet && root.SoupNet.baseUrl) {
        var b = root.SoupNet.baseUrl();
        if (b) return String(b).replace(/\/+$/, "");
      }
    } catch (e) { /* 忽略，用默认 */ }
    return DEFAULT_BASE;
  }

  var list = null;
  var loading = null;
  var usedSource = "";
  var serverCounts = null;

  function emit(name) {
    try {
      if (root.dispatchEvent && typeof root.CustomEvent === "function") {
        root.dispatchEvent(new root.CustomEvent(name));
      }
    } catch (e) { /* 忽略 */ }
  }

  function adopt(arr, via) {
    list = arr || [];
    usedSource = via;
    try { root.SOUP_LIBRARY = list; } catch (e) { /* 忽略 */ }
    emit("soup:libready");
    return list;
  }

  /* 路线 2：动态脚本。SW 对 .js 走网络优先并缓存，天然获得离线能力 */
  function loadScript() {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var s = document.createElement("script");
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        reject(new Error("library.list.js 加载超时"));
      }, SCRIPT_TIMEOUT_MS);
      s.src = SRC_PATH;
      s.async = true;
      s.onload = function () {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        var arr = root.SOUP_LIBRARY;
        if (arr && arr.length) resolve(arr);
        else reject(new Error("library.list.js 无有效数据"));
      };
      s.onerror = function () {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        reject(new Error("library.list.js 拉取失败"));
      };
      document.head.appendChild(s);
    });
  }

  /* 路线 3：Worker 分页兜底。metaPuzzle 字段与本地包对齐后入池 */
  function toMeta(p) {
    p = p || {};
    return {
      id: p.id,
      dispTitle: p.dispTitle || p.title || p.id,
      cats: p.cats || [],
      difficulty: Number(p.difficulty) || 2,
      par: Number(p.par) || 0,
      src: p.src || "other",
      lang: "zh",
      mode: "truth",
      hasTruth: true,           /* 构建时已剔除无底题：清单里的都有底 */
      truthSource: p.truthSource || "",
      layer: p.layer || "lib"
    };
  }

  function fetchPaged() {
    var base = apiBase();
    var acc = [];
    function step(offset) {
      var url = base + "/api/puzzles?layer=lib&limit=" + PAGE_LIMIT + "&offset=" + offset;
      return fetch(url, { headers: { "accept": "application/json" } })
        .then(function (r) {
          if (!r.ok) throw new Error("puzzles 接口 HTTP " + r.status);
          return r.json();
        })
        .then(function (j) {
          var ps = (j && j.puzzles) || [];
          for (var i = 0; i < ps.length; i++) acc.push(toMeta(ps[i]));
          var total = (j && typeof j.total === "number") ? j.total : acc.length;
          serverCounts = serverCounts || {};
          serverCounts.lib = total;
          var next = offset + ps.length;
          if (ps.length && next < total && next < PAGE_SAFETY_CAP) return step(next);
          if (!acc.length) throw new Error("puzzles 接口返回空清单");
          return acc;
        });
    }
    return step(0);
  }

  /* 对外唯一入口：拿到全量汤库层元信息（Promise） */
  function ensure() {
    if (list && list.length) return Promise.resolve(list);
    if (loading) return loading;
    loading = loadScript()
      .then(function (arr) { return adopt(arr, "script"); })
      .catch(function () {
        return fetchPaged().then(function (arr) { return adopt(arr, "worker-paged"); });
      })
      .catch(function (err) {
        loading = null;         /* 失败可重试：下次 ensure() 重新走一遍 */
        throw err;
      });
    return loading;
  }

  /* 服务端口径校准（不阻塞、失败静默）：/api/puzzle-stats */
  function probeServer(cb) {
    var run = function () {
      try {
        fetch(apiBase() + "/api/puzzle-stats", { headers: { "accept": "application/json" } })
          .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error("stats HTTP " + r.status)); })
          .then(function (j) {
            if (j && typeof j.lib === "number") {
              serverCounts = { total: j.total || 0, core: j.core || 0, lib: j.lib };
              if (cb) cb(serverCounts);
            }
          })
          .catch(function () { /* 离线 / 被墙：静默，本地元信息照常用 */ });
      } catch (e) { /* 忽略 */ }
    };
    run();
  }

  /* 首屏渲染完成后的空闲预取：不影响首屏（SW 命中时二次进入近乎零成本），
     但让用户真正点开汤库时基本无感等待 */
  function whenIdle(fn) {
    if (root.requestIdleCallback) {
      try { root.requestIdleCallback(fn, { timeout: 4000 }); return; } catch (e) { /* 落到定时器 */ }
    }
    setTimeout(fn, 1800);
  }

  function prefetch() {
    ensure().catch(function () { /* 预取失败不打扰，真正进汤库时再试 */ });
    probeServer();
  }

  if (document.readyState === "complete") whenIdle(prefetch);
  else root.addEventListener("load", function () { whenIdle(prefetch); });

  root.SoupLibSource = {
    ensure: ensure,
    probeServer: probeServer,
    ready: function () { return !!(list && list.length); },
    count: function () { return list ? list.length : 0; },
    via: function () { return usedSource; },
    serverCounts: function () { return serverCounts; },
    API_BASE: apiBase
  };
})(typeof window !== "undefined" ? window : this);
