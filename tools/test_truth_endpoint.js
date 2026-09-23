/* ============================================================
 * 深海汤屋 · 汤底接口回归测试
 * ------------------------------------------------------------
 * 验证 GET /api/truth/:roomCode/:puzzleId 的鉴权边界（规格 #12 A1）：
 *   1. 未揭晓        → 403
 *   2. 房号不存在    → 404
 *   3. 题号不匹配    → 403
 *   4. 揭晓后        → 200 且汤底与源文件逐字一致
 *
 * 注：库题判定必须走服务端 AI（无 key 时 400 AI_REQUIRED_LIB），
 * 所以「揭晓后放行」这条正向路径用**精品层**题验证（关键词判定，无需 key）。
 *
 * 用法：node tools/test_truth_endpoint.js
 *       SOUP_BASE=https://... node tools/test_truth_endpoint.js
 * ============================================================ */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const BASE = process.env.SOUP_BASE || "https://soup-room.57gqq9hsq.workers.dev";
const ME = "u_truthtest" + Date.now();

function loadLibrary() {
  const f = [
    path.join(ROOT, "data", "library", "library.data.js"),
    path.join(ROOT, "js", "library.data.js")
  ].find((x) => fs.existsSync(x));
  if (!f) throw new Error("找不到汤库源码（data/library/library.data.js）");
  const sb = { console, Math, JSON, module: { exports: {} } };
  sb.window = sb;
  sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(f, "utf8"), sb, { filename: f });
  return sb.SOUP_LIBRARY || [];
}

/* 精品层：带 clues，判定走关键词，无需 AI key */
function loadCore() {
  const sb = { console, Math, JSON, module: { exports: {} } };
  sb.window = sb;
  sb.globalThis = sb;
  vm.createContext(sb);
  ["data.js", "data-more.js"].forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(ROOT, "js", f), "utf8"), sb, { filename: f });
  });
  return sb.PUZZLES || [];
}

async function api(p, method, body) {
  const r = await fetch(BASE + p, {
    method: method || "GET",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  let j = null;
  try { j = await r.json(); } catch (e) { /* 非 JSON 也照常返回 */ }
  return { status: r.status, body: j };
}

let pass = 0;
let fail = 0;
function check(name, got, want) {
  const ok = got === want;
  if (ok) pass++; else fail++;
  console.log((ok ? "✓" : "✗") + " " + name + "  （期望 " + want + "，实际 " + got + "）");
}

(async () => {
  const lib = loadLibrary();
  const core = loadCore();

  /* 鉴权边界用库题（服务端有底） */
  const pz = lib.filter((p) => p.mode === "truth" && (p.truth || "").length > 60)[0];
  if (!pz) throw new Error("汤库里找不到带汤底的题");

  /* 正向路径用精品题：关键词判定，无需 AI key */
  const cp = core.filter((p) => (p.truthKeywords || []).length && (p.truth || "").length > 20)[0];
  if (!cp) throw new Error("精品层里找不到可判定的题");

  console.log("鉴权题（库层）：" + pz.id + " / " + (pz.dispTitle || pz.title));
  console.log("正向题（精品）：" + cp.id + " / " + (cp.dispTitle || cp.title) + "\n");

  const created = await api("/api/room/new", "POST", { internalId: ME, nickname: "汤底测试" });
  const code = created.body && created.body.roomCode;
  if (!code) throw new Error("建房失败：" + JSON.stringify(created));
  console.log("房号：" + code + "\n");

  await api("/api/room/" + code + "/choose", "POST", { internalId: ME, puzzleId: pz.id });

  let r = await api("/api/truth/" + code + "/" + pz.id);
  check("未揭晓取汤底被拒", r.status, 403);

  r = await api("/api/truth/ZZZZZZ/" + pz.id);
  check("房号不存在", r.status, 404);

  const other = lib.filter((p) => p.id !== pz.id)[0];
  r = await api("/api/truth/" + code + "/" + other.id);
  check("题号不匹配被拒", r.status, 403);

  /* ---- 正向：换精品题，用真关键词推理通关 ---- */
  await api("/api/room/" + code + "/choose", "POST", { internalId: ME, puzzleId: cp.id });
  await api("/api/room/" + code + "/ready", "POST", { internalId: ME, ready: true });

  const guessText = (cp.truthKeywords || []).concat(cp.coreKeywords || []).join("、") || cp.truth;
  const g = await api("/api/room/" + code + "/guess", "POST", { internalId: ME, text: guessText });
  console.log("  推理判定：" + (g.body && g.body.level) + " / " + (g.body && g.body.note));

  const st = await api("/api/room/" + code + "/state?me=" + encodeURIComponent(ME));
  check("揭晓后 phase", st.body && st.body.phase, "revealed");

  r = await api("/api/truth/" + code + "/" + cp.id);
  check("揭晓后取汤底放行", r.status, 200);
  if (r.status === 200) {
    const same = (r.body.truth || "") === (cp.truth || "");
    console.log((same ? "✓" : "✗") + " 汤底内容与源文件逐字一致");
    if (same) pass++; else fail++;
  }

  /* 揭晓后：拿另一道题的底仍然要被拒 */
  r = await api("/api/truth/" + code + "/" + pz.id);
  check("揭晓后取别题汤底仍被拒", r.status, 403);

  console.log("\n" + (fail ? "✗ 有 " + fail + " 项失败" : "✓ 全部通过") + "（共 " + pass + " 项）");
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("✗ " + e.message);
  process.exit(1);
});
