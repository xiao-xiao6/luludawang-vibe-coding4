/* ============================================================
 * 深海汤屋 · 题库构建（2026-10-04 服务端判定版）
 * ------------------------------------------------------------
 * 母本（全部只留在本机，不进 git）：
 *   data/core/master-data.js + master-data-more.js  精品层 100 题（含 truth/clues）
 *   data/library/library.data.js                   汤库层母本（含 truth）
 *
 * 产出：
 *   worker/src/puzzles.data.js   精品层全量（含 truth）——服务端专用
 *   worker/src/library.data.js   汤库层全量（含 truth）——服务端专用
 *   js/data.js                   精品层元信息（id/title/cats/difficulty/par，无 surface 无 truth）
 *   js/data-more.js              精品层元信息分片（其余 80 题）
 *   js/library.list.js           汤库层元信息（无 surface 无 truth）
 *
 * 【策略】汤面（surface）与汤底（truth）都不再进浏览器包：
 *   汤面逐道走 GET /api/puzzle/:id（服务端限流），
 *   汤底只在 Worker 服务端，AI 汤主判定「解出」后才发给解出者本人。
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

const LIB_SRC_FILE = path.join(ROOT, "data", "library", "library.data.js");
const CORE_MASTER = ["master-data.js", "master-data-more.js"].map((f) =>
  path.join(ROOT, "data", "core", f));
[LIB_SRC_FILE].concat(CORE_MASTER).forEach((f) => {
  if (!fs.existsSync(f)) {
    console.error("✗ 找不到母本：" + path.relative(ROOT, f));
    process.exit(1);
  }
});

function loadSandbox(files, baseDir) {
  const sandbox = { console, Math, JSON, module: { exports: {} } };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  files.forEach((f) => {
    const src = fs.readFileSync(path.join(baseDir, f), "utf8");
    vm.runInContext(src, sandbox, { filename: f });
  });
  return sandbox;
}

/* ---------------- 精品层（母本：data/core/） ---------------- */

const core = loadSandbox(CORE_MASTER.map((f) => path.basename(f)), path.join(ROOT, "data", "core"));
const coreList = core.PUZZLES || [];
if (coreList.length < 100) {
  console.error("✗ 精品层母本题数异常：" + coreList.length);
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

/* 浏览器端精品层：只留浏览/筛选/结算要用的元信息，绝无 surface / truth */
function coreMeta(p) {
  return {
    id: p.id,
    title: p.title || "",
    tag: p.tag || "",
    cats: p.cats || [],
    difficulty: p.difficulty,
    par: p.par,
    original: !!p.original,
    layer: "core"
  };
}
const coreMetaList = coreList.map(coreMeta);

/* ---------------- 汤库层（母本：data/library/） ---------------- */

const lib = loadSandbox([path.basename(LIB_SRC_FILE)], path.dirname(LIB_SRC_FILE));
const libList = lib.SOUP_LIBRARY || [];
if (!libList.length) {
  console.error("✗ 没抽到任何库题，检查 data/library/library.data.js");
  process.exit(1);
}

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

const libMeta = libSlim.map((p) => ({
  id: p.id,
  title: p.title || "",
  dispTitle: p.dispTitle || p.title || "",
  cats: p.cats || [],
  difficulty: p.difficulty,
  src: p.src || "",
  truthSource: p.truthSource || "",
  mode: "truth",
  hasTruth: true,
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
 * 来源：data/core/master-data.js + master-data-more.js（精品层母本，只留本机）
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
 * 来源：data/library/library.data.js（汤库层母本，只留本机）
 * 共 ${libSlim.length} 题。汤底（truth）只存在服务端，前端拿不到。
 */
`,
  "SOUP_LIBRARY_SLIM",
  libSlim
);

/* ---------------- 浏览器端产物（一律不含 surface / truth） ---------------- */

/* 硬自检：任何浏览器产物里出现 surface/truth 字段即构建失败 */
function assertNoSecrets(list, label) {
  const bad = list.filter((p) => ("surface" in p) || ("truth" in p) || ("truthKeywords" in p) || ("coreKeywords" in p) || ("clues" in p) || ("hints" in p));
  if (bad.length) {
    console.error("✗ " + label + " 混入了敏感字段（surface/truth/clues/hints/keywords）：" + bad.length + " 条");
    process.exit(1);
  }
}
assertNoSecrets(coreMetaList, "js/data.js");
assertNoSecrets(libMeta, "js/library.list.js");

emit(
  path.join(JS, "data.js"),
  `/* ============================================================
 * 深海汤屋 · 精品层元信息（自动生成，请勿手改）
 * 由 tools/build_worker_data.js 产出；母本在 data/core/（只留本机）。
 * 只有浏览/筛选/结算要用的元信息：绝无汤面（surface）与汤底（truth）。
 * 汤面逐道向 Worker GET /api/puzzle/:id 获取；判定全在服务端。
 * ============================================================ */
`,
  "PUZZLES",
  coreMetaList,
  "\nvar PUZZLES_TOTAL = " + coreMetaList.length + ";\n" +
  "if (typeof module !== \"undefined\" && module.exports) { module.exports = { PUZZLES: PUZZLES, PUZZLES_TOTAL: PUZZLES_TOTAL }; }\n",
  true
);

emit(
  path.join(JS, "data-more.js"),
  `/* ============================================================
 * 深海汤屋 · 精品层元信息分片（自动生成，请勿手改）
 * 首屏之后的其余精品题；由 app.js 异步拉回并并入 PUZZLES。
 * 与 js/data.js 同口径：只有元信息，无 surface / truth。
 * ============================================================ */
`,
  "PUZZLES_META_MORE",
  coreMetaList.slice(20),
  "\n(function (root) {\n" +
  "  \"use strict\";\n" +
  "  if (Array.isArray(root.PUZZLES) && PUZZLES_META_MORE.length) {\n" +
  "    for (var i = 0; i < PUZZLES_META_MORE.length; i++) {\n" +
  "      var p = PUZZLES_META_MORE[i];\n" +
  "      var dup = false;\n" +
  "      for (var k = 0; k < root.PUZZLES.length; k++) {\n" +
  "        if (root.PUZZLES[k].id === p.id) { dup = true; break; }\n" +
  "      }\n" +
  "      if (!dup) root.PUZZLES.push(p);\n" +
  "    }\n" +
  "  }\n" +
  "  if (typeof module !== \"undefined\" && module.exports) { module.exports = { PUZZLES_META_MORE: PUZZLES_META_MORE }; }\n" +
  "})(typeof globalThis !== \"undefined\" ? globalThis : this);\n",
  true
);

emit(
  path.join(JS, "library.list.js"),
  `/* ============================================================
 * 深海汤屋 · 汤库层元信息（自动生成，请勿手改）
 * 由 tools/build_worker_data.js 产出；母本在 data/library/（只留本机）。
 * 共 ${libMeta.length} 题。只有汤名/分类/火候/来源等元信息：
 * 绝无汤面（surface），绝无汤底（truth）。
 * 汤面逐道向 Worker GET /api/puzzle/:id 获取（服务端限流）；
 * 判定与汤底全在 Worker 服务端，AI 汤主判「解出」才发给解出者本人。
 * ============================================================ */
`,
  "SOUP_LIBRARY",
  libMeta,
  "\nvar SOUP_LIB_CATS = " + JSON.stringify(lib.SOUP_LIB_CATS || []) + ";\n" +
  "var SOUP_LIB_TOTAL = " + libMeta.length + ";\n" +
  "if (typeof module !== \"undefined\" && module.exports) {\n" +
  "  module.exports = { SOUP_LIBRARY: SOUP_LIBRARY, SOUP_LIB_CATS: SOUP_LIB_CATS, SOUP_LIB_TOTAL: SOUP_LIB_TOTAL };\n" +
  "}\n",
  true
);

/* 旧版含汤底的浏览器包：清掉，不再产出 */
const oldPublic = path.join(JS, "library.public.js");
if (!CHECK && fs.existsSync(oldPublic)) {
  fs.unlinkSync(oldPublic);
  console.log("✓ 已删除旧含底包 js/library.public.js");
}

if (CHECK) console.log("✓ 产物幂等：五份题库文件与重建结果一致");
