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
    var kws = (clue && clue.kw) || [];
    for (var i = 0; i < kws.length; i++) {
      if (kwHit(text, kws[i])) return true;
    }
    return false;
  }

  /* ---------------- 防「复述汤面」与「随手一问就出货」 ---------------- */

  /* 汤面（谜面）归一化文本：用来判断某个词是不是「汤面里本来就有的」 */
  function surfaceText(puzzle) {
    return normalize((puzzle && puzzle.surface) || "");
  }

  function fromSurface(puzzle, kw) {
    var s = surfaceText(puzzle);
    var k = normalize(kw);
    if (!k) return true;
    return s.indexOf(k) !== -1;
  }

  /* 只留下「不是从汤面抄来」的关键词，用来给猜汤底计分 */
  function effectiveKeywords(puzzle, list) {
    var out = [];
    for (var i = 0; i < (list || []).length; i++) {
      if (!fromSurface(puzzle, list[i])) out.push(list[i]);
    }
    return out;
  }

  /* 代词不能当关键词：玩家随口一句「他怎么了」不该掉线索 */
  var PRONOUNS = ["他", "她", "它", "他们", "她们", "它们", "谁"];

  /* 玩家提交的内容与汤底原文的最长公共子串长度：
     有些题的命中词恰好都出现在汤面里，会被上面的剥离逻辑拿掉，
     但只要他真的把汤底那层意思写出来了，就必须判通关。 */
  function truthEcho(puzzle, g) {
    var t = normalize((puzzle && puzzle.truth) || "");
    var s = surfaceText(puzzle);
    if (!t || !g) return 0;
    var best = 0;
    for (var i = 0; i < t.length; i++) {
      for (var j = best + 1; i + j <= t.length; j++) {
        var seg = t.substr(i, j);
        if (g.indexOf(seg) === -1) break;
        /* 这一段汤面里本来就写着：玩家只是抄了谜面，不算说破汤底 */
        if (s.indexOf(seg) !== -1) continue;
        best = j;
      }
    }
    return best;
  }

  /* 玩家是不是只是把汤面照抄了一遍：
     整句就是谜面原文，或者和谜面有大段连续重合 */
  var RECITAL_MIN = 12;

  function longestCommon(a, b) {
    var best = 0;
    for (var i = 0; i < a.length; i++) {
      for (var j = best + 1; i + j <= a.length; j++) {
        if (b.indexOf(a.substr(i, j)) === -1) break;
        best = j;
      }
    }
    return best;
  }

  /* 只有「整段就是在背谜面」才算照抄：
     汤底里与汤面重合的长句不能误伤（那是原文自带的重合） */
  var RECITAL_RATIO = 0.6;

  function isSurfaceRecital(puzzle, g) {
    var s = surfaceText(puzzle);
    if (!s || !g) return false;
    if (g.length >= 8 && s.indexOf(g) !== -1) return true;
    var common = longestCommon(s, g);
    if (common < RECITAL_MIN) return false;
    var span = Math.min(s.length, g.length);
    return common >= Math.ceil(span * RECITAL_RATIO);
  }

  /* 单字关键词只在「短而聚焦」的提问里算命中：
       问「灯亮着吗」算，问一长串顺带提到「灯」不算 */
  var FOCUS_MAX = 16;

  /* 与汤底原文字面重叠多少字就算玩家真的说破了 */
  var TRUTH_ECHO_MIN = 10;

  function kwHit(text, kw) {
    var k = normalize(kw);
    if (!k) return false;
    if (PRONOUNS.indexOf(k) !== -1) return false;
    if (k.length < 2 && text.length > FOCUS_MAX) return false;
    return text.indexOf(k) !== -1;
  }

  /* 最长命中优先：问得越准拿到的线索越深，不会被浅线索截胡 */
  function bestClueMatch(puzzle, text, revealed) {
    var best = null;
    for (var i = 0; i < puzzle.clues.length; i++) {
      if (revealed && hasIndex(revealed, i)) continue;
      var c = puzzle.clues[i];
      var kws = c.kw || [];
      for (var j = 0; j < kws.length; j++) {
        if (!kwHit(text, kws[j])) continue;
        var len = normalize(kws[j]).length;
        if (!best || len > best.len || (len === best.len && i < best.index)) {
          best = { index: i, clue: c, len: len, kw: kws[j] };
        }
      }
    }
    return best;
  }

  /* 玩家想直接要答案 / 放弃 */
  function isMeta(q) {
    var patterns = ["告诉我答案", "直接告诉我", "答案是什么", "汤底是什么", "公布答案", "给我答案", "我想放弃", "我要放弃"];
    for (var i = 0; i < patterns.length; i++) {
      if (q.indexOf(patterns[i]) !== -1) return true;
    }
    return false;
  }

  /* 找到「新」线索（未揭示过、命中关键词；最长命中优先） */
  function findFreshClue(puzzle, text, revealed) {
    return bestClueMatch(puzzle, text, revealed || []);
  }

  /* 找到「旧」线索（已经揭示过、玩家又问到同一话题） */
  function findKnownClue(puzzle, text) {
    return bestClueMatch(puzzle, text, null);
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

    /* 把谜面照抄一遍：全部命中清零，只有「说破汤底」才算数 */
    var recital = isSurfaceRecital(puzzle, g);

    /* 汤面里本来就有的关键词不算数：抄谜面不可能通关 */
    var etks = recital ? [] : effectiveKeywords(puzzle, tks);
    var hits = matchesAny(g, etks);
    /* 核心词例外：不少题的核心词本来就是谜面里写着的东西（冰箱、老人、电影票…），
       不能因为「汤面里出现过」就被剥掉；只有整句照抄谜面时才作废 */
    var cores = matchesAny(g, recital ? [] : cks);
    var echoed = matchesAny(g, tks).length - hits.length;  /* 只在汤面里出现过的命中数 */
    var threshold = Math.max(4, Math.ceil(etks.length * 0.34));

    var base = {
      chars: g.length,
      hits: hits,
      coreHits: cores,
      hitCount: hits.length,
      coreCount: cores.length,
      echoed: echoed,
      threshold: threshold
    };

    /* 把汤底那层意思原样写出来了：直接通关（长度阈值见 TRUTH_ECHO_MIN） */
    if (truthEcho(puzzle, g) >= TRUTH_ECHO_MIN) {
      return Object.assign(base, { level: "solved", note: "对了！你说的就是汤底那一层。" });
    }
    /* 先算命中：答对了就该通关，不管句子长短 */
    if (cores.length >= 1 && hits.length >= 3) {
      return Object.assign(base, { level: "solved", note: "对了！你把最关键的那一层说破了。" });
    }
    if (hits.length >= threshold) {
      return Object.assign(base, { level: "solved", note: "对了一大片！汤底就是你说的这个样子。" });
    }
    if (cores.length >= 1 || hits.length >= 2) {
      return Object.assign(base, { level: "close", note: "已经很近了——你摸到了关键，但还差最后一层。" });
    }
    /* 只把汤面复述了一遍：明确点破，别让玩家误以为快到了 */
    if (echoed >= 2) {
      return Object.assign(base, {
        level: "no",
        note: "你只是把汤面又念了一遍——汤主要的是你没说出口的那一层。"
      });
    }
    /* 零命中时才看长度：太短就提示把话说完整 */
    if (g.length < 10) {
      return Object.assign(base, {
        level: "vague",
        note: "汤主听见了，但你得把「谁、为什么、怎么做的」串成完整的一句。"
      });
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

  /* 今日汤：按「东八区」切天做确定性抽样。
     用固定时区而不是设备本地时间：全国玩家同一天拿到同一道题，
     设备时区换来换去也不会突然换题。 */
  var DAY_TZ_OFFSET = 480;   /* 分钟，UTC+8 */

  function pad2(n) { return n < 10 ? "0" + n : String(n); }

  function dayKey(date) {
    var d = date || new Date();
    var u = new Date(d.getTime() + DAY_TZ_OFFSET * 60000);
    return u.getUTCFullYear() + "-" + pad2(u.getUTCMonth() + 1) + "-" + pad2(u.getUTCDate());
  }

  function dailyPuzzleFromKey(key) {
    var k = String(key == null ? "" : key);
    var list = root.PUZZLES || [];
    if (!k || !list.length) return null;
    var h = 7;
    for (var i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) % 100003;
    return list[h % list.length];
  }

  function dailyPuzzle(date) {
    return dailyPuzzleFromKey(dayKey(date));
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
   * opts: { cat, difficulty(0/空=全部), excludeIds } */
  function pool(opts) {
    var o = opts || {};
    var ex = o.excludeIds || [];
    return (root.PUZZLES || []).filter(function (p) {
      if (!hasCat(p, o.cat)) return false;
      if (o.difficulty && p.difficulty !== o.difficulty) return false;
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

  /* 随机模式入口：按分类 / 难度抽一题 */
  function randomFrom(opts, excludeIds) {
    return drawFrom(pool(opts || {}), excludeIds);
  }

  function poolSize(opts) {
    return pool(opts).length;
  }

  /* ---------------- 汤库层（与精品层 PUZZLES 完全隔离） ---------------- */

  /* 库层题材列表：用库自己的受控词表，绝不吃 allCats(PUZZLES) */
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

  /* 库层检索：导入期已预计算 _t = normalize(dispTitle + "\n" + surface) */
  function searchLibrary(list, kw) {
    var k = normalize(kw);
    if (!k) return list || [];
    return (list || []).filter(function (p) {
      if (!p) return false;
      var t = p._t;
      if (typeof t !== "string") t = normalize((p.dispTitle || p.title || "") + "\n" + (p.surface || ""));
      return t.indexOf(k) !== -1;
    });
  }

  /* 库层筛选 */
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

  /* 库层随机抽题：对齐 drawFrom 的签名与兜底语义 */
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
    hit: hit,
    kwHit: kwHit,
    surfaceText: surfaceText,
    fromSurface: fromSurface,
    effectiveKeywords: effectiveKeywords,
    bestClueMatch: bestClueMatch,
    truthEcho: truthEcho,
    stripLead: stripLead,
    ask: ask,
    judgeGuess: judgeGuess,
    stars: stars,
    starNote: starNote,
    exploration: exploration,
    getPuzzle: getPuzzle,
    dailyPuzzle: dailyPuzzle,
    dailyPuzzleFromKey: dailyPuzzleFromKey,
    dayKey: dayKey,
    randomPuzzle: randomPuzzle,
    allCats: allCats,
    catsOf: catsOf,
    hasCat: hasCat,
    libraryCats: libraryCats,
    searchLibrary: searchLibrary,
    libraryPool: libraryPool,
    drawFromLibrary: drawFromLibrary,
    pool: pool,
    drawFrom: drawFrom,
    randomFrom: randomFrom,
    poolSize: poolSize,
    VERDICT_LEAD: VERDICT_LEAD
  };

  root.SoupEngine = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
