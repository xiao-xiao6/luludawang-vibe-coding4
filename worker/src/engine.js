/* ============================================================
 * 深海汤屋 · 服务端判定引擎
 * ------------------------------------------------------------
 * 与前端 js/engine.js 同一套算法（关键词命中 / 最长命中优先 /
 * 防复述 / 汤底回声判通关）。搬进 Worker 是为了：
 *   - 汤底（truth）只留服务端，F12 拿不到
 *   - 单人 + 多人判定口径完全一致（规格 #12 A1）
 * ============================================================ */

import { PUZZLE_INDEX } from "./puzzles.data.js";
import { SOUP_LIBRARY_SLIM } from "./library.data.js";

/* 两层题共用一张索引：精品层（有线索/关键词，可关键词判定）
 * + 汤库层（只有汤面汤底，判定必须走 AI）。 */
const LIB_INDEX = SOUP_LIBRARY_SLIM.reduce(function (m, p) {
  p.layer = "lib";
  p.clues = p.clues || [];
  m[p.id] = p;
  return m;
}, {});

export const ALL_INDEX = Object.assign({}, PUZZLE_INDEX, LIB_INDEX);

export function puzzleLayer(id) {
  return PUZZLE_INDEX[id] ? "core" : (LIB_INDEX[id] ? "lib" : null);
}

var PUNCT = /[\s，。！？、,.?!~·“”"'‘’「」『』（）()《》【】\[\]{}：:；;\-—_…/\\|+=*&^%$#@<>]/g;

export function normalize(text) {
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

var LEAD_RE = /^(与此无关|部分正确|不是|是)[。.，,、]\s*/;
export function stripLead(text) {
  return String(text == null ? "" : text).replace(LEAD_RE, "");
}

function surfaceText(puzzle) {
  return normalize((puzzle && puzzle.surface) || "");
}

export function fromSurface(puzzle, kw) {
  var s = surfaceText(puzzle);
  var k = normalize(kw);
  if (!k) return true;
  return s.indexOf(k) !== -1;
}

export function effectiveKeywords(puzzle, list) {
  var out = [];
  for (var i = 0; i < (list || []).length; i++) {
    if (!fromSurface(puzzle, list[i])) out.push(list[i]);
  }
  return out;
}

var PRONOUNS = ["他", "她", "它", "他们", "她们", "它们", "谁"];

export function truthEcho(puzzle, g) {
  var t = normalize((puzzle && puzzle.truth) || "");
  var s = surfaceText(puzzle);
  if (!t || !g) return 0;
  var best = 0;
  for (var i = 0; i < t.length; i++) {
    for (var j = best + 1; i + j <= t.length; j++) {
      var seg = t.substr(i, j);
      if (g.indexOf(seg) === -1) break;
      if (s.indexOf(seg) !== -1) continue;
      best = j;
    }
  }
  return best;
}

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

var FOCUS_MAX = 16;
var TRUTH_ECHO_MIN = 10;

export function kwHit(text, kw) {
  var k = normalize(kw);
  if (!k) return false;
  if (PRONOUNS.indexOf(k) !== -1) return false;
  if (k.length < 2 && text.length > FOCUS_MAX) return false;
  return text.indexOf(k) !== -1;
}

export function bestClueMatch(puzzle, text, revealed) {
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

function isMeta(q) {
  var patterns = ["告诉我答案", "直接告诉我", "答案是什么", "汤底是什么", "公布答案", "给我答案", "我想放弃", "我要放弃"];
  for (var i = 0; i < patterns.length; i++) {
    if (q.indexOf(patterns[i]) !== -1) return true;
  }
  return false;
}

export var VERDICT_LEAD = {
  yes: "是。",
  no: "不是。",
  partial: "部分正确。",
  irr: "与此无关。"
};

var FLAVOR = ["汤主抬眼看了看你。", "汤面上的雾气动了动。", "汤主没有立刻回答。", "锅里的汤轻轻晃了一下。"];
var IMMATERIAL = ["与此无关。", "汤主摇了摇头。", "这一句和故事没有关系。"];
var META_REPLY = ["汤底要自己熬出来。", "别急着要答案，先去问问细节。"];

export function ask(puzzle, question, revealed) {
  var q = normalize(question);
  if (!q) return { kind: "empty" };

  if (isMeta(q)) {
    return { kind: "meta", verdict: "irr", reply: pick(META_REPLY) };
  }

  var fresh = bestClueMatch(puzzle, q, revealed || []);
  if (fresh) {
    return {
      kind: "clue",
      verdict: fresh.clue.type,
      reply: stripLead(fresh.clue.text),
      index: fresh.index,
      clue: fresh.clue,
      flavor: pick(FLAVOR)
    };
  }

  var known = bestClueMatch(puzzle, q, null);
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
    reply: pick(IMMATERIAL),
    flavor: Math.random() < 0.35 ? pick(FLAVOR) : ""
  };
}

function matchesAny(text, list) {
  var out = [];
  for (var i = 0; i < (list || []).length; i++) {
    if (hit(text, list[i]) && out.indexOf(list[i]) === -1) out.push(list[i]);
  }
  return out;
}

export function judgeGuess(puzzle, guess) {
  var g = normalize(guess);
  var tks = puzzle.truthKeywords || [];
  var cks = puzzle.coreKeywords || [];

  var recital = isSurfaceRecital(puzzle, g);

  var etks = recital ? [] : effectiveKeywords(puzzle, tks);
  var hits = matchesAny(g, etks);
  var cores = matchesAny(g, recital ? [] : cks);
  var echoed = matchesAny(g, tks).length - hits.length;
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

  if (truthEcho(puzzle, g) >= TRUTH_ECHO_MIN) {
    return Object.assign(base, { level: "solved", note: "对了！你说的就是汤底那一层。" });
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
  if (echoed >= 2) {
    return Object.assign(base, {
      level: "no",
      note: "你只是把汤面又念了一遍——汤主要的是你没说出口的那一层。"
    });
  }
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

export function stars(puzzle, questionCount, hintsUsed) {
  var par = (puzzle && puzzle.par) || 8;
  if (hintsUsed === 0 && questionCount <= par) return 3;
  if (hintsUsed <= 1 && questionCount <= par + 5) return 2;
  return 1;
}

export function starNote(n) {
  if (n >= 3) return "汤色清亮，一滴提示都没浪费——这锅熬得漂亮！";
  if (n === 2) return "味道不错，只是中间多搅了两下。";
  return "汤是端上来了，但火候全靠提示撑着。再熬一次试试？";
}

export function exploration(puzzle, revealedCount) {
  var total = (puzzle && puzzle.clues && puzzle.clues.length) || 1;
  return Math.max(0, Math.min(100, Math.round((revealedCount / total) * 100)));
}

export function getPuzzle(id) {
  return ALL_INDEX[id] || null;
}

/* 下发给前端的题面：**不含 truth**（汤底只在服务端） */
export function publicPuzzle(id) {
  var p = ALL_INDEX[id];
  if (!p) return null;
  return {
    id: p.id,
    title: p.title,
    dispTitle: p.dispTitle,
    surface: p.surface,
    par: p.par,
    difficulty: p.difficulty,
    cats: p.cats,
    original: p.original,
    truthSource: p.truthSource,
    src: p.src,
    layer: p.layer,
    clueCount: (p.clues || []).length
  };
}

export function allPuzzleIds() {
  return Object.keys(ALL_INDEX);
}

/* 精品层 id 清单：房主选汤面板只列精品层（库层 900+ 题留给「汤库」入口） */
export function corePuzzleIds() {
  return Object.keys(PUZZLE_INDEX);
}
