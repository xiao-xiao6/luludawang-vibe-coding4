/* ============================================================
 * 汤底污染防回归检查
 * ------------------------------------------------------------
 * 背景：汤底回收覆盖层（data/library/truth_recovery.json）会把爬虫页面的
 * 「下一篇标题 / 相关推荐 / 提示词泄漏」粘进 truth 尾巴。这些脏数据一路
 * 流进 soups.json → library.data.js → 构建产物，一旦重跑构建就会回流。
 *
 * 这个脚本把「哪些尾巴是污染」固化成可执行断言，任何一环重新变脏都会
 * 在这里报红，不用再靠肉眼比对。
 *
 * 用法：node tools/check_truth_pollution.js
 *       node tools/check_truth_pollution.js --quiet   # 只在失败时打印
 * ============================================================ */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const QUIET = process.argv.indexOf("--quiet") !== -1;

/* ---------- 污染特征 ----------
 * 只收「明确是爬虫/提示词残留」的形态，宁可漏也不误报：
 *   · 刻意保留的内容一律不算 —— 英文题的 (See also #1.31a, #1.59…) 交叉引用、
 *     主持人手册正文（「N. 根据汤底判断玩家…」那类）都在库里正常存在。
 *   · 因此 see-also 只认「孤立版」#1.31（当年被粘在中文题尾上的那条），
 *     带 a/b/c 后缀的正常交叉引用留给它。 */
const RULES = [
  ["章节残尾", /##\s*\d{1,3}\s*[.．、]?\s*《[^》\n]{1,40}》\s*$/],
  ["提示词泄漏", /【输出规则】|【回答格式】/],
  ["列表残尾", /(?<=[。！？…】])\s*\d{1,2}\s*[、.．]\s*(?:呜呜呜|一起走|赏罚分明)\s*$/],
  ["孤立交叉引用", /\(See also #1\.31\.\)\s*$/]
];

/* ---------- 被检查的文件 ----------
 * 覆盖「源头 → 中间产物 → 构建产物」整条链路。
 * 不在仓库里的（.gitignore）也照查，因为它们才是重跑构建的输入。 */
const TARGETS = [
  ["data/library/truth_recovery.json", "json", "汤底回收覆盖层（污染根因）"],
  ["data/library/truth_recovery_oldsite.json", "json", "老站回收覆盖层"],
  ["data/library/ai_truth.json", "json", "AI 编底覆盖层"],
  ["data/library/soups.json", "json", "中间产物（含全部题）"],
  ["js/library.data.js", "lines", "旧备源档"],
  ["data/Library/library.data.js", "array", "构建源档 ①（build 优先读它）"],
  ["js/library.public.js", "array", "发布产物 ②（明文含底）"],
  ["worker/src/library.data.js", "array", "服务端产物 ③（瘦身档）"]
];

function readIfExists(rel) {
  const p = path.join(ROOT, rel.split("/").join(path.sep));
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, "utf8");
}

/* 从 `var X = [...];` 里抠出数组体（按字符串感知的括号配平，不靠正则） */
function extractArray(text, names) {
  for (const name of names) {
    const m = new RegExp(name + "\\s*=\\s*\\[").exec(text);
    if (!m) continue;
    const start = text.indexOf("[", m.index);
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
      } else {
        if (c === '"') inStr = true;
        else if (c === "[") depth++;
        else if (c === "]") { depth--; if (depth === 0) return text.slice(start, i + 1); }
      }
    }
  }
  return null;
}

/* 行式格式：var X = [\n{...},\n{...},\n]; */
function extractLineArray(text, names) {
  for (const name of names) {
    const m = new RegExp(name + "\\s*=\\s*\\[").exec(text);
    if (!m) continue;
    const start = text.indexOf("[", m.index) + 1;
    const end = text.indexOf("\n];", start);
    if (end < 0) continue;
    const out = [];
    for (const line of text.slice(start, end).split("\n")) {
      const l = line.trim().replace(/,$/, "");
      if (!l.startsWith("{")) continue;
      try { out.push(JSON.parse(l)); } catch (e) { /* 跳过坏行 */ }
    }
    return JSON.stringify(out);
  }
  return null;
}

function loadEntries(rel, kind) {
  const text = readIfExists(rel);
  if (text === null) return { missing: true };
  const names = ["SOUP_LIBRARY_SLIM", "SOUP_LIBRARY"];

  let arrText = null;
  if (kind === "json") {
    try { return { list: JSON.parse(text) }; }
    catch (e) { return { error: "JSON 解析失败：" + e.message }; }
  }
  if (kind === "lines") arrText = extractLineArray(text, names);
  else arrText = extractArray(text, names);

  if (!arrText) return { error: "找不到题库数组" };
  try { return { list: JSON.parse(arrText) }; }
  catch (e) { return { error: "数组解析失败：" + e.message }; }
}

function toItems(list, rel) {
  if (Array.isArray(list)) return list;
  if (list && typeof list === "object") {
    /* truth_recovery.json 这种 {id: {...}} 映射 */
    return Object.keys(list).map((k) => Object.assign({ id: k }, list[k]));
  }
  return [];
}

let fail = 0;
let scanned = 0;

if (!QUIET) console.log("\n汤底污染防回归检查");
console.log("=".repeat(72));

for (const [rel, kind, label] of TARGETS) {
  const got = loadEntries(rel, kind);
  if (got.missing) {
    console.log("  - " + rel + "（不存在，跳过）");
    continue;
  }
  if (got.error) {
    console.log("  ✗ " + rel + "  " + got.error);
    fail++;
    continue;
  }
  const items = toItems(got.list, rel);
  const hits = [];
  for (const it of items) {
    const t = String((it && it.truth) || "");
    if (!t) continue;
    for (const [ruleName, rx] of RULES) {
      const m = rx.exec(t);
      if (m) { hits.push({ id: it.id, rule: ruleName, tail: t.slice(Math.max(0, m.index - 12)) }); break; }
    }
  }
  scanned += items.length;
  if (hits.length) fail++;
  const mark = hits.length ? "✗" : "✓";
  if (!QUIET || hits.length) {
    console.log("  " + mark + " " + rel.padEnd(42) + " " + String(items.length).padStart(4) + " 条  " + label);
    for (const h of hits.slice(0, 10)) {
      console.log("        · " + h.id + "  [" + h.rule + "]  ..." + JSON.stringify(h.tail.slice(-46)));
    }
    if (hits.length > 10) console.log("        · …还有 " + (hits.length - 10) + " 条");
  }
}

console.log("=".repeat(72));
console.log("扫描条目 " + scanned + " 条 · " + TARGETS.length + " 个文件");
console.log(fail === 0 ? "✅ 全链路无污染残留\n" : "❌ 有 " + fail + " 个文件仍带污染\n");
process.exit(fail === 0 ? 0 : 1);
