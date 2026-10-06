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

  /* 星级评定（2026-10-06）：提示功能整体下线后 hintsUsed 是恒 0 死参数，
     已删——判定只看提问数是否压在 par 内（报告 P3-8）。 */
  function stars(puzzle, questionCount) {
    var par = (puzzle && puzzle.par) || 8;
    if (questionCount <= par) return 3;
    if (questionCount <= par + 5) return 2;
    return 1;
  }

  function starNote(n) {
    if (n >= 3) return "汤色清亮，问题没超纲——这锅熬得漂亮！";
    if (n === 2) return "味道不错，只是中间多问了几圈。";
    return "汤是端上来了，火候全靠题海堆的。下次先想好再问？";
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
    var arr = freshOrAll(cand, ex);
    return arr[Math.floor(Math.random() * arr.length)] || null;
  }

  function freshOrAll(cand, ex) {
    var fresh = cand.filter(function (p) { return ex.indexOf(p.id) === -1; });
    return fresh.length ? fresh : cand;
  }

  /* ---------------- 题目标签展示视图（2026-10-06，报告 P2-3 / P2-4） ----------------
   * 母本标签里混着两类噪音：
   *   · 「英译中 / 日译中 / 繁译简」是翻译状态，不是题材——挪出题材 chips，
   *     降级为卡片 / 详情页的小字徽章；
   *   · 原始来源（dataset:*、github 用户名、站点域名）归并为 5 个可读分组。
   * 这套纯视图函数由单人汤库、随机模式、多人房选汤共用；
   * 母本数据（cats/src）不动，只在展示与筛选层生效。 */

  var XLANG = { "英译中": 1, "日译中": 1, "繁译简": 1 };

  /* 只对「题材=其他/空」的题按汤名关键词补分类；补不上仍归「其他」。
     已有题材的题一律尊重原打标，不做二次干预。 */
  var RECLASS_RULES = [
    ["犯罪", ["杀", "凶", "尸", "毒", "劫", "绑", "偷", "盗", "纵火", "失踪", "埋", "分尸", "灭门", "枪", "刀", "案犯"]],
    ["恐怖", ["鬼", "灵", "棺", "墓", "咒", "妖", "魔", "盯", "尾随", "敲门", "黑影", "血", "半夜", "坟", "惊悚"]],
    ["校园", ["学校", "教室", "宿舍", "老师", "同学", "毕业", "校园", "作业", "黑板", "校"]],
    ["医院", ["医院", "病房", "手术", "医生", "护士", "诊", "病", "药", "疫苗", "精神科"]],
    ["家庭", ["父", "母", "妻", "夫", "儿", "女", "哥", "姐", "弟", "妹", "婆", "爷爷", "奶奶", "叔", "姨", "姑", "亲", "结婚", "离婚", "家"]],
    ["都市", ["电梯", "地铁", "公交", "出租", "楼", "街", "公司", "银行", "超市", "监控", "红绿灯", "小区", "物业", "天台"]],
    ["职场", ["老板", "上司", "同事", "薪", "裁员", "加班", "面试", "离职", "开除", "职员"]],
    ["科幻", ["机器人", "人工智能", "未来", "宇宙", "外星", "穿越", "时空", "平行", "超能力", "克隆"]],
    ["推理", ["侦探", "警", "嫌疑", "线索", "审讯", "口供", "密室", "不在场", "证"]],
    ["悲剧", ["遗书", "绝症", "遗照", "殉", "去世", "错过"]],
    ["搞笑", ["笑", "乌龙", "误会", "恶搞", "蠢"]],
    ["猎奇", ["咽", "咬", "胃", "肠", "嚼", "啃"]],
    ["温情", ["求婚", "约定", "守候", "礼物", "拥抱", "回家", "等"]],
    ["日常", ["饭", "菜", "厨", "餐", "快递", "外卖", "手机", "睡", "洗", "买"]],
    ["怪谈", ["怪谈", "都市传说", "异闻", "传说"]]
  ];

  function catsView(p) {
    if (!p) return [];
    if (p.__vcats) return p.__vcats;
    var raw = (p.cats || []).filter(function (c) { return c && !XLANG[c]; });
    var out = raw.filter(function (c) { return c !== "其他"; });
    if (!out.length) {
      var hay = String(p.dispTitle || p.title || "");
      for (var i = 0; i < RECLASS_RULES.length && out.length < 2; i++) {
        var r = RECLASS_RULES[i];
        for (var j = 0; j < r[1].length; j++) {
          if (hay.indexOf(r[1][j]) !== -1) { out.push(r[0]); break; }
        }
      }
    }
    p.__vcats = out.length ? out : ["其他"];
    return p.__vcats;
  }

  /* 翻译状态徽章：题目原本挂的「英译中/日译中/繁译简」取第一枚 */
  function xlateOf(p) {
    var cs = (p && p.cats) || [];
    for (var i = 0; i < cs.length; i++) if (XLANG[cs[i]]) return cs[i];
    return "";
  }

  var SRC_GROUP_ORDER = ["精品自制", "海外经典站", "中文汤站", "社区投稿", "数据集归档", "其他来源"];

  function srcGroupOf(src) {
    var v = String(src || "");
    if (!v) return "其他来源";
    if (v === "精品汤" || v === "精品自制") return "精品自制";
    if (v.indexOf("github:") === 0) return "社区投稿";
    if (v.indexOf("dataset:") === 0 || v.indexOf("misc/") === 0) return "数据集归档";
    if (/late-late\.jp|yesnogame\.net|jed/i.test(v)) return "海外经典站";
    if (/haiguitang|许二木/i.test(v)) return "中文汤站";
    return "其他来源";
  }

  /* 题材 facet：按出现频次排（「其他」永远垫底） */
  function catFacet(list) {
    var seen = {};
    (list || []).forEach(function (p) {
      catsView(p).forEach(function (c) { if (c !== "其他") seen[c] = (seen[c] || 0) + 1; });
    });
    var out = Object.keys(seen);
    out.sort(function (a, b) { return seen[b] - seen[a] || (a < b ? -1 : 1); });
    out.push("其他");
    return out;
  }

  /* 来源 facet：只列真实存在的组，按固定次序 */
  function srcFacet(list) {
    var seen = {};
    (list || []).forEach(function (p) { seen[srcGroupOf(p.src)] = 1; });
    return SRC_GROUP_ORDER.filter(function (g) { return seen[g]; });
  }

  function hasCatView(p, cat) {
    if (!cat || cat === "全部") return true;
    return catsView(p).indexOf(cat) !== -1;
  }

  function hasSrcGroup(p, group) {
    if (!group || group === "全部") return true;
    return srcGroupOf(p.src) === group;
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
    drawFromLibrary: drawFromLibrary,
    catsView: catsView,
    xlateOf: xlateOf,
    srcGroupOf: srcGroupOf,
    catFacet: catFacet,
    srcFacet: srcFacet,
    hasCatView: hasCatView,
    hasSrcGroup: hasSrcGroup
  };

  root.SoupEngine = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
