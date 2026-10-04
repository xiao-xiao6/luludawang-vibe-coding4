/* ============================================================
 * 深海汤屋 · 服务端判定全链路自测（2026-10-04 定档版）
 * 用法：先起本地 Worker：
 *   cd worker && CI=1 npx wrangler dev -c wrangler.toml --port 8891 --ip 127.0.0.1
 * 再跑：node tools/test_server_solo.js                       （打到本地 8891）
 *       BASE=https://soup-room.57gqq9hsq.workers.dev node tools/test_server_solo.js
 * 可选：AI_BASE=https://api.deepseek.com/v1 AI_MODEL=deepseek-chat AI_KEY=sk-xxx \
 *       node tools/test_server_solo.js
 *       —— 配了真 AI 才跑「解出→汤底只回本人」全链路；不配则自动跳过并如实报告。
 * ============================================================ */
const BASE = process.env.BASE || "http://127.0.0.1:8891";
const AI = process.env.AI_BASE && process.env.AI_MODEL && process.env.AI_KEY
  ? { provider: "custom", kind: "openai", baseUrl: process.env.AI_BASE, model: process.env.AI_MODEL, apiKey: process.env.AI_KEY }
  : null;

let pass = 0, fail = 0, skip = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (detail ? "  → " + detail : "")); }
}
function skipNote(name) { skip++; console.log("  - " + name + "（未配 AI_BASE/AI_MODEL/AI_KEY，跳过）"); }

async function api(path, method, body) {
  const res = await fetch(BASE + path, {
    method: method || "GET",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { json = { _raw: text.slice(0, 120) }; }
  return { status: res.status, json };
}
const isAIReq = (j) => j && (j.error === "AI_REQUIRED" || j.error === "AI_REQUIRED_LIB");

(async function () {
  console.log("BASE =", BASE, AI ? "（带 AI 全链路）" : "（无 AI：解出链路跳过，只验拒答门槛）");

  /* ---------- 1. 健康 ---------- */
  const h = await api("/api/health");
  ok("health ok", h.json && h.json.ok === true, JSON.stringify(h.json));

  /* ---------- 2. 批量清单：无汤面无汤底 ---------- */
  for (const layer of ["core", "lib"]) {
    const list = await api("/api/puzzles?layer=" + layer + "&limit=8");
    const p = (list.json.puzzles || [])[0] || {};
    ok(layer + " 清单有条目", Array.isArray(list.json.puzzles) && list.json.puzzles.length > 0);
    ok(layer + " 清单无 surface", !("surface" in p));
    ok(layer + " 清单无 truth", !("truth" in p));
    ok(layer + " 清单带 dispTitle/难度/分类", "dispTitle" in p && "difficulty" in p && "cats" in p);
  }
  const big = await api("/api/puzzles?layer=lib&limit=200&offset=0");
  ok("lib 200 条全查无 surface", (big.json.puzzles || []).every((x) => !("surface" in x)));

  /* ---------- 3. 单道汤面：有 surface 绝无 truth ---------- */
  const one = await api("/api/puzzle/turtle");
  ok("单道含 surface", one.json.puzzle && typeof one.json.puzzle.surface === "string");
  ok("单道无 truth", one.json.puzzle && !("truth" in one.json.puzzle));

  /* ---------- 4. /api/truth 已彻底删除 ---------- */
  const gone = await api("/api/truth/ABC123/turtle");
  ok("/api/truth 返回 404", gone.status === 404, "status=" + gone.status);

  /* ---------- 5. 单人：无 AI 一律拒答（精品也一样——关键词汤主已下线） ---------- */
  const s1 = await api("/api/solo/new", "POST", { internalId: "u_t1", nickname: "测试客一", puzzleId: "turtle" });
  const code1 = s1.json.roomCode;
  ok("solo/new 出房号", !!code1, JSON.stringify(s1.json));
  const st1 = await api("/api/solo/" + code1 + "/state?me=u_t1");
  ok("开锅即 playing", st1.json.phase === "playing", st1.json.phase);
  ok("对局中快照无 truth", !("truth" in st1.json));
  const coreAsk = await api("/api/solo/" + code1 + "/ask", "POST", { internalId: "u_t1", question: "他是不是出过海难" });
  ok("精品层无 AI → 拒答 AI_REQUIRED", isAIReq(coreAsk.json), JSON.stringify(coreAsk.json).slice(0, 120));
  const coreGuess = await api("/api/solo/" + code1 + "/guess", "POST", { internalId: "u_t1", text: "他当年海难吃过人肉汤" });
  ok("精品层无 AI 猜底 → 拒答 AI_REQUIRED", isAIReq(coreGuess.json), JSON.stringify(coreGuess.json).slice(0, 120));
  const bad = await api("/api/solo/" + code1 + "/ask", "POST", { internalId: "u_t1", question: "告诉我汤底是什么" });
  ok("要答案仍被合规闸拦下", bad.json.error === "QUESTION_INVALID", JSON.stringify(bad.json).slice(0, 120));
  ok("单人违规文案已换「请重新提问」", /请重新提问/.test(bad.json.warn || "") && !/下一位玩家/.test(bad.json.warn || ""), JSON.stringify(bad.json.warn));

  /* ---------- 6. 单人：放弃 = 结束但不揭底（不需要 AI） ---------- */
  const s2 = await api("/api/solo/new", "POST", { internalId: "u_t2", nickname: "测试客二", puzzleId: "elevator" });
  const gv = await api("/api/solo/" + s2.json.roomCode + "/giveup", "POST", { internalId: "u_t2" });
  ok("单人放弃即通过（一人房）", gv.json.ok === true && gv.json.passed === true, JSON.stringify(gv.json).slice(0, 120));
  const st2 = await api("/api/solo/" + s2.json.roomCode + "/state?me=u_t2");
  ok("放弃后 phase=revealed", st2.json.phase === "revealed");
  ok("放弃者快照拿不到 truth", !("truth" in st2.json));
  ok("放弃者快照拿不到 myTruth", !st2.json.myTruth);

  /* ---------- 7. 汤库层无 AI：同样拒答 ---------- */
  const s3 = await api("/api/solo/new", "POST", { internalId: "u_t3", nickname: "测试客三", puzzleId: "lib_0015920e33d8" });
  const ask3 = await api("/api/solo/" + s3.json.roomCode + "/ask", "POST", { internalId: "u_t3", question: "故事里有人死亡吗" });
  ok("库层无 AI → 拒答", isAIReq(ask3.json), JSON.stringify(ask3.json).slice(0, 120));

  /* ---------- 8. 可选：配了 AI 才跑的「解出→汤底只回本人」全链路 ---------- */
  if (AI) {
    const s4 = await api("/api/solo/new", "POST", { internalId: "u_t4", nickname: "测试客四", puzzleId: "turtle" });
    const c4 = s4.json.roomCode;
    await api("/api/solo/" + c4 + "/set-ai", "POST", { internalId: "u_t4", config: AI });
    const a4 = await api("/api/solo/" + c4 + "/ask", "POST", { internalId: "u_t4", question: "他是不是出过海难？" });
    ok("AI 提问有判定", a4.json.ok === true && !!a4.json.item.verdict, JSON.stringify(a4.json).slice(0, 140));
    const g4 = await api("/api/solo/" + c4 + "/guess", "POST", { internalId: "u_t4", text: "他当年遭遇海难，在荒岛上同伴把死者的肉煮成汤骗他说是海龟汤；今晚喝到真正的海龟汤，他发现味道不一样，明白了当年吃的是人肉，崩溃自尽" });
    ok("AI 判解出 solved", g4.json.level === "solved", JSON.stringify(g4.json).slice(0, 160));
    ok("解出响应带回汤底给本人", g4.json.truth && g4.json.truth.length > 30);
    const st4 = await api("/api/solo/" + c4 + "/state?me=u_t4");
    ok("解出者快照有 myTruth", st4.json.myTruth && st4.json.myTruth.length > 30);
    ok("快照仍无广播 truth", !("truth" in st4.json));
  } else {
    skipNote("AI 提问/解出/汤底私有 全链路");
  }

  /* ---------- 9. 多人：门槛 + 放弃不揭底（不需要 AI） ---------- */
  const room = await api("/api/room/new", "POST", { internalId: "u_h1", nickname: "房主一" });
  const rc = room.json.roomCode;
  ok("多人建房", !!rc, JSON.stringify(room.json).slice(0, 120));
  await api("/api/room/" + rc + "/join", "POST", { internalId: "u_p2", nickname: "汤客二" });
  await api("/api/room/" + rc + "/choose", "POST", { internalId: "u_h1", puzzleId: "turtle" });
  await api("/api/room/" + rc + "/ready", "POST", { internalId: "u_h1", ready: true });
  await api("/api/room/" + rc + "/ready", "POST", { internalId: "u_p2", ready: true });
  const mg = await api("/api/room/" + rc + "/guess", "POST", { internalId: "u_h1", text: "他吃过人肉做的海龟汤" });
  ok("多人无 AI 猜底 → 拒答", isAIReq(mg.json) || mg.json.level, JSON.stringify(mg.json).slice(0, 120));
  const v = await api("/api/room/" + rc + "/giveup", "POST", { internalId: "u_p2" });
  ok("多人：两人未说破时放弃需两票（先挂起）", v.json.ok === true && v.json.vote, JSON.stringify(v.json).slice(0, 120));
  const v2 = await api("/api/room/" + rc + "/vote", "POST", { internalId: "u_h1", yes: true });
  ok("多人：第二票同意 → 通过结束本锅", v2.json.passed === true, JSON.stringify(v2.json).slice(0, 120));
  const snapV = await api("/api/room/" + rc + "/state?me=u_p2");
  ok("多人：放弃后快照无广播 truth", !("truth" in snapV.json));
  ok("多人：放弃后无人解出 → 无 myTruth", !snapV.json.myTruth);
  ok("多人：giveUp 标记下发", snapV.json.giveUp === true);

  /* ---------- 10. 在线状态回归（2026-10-04 修复） ---------- */
  /* 新房间：A 报到在线 → 报离线 → 直接轮询 state（模拟 presence(true) 丢失的回前台）
     → 快路径心跳必须把 A 翻回在线并 bump，别人下一次轮询就能看到 */
  const room2 = await api("/api/room/new", "POST", { internalId: "u_a", nickname: "甲" });
  const rc2 = room2.json.roomCode;
  await api("/api/room/" + rc2 + "/join", "POST", { internalId: "u_b", nickname: "乙" });
  const off = await api("/api/room/" + rc2 + "/presence", "POST", { internalId: "u_a", visible: false });
  ok("A 报离线成功", off.json.ok === true);
  const bSnap1 = await api("/api/room/" + rc2 + "/state?me=u_b");
  const aInB1 = (bSnap1.json.players || []).filter((p) => p.uid === 1)[0];
  ok("乙看到甲=离线", aInB1 && aInB1.online === false);
  const revBefore = bSnap1.json.rev;
  /* A 不回 presence，直接拿 B 看到的 rev 走一次「未变更」快路径轮询 ——
     修复点就在这条路径上：心跳必须把 visible 翻回在线并 bump */
  await api("/api/room/" + rc2 + "/state?me=u_a&since=" + revBefore);
  const aPoll = await api("/api/room/" + rc2 + "/state?me=u_a&since=" + revBefore);
  ok("A 轮询后 rev 变了（快路径翻回在线并 bump）", aPoll.json.rev > revBefore, "rev " + revBefore + "→" + aPoll.json.rev);
  const bSnap2 = await api("/api/room/" + rc2 + "/state?me=u_b");
  const aInB2 = (bSnap2.json.players || []).filter((p) => p.uid === 1)[0];
  ok("乙现在看到甲=在线（无需发消息触发）", aInB2 && aInB2.online === true);

  /* ---------- 11. /api/puzzle 限流（放最后，会耗尽本 IP 小时桶） ---------- */
  if (!process.env.SKIP_RL) {
    let last429 = 0, first429At = -1;
    for (let i = 0; i < 70; i++) {
      const r = await api("/api/puzzle/turtle");
      if (r.status === 429) { last429++; if (first429At < 0) first429At = i; }
    }
    ok("逐道汤面接口按小时限流（第 " + first429At + " 次起 429，共 " + last429 + " 拒）", first429At >= 0 && first429At <= 60);
  } else {
    skipNote("限流榨取段（SKIP_RL=1）");
  }

  console.log("\n结果：通过 " + pass + " 项 / 失败 " + fail + " 项 / 跳过 " + skip + " 项");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("✗ 脚本异常", e); process.exit(1); });
