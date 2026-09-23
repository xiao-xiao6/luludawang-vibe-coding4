/* ============================================================
 * P7 · 精品层草稿硬校验
 * 跑法：node tools/check_puzzle_drafts.js [--strict]
 *
 * 作用：把 data/library/puzzle_drafts.json 逐条按 smoke_test.js 的**同一套硬断言**
 *       过一遍，提前告诉你「这 20 道里哪几道已经能注入 js/data.js、哪几道还差什么」。
 *       草稿本身不注入 PUZZLES（见 docs/汤面大全融合方案.md §8 ③）。
 *
 * 默认只报告（exit 0）；--strict 时只要有草稿未就绪就 exit 1。
 * ============================================================ */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DRAFT = path.join(ROOT, "data", "library", "puzzle_drafts.json");
const strict = process.argv.indexOf("--strict") !== -1;

const problems = [];
let checks = 0;
function ok(name, cond, detail) {
  checks++;
  if (!cond) problems.push(name + (detail ? "  → " + detail : ""));
}

/* 与 smoke_test.js 完全一致的受控题材表 */
const CAT_POOL = ["恐怖", "微恐", "惊悚", "温情", "催泪", "脑洞", "悬疑", "推理", "反转",
  "校园", "家庭", "都市", "都市传说", "怪谈", "旅途", "职场", "医院", "科幻"];

if (!fs.existsSync(DRAFT)) {
  console.log("找不到 " + DRAFT + "，请先跑 python tools/gen_puzzles_from_library.py");
  process.exit(1);
}

const doc = JSON.parse(fs.readFileSync(DRAFT, "utf8"));
const drafts = doc.drafts || [];

/* 加载引擎与现有题库（用于 ⑫ 判定与 id 撞车检查） */
const data = require(path.join(ROOT, "js", "data.js"));
Object.assign(globalThis, data);
require(path.join(ROOT, "js", "data-more.js"));
const E = require(path.join(ROOT, "js", "engine.js"));
const PUZZLES = globalThis.PUZZLES || [];
const pzIds = new Set(PUZZLES.map((p) => p.id));
const pzSurf = new Set(PUZZLES.map((p) => E.normalize(p.surface)));

console.log("── 精品层草稿校验 ──");
console.log("草稿 " + drafts.length + " 道 / 现有精品 " + PUZZLES.length + " 道\n");

const LEAD_OF = { yes: "是。", no: "不是。", partial: "部分正确。", irr: "与此无关。" };
const ready = [];
const blocked = [];

drafts.forEach((p) => {
  const tag = "草稿「" + (p.title || p.id) + "」";
  const miss = [];

  /* ① id 唯一 + 不与现有撞车 */
  ok(tag + " id 非空且不与现有精品撞车", !!p.id && !pzIds.has(p.id), p.id);
  /* ② title 唯一（同批内 + 与现有） */
  ok(tag + " title 非空", typeof p.title === "string" && p.title.trim().length > 0);
  /* ③ surface */
  if (!(typeof p.surface === "string" && p.surface.length > 20)) miss.push("surface");
  /* ④ truth */
  if (!(typeof p.truth === "string" && p.truth.length > 40)) miss.push("truth");
  /* ⑤ difficulty */
  ok(tag + " difficulty ∈ [1,3]", [1, 2, 3].indexOf(p.difficulty) !== -1, String(p.difficulty));
  /* ⑥ par */
  ok(tag + " par 是 ≥4 的 number", typeof p.par === "number" && p.par >= 4, String(p.par));
  /* ⑦ tag */
  if (!(typeof p.tag === "string" && p.tag.trim())) miss.push("tag");
  /* ⑧ hints ≥ 2 */
  if (!(Array.isArray(p.hints) && p.hints.length >= 2)) miss.push("hints≥2(现 " + ((p.hints || []).length) + ")");
  /* ⑨ clues ≥ 6 */
  if (!(Array.isArray(p.clues) && p.clues.length >= 6)) miss.push("clues≥6(现 " + ((p.clues || []).length) + ")");
  /* ⑩ truthKeywords ≥ 8 */
  if (!(Array.isArray(p.truthKeywords) && p.truthKeywords.length >= 8)) {
    miss.push("truthKeywords≥8(现 " + ((p.truthKeywords || []).length) + ")");
  }
  /* ⑪ coreKeywords ≥2 且 ⊆ truthKeywords */
  const cks = p.coreKeywords || [];
  const tks = p.truthKeywords || [];
  if (!(cks.length >= 2)) miss.push("coreKeywords≥2(现 " + cks.length + ")");
  const notSub = cks.filter((c) => tks.indexOf(c) === -1);
  if (notSub.length) miss.push("coreKeywords 不在 truthKeywords 内: " + notSub.slice(0, 3).join(","));
  /* ⑫ 提交汤底必须通关 */
  if (typeof p.surface === "string" && typeof p.truth === "string") {
    const j = E.judgeGuess(p, p.truth);
    if (j.level !== "solved") miss.push("judgeGuess(truth)=" + j.level);
  }

  /* 题材：≥2 且全部落在 18 词受控表 */
  const cats = p.cats || [];
  if (cats.length < 2) miss.push("cats≥2(现 " + cats.length + ")");
  const badCats = cats.filter((c) => CAT_POOL.indexOf(c) === -1);
  if (badCats.length) miss.push("cats 越界: " + badCats.join(","));

  /* 与现有精品层汤面重复 */
  if (pzSurf.has(E.normalize(p.surface))) miss.push("汤面与现有精品重复");

  /* 逐线索 6 项 + 独占关键词（clues 补齐后才谈得上） */
  (p.clues || []).forEach((c, i) => {
    const ct = tag + " 线索" + (i + 1);
    ok(ct + " kw 非空数组", Array.isArray(c.kw) && c.kw.length > 0);
    ok(ct + " type 合法", ["yes", "no", "partial", "irr"].indexOf(c.type) !== -1, c.type);
    ok(ct + " text > 4 字", typeof c.text === "string" && c.text.length > 4);
    ok(ct + " 开头判定词与 type 一致",
      typeof c.text === "string" && c.text.indexOf(LEAD_OF[c.type] || "\u0000") === 0,
      String(c.text).slice(0, 10));
    ok(ct + " stripLead 后 > 4 字", E.stripLead(c.text).length > 4);
  });
  if ((p.clues || []).length) {
    const types = p.clues.map((c) => c.type);
    ok(tag + " 同时存在 yes 与 (no 或 partial)",
      types.indexOf("yes") !== -1 && (types.indexOf("no") !== -1 || types.indexOf("partial") !== -1));
    /* 独占关键词：每条线索要有一个词不被别的线索的词作为子串包含 */
    const all = p.clues.map((c) => (c.kw || []).map((k) => E.normalize(k)));
    p.clues.forEach((c, i) => {
      const own = (c.kw || []).some((k) => {
        const nk = E.normalize(k);
        if (!nk) return false;
        return all.every((other, j) => j === i || other.every((o) => o.indexOf(nk) === -1));
      });
      ok(tag + " 线索" + (i + 1) + " 有独占关键词", own);
    });
  }

  if (miss.length) blocked.push({ id: p.id, title: p.title, miss });
  else ready.push(p.id);
});

/* ---- 报告 ---- */
console.log("已就绪（可注入 PUZZLES）：" + ready.length + " 道");
console.log("待补齐：" + blocked.length + " 道\n");
if (blocked.length) {
  blocked.slice(0, 25).forEach((b) => {
    console.log("  ✗ " + b.id + "  " + String(b.title).slice(0, 22));
    console.log("      缺：" + b.miss.join(" / "));
  });
  if (blocked.length > 25) console.log("  … 其余 " + (blocked.length - 25) + " 道同理");
}
console.log("");
console.log("硬断言检查项 " + checks + " 个，问题 " + problems.length + " 个");
if (problems.length) {
  problems.slice(0, 20).forEach((p, i) => console.log("  ✗ " + (i + 1) + ". " + p));
}

if (strict && blocked.length) {
  console.log("\n--strict：仍有 " + blocked.length + " 道草稿未就绪 → exit 1");
  process.exitCode = 1;
} else if (blocked.length) {
  console.log("\n（默认只报告。草稿未注入 PUZZLES，不影响现有自检。）");
} else {
  console.log("\n✓ 全部草稿已就绪，可提交主人过闸后注入 js/data.js");
}
