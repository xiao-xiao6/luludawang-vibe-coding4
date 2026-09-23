/* ============================================================
 * 深海汤屋 · 服务端题库构建
 * ------------------------------------------------------------
 * 产出两份 ES module：
 *   worker/src/puzzles.data.js  ← js/data.js + js/data-more.js（精品层，100 题）
 *   worker/src/library.data.js  ← js/library.data.js（汤库层，1361 题）
 *
 * 为什么要搬库层：库层原本把 truth 整段塞在前端，
 * F12 打开 library.data.js 就能直接看答案。搬进 Worker 后
 * 汤底只在服务端，前端拿不到（规格 #12 A1）。
 *
 * 用法：node tools/build_worker_data.js
 *       node tools/build_worker_data.js --check   （幂等自检，不写盘）
 * ============================================================ */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const JS = path.join(ROOT, "js");
const SRC = path.join(ROOT, "worker", "src");
const CHECK = process.argv.indexOf("--check") !== -1;

/* 汤库源码已在发布瘦身时搬出 js/，优先读 data/Library/ */
const LIB_SRC_FILE = [
  path.join(ROOT, "data", "Library", "library.data.js"),
  path.join(JS, "library.data.js")
].find((f) => fs.existsSync(f));
if (!LIB_SRC_FILE) {
  console.error("✗ 找不到汤库源码：data/Library/library.data.js 或 js/library.data.js");
  process.exit(1);
}

function loadSandbox(files, baseDir) {
  const sandbox = { console, Math, JSON, module: { exports: {} } };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  files.forEach((f) => {
    const src = fs.readFileSync(path.join(baseDir || JS, f), "utf8");
    vm.runInContext(src, sandbox, { filename: f });
  });
  return sandbox;
}

/* ---------------- 精品层 ---------------- */

const core = loadSandbox(["data.js", "data-more.js"]);
const coreList = core.PUZZLES || [];
if (!coreList.length) {
  console.error("✗ 没抽到任何精品题，检查 js/data.js");
  process.exit(1);
}

const coreSlim = coreList.map((p) => ({
  id: p.id,
  title: p.title,
  dispTitle: p.dispTitle,
  surface: p.surface,
  truth: p.truth,
  truthKeywords: p.truthKeywords || [],
  coreKeywords: p.coreKeywords || [],
  clues: (p.clues || []).map((c) => ({ type: c.type, kw: c.kw || [], text: c.text })),
  par: p.par,
  difficulty: p.difficulty,
  cats: p.cats || [],
  original: !!p.original,
  truthSource: p.truthSource,
  layer: "core"
}));

/* ---------------- 汤库层 ---------------- */

const lib = loadSandbox([path.basename(LIB_SRC_FILE)], path.dirname(LIB_SRC_FILE));
const libList = lib.SOUP_LIBRARY || [];
if (!libList.length) {
  console.error("✗ 没抽到任何库题，检查 js/library.data.js");
  process.exit(1);
}

/* 库层没有 clues / keywords，判定只能走 AI；
   汤面为空的题（mode=surface）压根不该上服务端，直接剔掉 */
const libSlim = libList
  .filter((p) => p && p.surface && p.truth && p.mode !== "surface")
  .map((p) => ({
    id: p.id,
    title: p.title,
    dispTitle: p.dispTitle,
    surface: p.surface,
    truth: p.truth,
    cats: p.cats || [],
    difficulty: p.difficulty,
    src: p.src,
    truthSource: p.truthSource,
    layer: "lib"
  }));

/* ---------------- 写盘 ---------------- */

function emit(outPath, banner, varName, list, extra, classic) {
  const body =
    banner +
    (classic ? "var " : "export const ") + varName + " = " +
    JSON.stringify(list) +
    ";\n" +
    (extra || "");
  if (CHECK) {
    const old = fs.existsSync(outPath) ? fs.readFileSync(outPath, "utf8") : "";
    if (old !== body) {
      console.error("✗ 产物与重建结果不一致：" + path.relative(ROOT, outPath));
      console.error("  请重跑 node tools/build_worker_data.js");
      process.exit(1);
    }
    return body;
  }
  fs.writeFileSync(outPath, body, "utf8");
  console.log("✓ 写入", path.relative(ROOT, outPath), "|", list.length, "题 |", (body.length / 1024).toFixed(1) + " KB");
  return body;
}

emit(
  path.join(SRC, "puzzles.data.js"),
  `/* 自动生成，请勿手改 —— 由 tools/build_worker_data.js 产出
 * 来源：js/data.js + js/data-more.js
 * 共 ${coreSlim.length} 题。汤底（truth）只存在服务端，前端拿不到。
 */
`,
  "PUZZLES",
  coreSlim,
  "\nexport const PUZZLE_INDEX = PUZZLES.reduce(function (m, p) { m[p.id] = p; return m; }, {});\n"
);

emit(
  path.join(SRC, "library.data.js"),
  `/* 自动生成，请勿手改 —— 由 tools/build_worker_data.js 产出
 * 来源：js/library.data.js（汤库层）
 * 共 ${libSlim.length} 题。汤底（truth）只存在服务端，前端拿不到。
 */
`,
  "SOUP_LIBRARY_SLIM",
  libSlim
);

/* ---------------- 前端题库（策略变更：不剥底，明文发布） ----------------
 * js/library.public.js：**含完整 truth**，进发布目录。
 * 【2026-09-23 策略变更】单人模式改走「本地真汤底」：前端必须拿到 truth
 * 才能让 AI 汤主吃真底判定（否则就是空底瞎编）。防作弊交给玩家自觉。
 * 多人房判定仍在服务端 Worker，不受影响。
 */
const libPublic = libList.map((p) => ({
  id: p.id,
  srcNo: p.srcNo,
  title: p.title || "",
  dispTitle: p.dispTitle || p.title || "",
  surface: p.surface || "",
  truth: p.truth || "",
  truthKeywords: p.truthKeywords || [],
  coreKeywords: p.coreKeywords || [],
  clues: p.clues || [],
  hints: p.hints || [],
  cats: p.cats || [],
  difficulty: p.difficulty,
  src: p.src || "",
  lang: p.lang || "",
  mode: p.mode || (p.truth ? "truth" : "surface"),
  hasTruth: !!(p.truth && p.mode !== "surface"),
  truthSource: p.truthSource || ""
}));

/* 策略变更后不再做「不能有 truth」的自检（现在 truth 是必须的）。
   保留一条正向自检：确认带底题目的 truth 真的落进了产物。 */
if (libPublic.filter((p) => p.hasTruth).some((p) => !String(p.truth || "").trim())) {
  console.error("✗ 权重异常：有 hasTruth=true 的题却没带上 truth");
  process.exit(1);
}

emit(
  path.join(JS, "library.public.js"),
  `/* ============================================================
 * 深海汤屋 · 汤库层（含水完整公开版）
 * ------------------------------------------------------------
 * 自动生成，请勿手改 —— 由 tools/build_worker_data.js 产出
 * 来源：js/library.data.js（同一份源，永不走样）
 *
 * 共 ${libPublic.length} 题（有汤底 ${libPublic.filter((p) => p.hasTruth).length} / 仅汤面 ${libPublic.length - libPublic.filter((p) => p.hasTruth).length}）。
 * 【策略】本文件**含完整汤底（truth）**，明文开源：供单人模式本地判定，
 * 也供任何人直接查阅。防作弊交给玩家自觉；多人房判定仍在服务端 Worker。
 * 重跑命令：node tools/build_worker_data.js
 * ============================================================ */
`,
  "SOUP_LIBRARY",
  libPublic,
  "\nvar SOUP_LIB_CATS = " + JSON.stringify(lib.SOUP_LIB_CATS || []) + ";\n" +
  "var SOUP_LIB_TOTAL = " + (lib.SOUP_LIB_TOTAL || libPublic.length) + ";\n" +
  "if (typeof module !== \"undefined\" && module.exports) {\n" +
  "  module.exports = { SOUP_LIBRARY: SOUP_LIBRARY, SOUP_LIB_CATS: SOUP_LIB_CATS, SOUP_LIB_TOTAL: SOUP_LIB_TOTAL };\n" +
  "}\n",
  true /* classic：这份是浏览器 <script src> 直接加载的普通脚本，必须用 var，不能用 export */
);

if (CHECK) console.log("✓ 产物幂等：两份题库文件与重建结果一致");
