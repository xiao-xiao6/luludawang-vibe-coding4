/* ============================================================
 * 深海汤屋 · 前端工具引擎（2026-10-04 服务端判定版）
 * ------------------------------------------------------------
 * 判定、线索、汤面、汤底全部移到 Worker 服务端；
 * 这份文件只剩：文本工具 + 元信息筛选/检索/抽题。
 * ask / judgeGuess / truthEcho 等本地判定已整体下线。
 * ============================================================ */

(function (root) {
  "use strict";

  /* 归一化：去掉所有标点与空白，方便去重与标题匹配 */
  var PUNCT = /[\s，。！？、,.?!~·“”"'‘’「」『』（）()《》【】\[\]{}：:；;\-—_…/\\|+=*&^%$#@<>]/g;

  function normalize(text) {
    return String(text == null ? "" : text).toLowerCase().replace(PUNCT, "");
  }

  /* 去掉答话开头的判定词（界面上已有判定徽章，避免重复显示） */
  var LEAD_RE = /^(与此无关|部分正确|不是|是)[。.，,、]\s*/;
  function stripLead(text) {
    return String(text == null ? "" : text).replace(LEAD_RE, "");
  }

  function stars(puzzle, questionCount, hintsUsed) {
    var par = (puzzle && puzzle.par) || 8;
    if (hintsUsed === 0 && questionCount <= par) return 3;
    if (hintsUsed <= 1 && questionCount <= par + 5) return 2;
    return 1;
  }

  function starNote(n) {
    if (n >= 3) return "汤色清亮，一滴提示都没浪费——这锅熬得漂亮！";
    if (n === 2) return "味道不错，只是中间多搅了两下。";
    return "汤是端上来了，但火候全靠提示撑着。再熬一次试试？";
  }

  /* 精品层元信息查找（浏览器包只剩元信息，汤面要找服务端逐道拿） */
  function getPuzzle(id) {
    var list = root.PUZZLES || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  /* ---------------- 细分类：题材标签 ---------------- */

  function allCats(list) {
    var src = list || root.PUZZLES || [];
    var out = [];
    for (var i = 0; i < src.length; i++) {
      var cs = src[i].cats || [];
      for (var j = 0; j < cs.length; j++) {
        if (cs[j] && out.indexOf(cs[j]) === -1) out.push(cs[j]);
      }
    }
    return out;
  }

  function hasCat(p, cat) {
    if (!cat || cat === "全部") return true;
    return ((p && p.cats) || []).indexOf(cat) !== -1;
  }

  /* 从池子里抽一题：优先避开 excludeIds；都抽过了就放宽，保证永远有得抽 */
  function drawFrom(list, excludeIds) {
    if (!list || !list.length) return null;
    var ex = excludeIds || [];
    var fresh = list.filter(function (p) { return ex.indexOf(p.id) === -1; });
    var usable = fresh.length ? fresh : list;
    return usable[Math.floor(Math.random() * usable.length)] || null;
  }

  /* ---------------- 汤库层元信息（与精品层完全隔离） ---------------- */

  function libraryCats(list) {
    var seen = {}, out = [];
    (list || []).forEach(function (p) {
      var cs = (p && p.cats) || [];
      for (var i = 0; i < cs.length; i++) {
        if (cs[i] && !seen[cs[i]]) { seen[cs[i]] = 1; out.push(cs[i]); }
      }
    });
    return out;
  }

  /* 检索只匹配汤名（dispTitle/title）：浏览器包没有汤面，
     全库汤面内容检索会构成「内容探测 oracle」，已随服务端判定一起下线。 */
  function searchLibrary(list, kw) {
    var k = normalize(kw);
    if (!k) return list || [];
    return (list || []).filter(function (p) {
      if (!p) return false;
      var hay = normalize((p.dispTitle || "") + "\n" + (p.title || ""));
      return hay.indexOf(k) !== -1;
    });
  }

  function libraryPool(list, opts) {
    var o = opts || {};
    return (list || []).filter(function (p) {
      if (!p) return false;
      if (o.cat && o.cat !== "全部" && (p.cats || []).indexOf(o.cat) === -1) return false;
      if (o.difficulty && p.difficulty !== o.difficulty) return false;
      if (o.src && o.src !== "全部" && p.src !== o.src) return false;
      if (o.hasTruth && p.mode !== "truth") return false;
      if (o.lang && p.lang !== o.lang) return false;
      return true;
    });
  }

  function drawFromLibrary(list, opts, excludeIds) {
    var cand = libraryPool(list, opts);
    if (!cand.length) cand = (list || []);
    if (!cand.length) return null;
    var ex = excludeIds || [];
    var fresh = cand.filter(function (p) { return ex.indexOf(p.id) === -1; });
    var arr = fresh.length ? fresh : cand;
    return arr[Math.floor(Math.random() * arr.length)] || null;
  }

  var api = {
    normalize: normalize,
    stripLead: stripLead,
    stars: stars,
    starNote: starNote,
    getPuzzle: getPuzzle,
    allCats: allCats,
    hasCat: hasCat,
    drawFrom: drawFrom,
    libraryCats: libraryCats,
    searchLibrary: searchLibrary,
    libraryPool: libraryPool,
    drawFromLibrary: drawFromLibrary
  };

  root.SoupEngine = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
