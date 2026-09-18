/* ============================================================
 * 深海汤屋 · 引擎（纯逻辑，不碰 DOM，方便测试）
 * ------------------------------------------------------------
 * SoupEngine.ask(puzzle, question, revealedIdx) → 汤主的回应
 * SoupEngine.judgeGuess(puzzle, guess)          → 猜汤底的判定
 * SoupEngine.stars(puzzle, q, hints)            → 星级
 * ============================================================ */

(function (root) {
  "use strict";

  /* 归一化：去掉所有标点与空白，方便中文关键词匹配 */
  var PUNCT = /[\s，。！？、,.?!~·“”"'‘’「」『』（）()《》【】\[\]{}：:；;\-—_…/\\|+=*&^%$#@<>]/g;

  function normalize(text) {
    return String(text == null ? "" : text).toLowerCase().replace(PUNCT, "");
  }

  function pick(list) {
    if (!list || !list.length) return "";
    return list[Math.floor(Math.random() * list.length)];
  }

  function hasIndex(arr, i) {
    return !!arr && arr.indexOf(i) !== -1;
  }

  function hit(text, kw) {
    var k = normalize(kw);
    if (!k) return false;
    return text.indexOf(k) !== -1;
  }

  /* 去掉答话开头的判定词（界面上已有判定徽章，避免重复显示） */
  var LEAD_RE = /^(与此无关|部分正确|不是|是)[。.，,、]\s*/;
  function stripLead(text) {
    return String(text == null ? "" : text).replace(LEAD_RE, "");
  }

  function clueMatches(text, clue) {
    for (var i = 0; i < clue.kw.length; i++) {
      if (hit(text, clue.kw[i])) return true;
    }
    return false;
  }

  /* 玩家想直接要答案 / 放弃 */
  function isMeta(q) {
    var patterns = ["告诉我答案", "直接告诉我", "答案是什么", "汤底是什么", "公布答案", "给我答案", "我想放弃", "我要放弃"];
    for (var i = 0; i < patterns.length; i++) {
      if (q.indexOf(patterns[i]) !== -1) return true;
    }
    return false;
  }

  /* 找到“新”线索（未揭示过、且命中关键词） */
  function findFreshClue(puzzle, text, revealed) {
    for (var i = 0; i < puzzle.clues.length; i++) {
      if (hasIndex(revealed, i)) continue;
      if (clueMatches(text, puzzle.clues[i])) return { index: i, clue: puzzle.clues[i] };
    }
    return null;
  }

  /* 找到“旧”线索（已经揭示过、玩家又问到同一话题） */
  function findKnownClue(puzzle, text) {
    for (var i = 0; i < puzzle.clues.length; i++) {
      if (clueMatches(text, puzzle.clues[i])) return { index: i, clue: puzzle.clues[i] };
    }
    return null;
  }

  var VERDICT_LEAD = {
    yes: "是。",
    no: "不是。",
    partial: "部分正确。",
    irr: "与此无关。"
  };

  function ask(puzzle, question, revealed) {
    var q = normalize(question);
    if (!q) return { kind: "empty" };

    if (isMeta(q)) {
      return { kind: "meta", verdict: "irr", reply: pick(root.META_REPLY || ["汤主摇头。"]) };
    }

    var fresh = findFreshClue(puzzle, q, revealed || []);
    if (fresh) {
      return {
        kind: "clue",
        verdict: fresh.clue.type,
        reply: stripLead(fresh.clue.text),
        index: fresh.index,
        clue: fresh.clue,
        flavor: pick(root.FLAVOR || [])
      };
    }

    var known = findKnownClue(puzzle, q);
    if (known) {
      return {
        kind: "again",
        verdict: known.clue.type,
        reply: stripLead(known.clue.text),
        index: known.index,
        clue: known.clue
      };
    }

    return {
      kind: "irr",
      verdict: "irr",
      reply: pick(root.IMMATERIAL || ["与此无关。"]),
      flavor: Math.random() < 0.35 ? pick(root.FLAVOR || []) : ""
    };
  }

  function matchesAny(text, list) {
    var out = [];
    for (var i = 0; i < (list || []).length; i++) {
      if (hit(text, list[i]) && out.indexOf(list[i]) === -1) out.push(list[i]);
    }
    return out;
  }

  function judgeGuess(puzzle, guess) {
    var g = normalize(guess);
    var tks = puzzle.truthKeywords || [];
    var cks = puzzle.coreKeywords || [];
    var hits = matchesAny(g, tks);
    var cores = matchesAny(g, cks);
    var threshold = Math.max(6, Math.ceil(tks.length * 0.34));
    var base = { chars: g.length, hits: hits, coreHits: cores, hitCount: hits.length, coreCount: cores.length };

    if (g.length < 10) {
      return Object.assign(base, {
        level: "vague",
        note: "太短了——汤主看不清你熬的是什么。把“谁、为什么、怎么做的”讲一讲。"
      });
    }
    if (cores.length >= 1 && hits.length >= 3) {
      return Object.assign(base, { level: "solved", note: "对了！你把最关键的那一层说破了。" });
    }
    if (hits.length >= threshold) {
      return Object.assign(base, { level: "solved", note: "对了一大片！汤底就是你说的这个样子。" });
    }
    if (cores.length >= 1 || hits.length >= 2) {
      return Object.assign(base, { level: "close", note: "已经很近了——你摸到了关键，但还差最后一层。" });
    }
    return Object.assign(base, {
      level: "no",
      note: "方向还不对。再去问几个“为什么会这样”的问题吧。"
    });
  }

  function stars(puzzle, questionCount, hintsUsed) {
    var par = puzzle.par || 8;
    if (hintsUsed === 0 && questionCount <= par) return 3;
    if (hintsUsed <= 1 && questionCount <= par + 5) return 2;
    return 1;
  }

  function starNote(n) {
    if (n >= 3) return "汤色清亮，一滴提示都没浪费——这锅熬得漂亮！";
    if (n === 2) return "味道不错，只是中间多搅了两下。";
    return "汤是端上来了，但火候全靠提示撑着。再熬一次试试？";
  }

  function exploration(puzzle, revealedCount) {
    var total = puzzle.clues.length || 1;
    return Math.max(0, Math.min(100, Math.round((revealedCount / total) * 100)));
  }

  function getPuzzle(id) {
    var list = root.PUZZLES || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  /* 今日汤：按本地日期做确定性抽样 */
  function dailyPuzzle(date) {
    var d = date || new Date();
    var key = d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
    var h = 7;
    for (var i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 100003;
    var list = root.PUZZLES || [];
    if (!list.length) return null;
    return list[h % list.length];
  }

  function randomPuzzle(excludeId) {
    var list = (root.PUZZLES || []).filter(function (p) { return p.id !== excludeId; });
    if (!list.length) list = root.PUZZLES || [];
    return list[Math.floor(Math.random() * list.length)] || null;
  }

  /* ---------------- 细分类：题材标签 ---------------- */

  /* 题库里出现过的全部题材标签（按首次出现顺序，稳定可测） */
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

  function catsOf(p) {
    return (p && p.cats) || [];
  }

  function hasCat(p, cat) {
    if (!cat || cat === "全部") return true;
    return catsOf(p).indexOf(cat) !== -1;
  }

  /* 按条件筛出候选池
   * opts: { cat, difficulty(0/空=全部), unsolvedOnly, solvedMap, excludeIds } */
  function pool(opts) {
    var o = opts || {};
    var ex = o.excludeIds || [];
    return (root.PUZZLES || []).filter(function (p) {
      if (!hasCat(p, o.cat)) return false;
      if (o.difficulty && p.difficulty !== o.difficulty) return false;
      if (o.unsolvedOnly && o.solvedMap && o.solvedMap[p.id] && o.solvedMap[p.id].solved) return false;
      if (o.hardExclude && ex.indexOf(p.id) !== -1) return false;
      return true;
    });
  }

  /* 从池子里抽一题：优先避开 excludeIds；都抽过了就放宽，保证永远有得抽 */
  function drawFrom(list, excludeIds) {
    if (!list || !list.length) return null;
    var ex = excludeIds || [];
    var fresh = list.filter(function (p) { return ex.indexOf(p.id) === -1; });
    var usable = fresh.length ? fresh : list;
    return usable[Math.floor(Math.random() * usable.length)] || null;
  }

  /* 随机模式入口：按分类 / 难度 / 未解优先 抽一题 */
  function randomFrom(opts, excludeIds) {
    var o = opts || {};
    var list = pool(o);
    if (!list.length && o.unsolvedOnly) {
      /* 该条件下已经全部熬完了：退化成同分类的无限随机 */
      var relaxed = Object.assign({}, o, { unsolvedOnly: false });
      list = pool(relaxed);
    }
    return drawFrom(list, excludeIds);
  }

  function poolSize(opts) {
    return pool(opts).length;
  }

  var api = {
    normalize: normalize,
    hit: hit,
    stripLead: stripLead,
    ask: ask,
    judgeGuess: judgeGuess,
    stars: stars,
    starNote: starNote,
    exploration: exploration,
    getPuzzle: getPuzzle,
    dailyPuzzle: dailyPuzzle,
    randomPuzzle: randomPuzzle,
    allCats: allCats,
    catsOf: catsOf,
    hasCat: hasCat,
    pool: pool,
    drawFrom: drawFrom,
    randomFrom: randomFrom,
    poolSize: poolSize,
    VERDICT_LEAD: VERDICT_LEAD
  };

  root.SoupEngine = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
