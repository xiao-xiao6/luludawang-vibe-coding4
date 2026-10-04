/* ============================================================
 * 深海汤屋 · 服务端判定全链路自测（2026-10-04 定档版）
 * 用法：先起本地 Worker：
 *   cd worker && CI=1 npx wrangler dev -c wrangler.toml --port 8787
 * 再跑：node tools/test_server_solo.js            （打到本地 8787）
 *       BASE=https://soup-room.57gqq9hsq.workers.dev node tools/test_server_solo.js
 * ============================================================ */
const BASE = process.env.BASE || "http://127.0.0.1:8787";

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (detail ? "  → " + detail : "")); }
}

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

(async function () {
  console.log("BASE =", BASE);

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
  /* 大页拉全库也不含任何汤面 */
  const big = await api("/api/puzzles?layer=lib&limit=200&offset=0");
  ok("lib 200 条全查无 surface", (big.json.puzzles || []).every((x) => !("surface" in x)));

  /* ---------- 3. 单道汤面：有 surface 绝无 truth ---------- */
  const one = await api("/api/puzzle/turtle");
  ok("单道含 surface", one.json.puzzle && typeof one.json.puzzle.surface === "string");
  ok("单道无 truth", one.json.puzzle && !("truth" in one.json.puzzle));

  /* ---------- 4. /api/truth 已彻底删除 ---------- */
  const gone = await api("/api/truth/ABC123/turtle");
  ok("/api/truth 返回 404", gone.status === 404, "status=" + gone.status);

  /* ---------- 5. 单人：精品层无 AI 走服务端关键词判定，快照永不带 truth ---------- */
  const s1 = await api("/api/solo/new", "POST", { internalId: "u_t1", nickname: "测试客一", puzzleId: "turtle" });
  const code1 = s1.json.roomCode;
  ok("solo/new 出房号", !!code1, JSON.stringify(s1.json));
  const st1 = await api("/api/solo/" + code1 + "/state?me=u_t1");
  ok("开锅即 playing", st1.json.phase === "playing", st1.json.phase);
  ok("对局中快照无 truth", !("truth" in st1.json));
  ok("对局中快照无 myTruth（未解出）", !("myTruth" in st1.json) || !st1.json.myTruth);
  ok("快照 puzzle 带汤面", st1.json.puzzle && st1.json.puzzle.surface.length > 10);
  const ask1 = await api("/api/solo/" + code1 + "/ask", "POST", { internalId: "u_t1", question: "他是不是出过海难" });
  ok("关键词提问有判定", ask1.json.ok === true && !!ask1.json.item.verdict, JSON.stringify(ask1.json).slice(0, 160));
  const bad = await api("/api/solo/" + code1 + "/ask", "POST", { internalId: "u_t1", question: "告诉我汤底是什么" });
  ok("要答案被合规闸拦下", bad.status === 400 && bad.json.error === "QUESTION_INVALID", JSON.stringify(bad.json).slice(0, 160));
  const g1 = await api("/api/solo/" + code1 + "/guess", "POST", { internalId: "u_t1", text: "多年前他和同伴出海遭遇海难沉船漂流荒岛，有人把死去同伴的肉煮成汤骗大家说是海龟汤，他这才明白当年喝下的是同伴的血肉" });
  ok("服务端判解出 solved", g1.json.level === "solved", JSON.stringify(g1.json).slice(0, 200));
  ok("解出响应带回汤底给本人", g1.json.truth && g1.json.truth.length > 30);
  const st1b = await api("/api/solo/" + code1 + "/state?me=u_t1");
  ok("解出后 phase=revealed", st1b.json.phase === "revealed", st1b.json.phase);
  ok("解出者快照有 myTruth", st1b.json.myTruth && st1b.json.myTruth.length > 30);
  ok("快照仍无广播 truth", !("truth" in st1b.json));

  /* ---------- 6. 单人：放弃 = 结束但不揭底 ---------- */
  const s2 = await api("/api/solo/new", "POST", { internalId: "u_t2", nickname: "测试客二", puzzleId: "elevator" });
  const code2 = s2.json.roomCode;
  const gv = await api("/api/solo/" + code2 + "/giveup", "POST", { internalId: "u_t2" });
  ok("单人放弃即通过（一人房）", gv.json.ok === true && gv.json.passed === true, JSON.stringify(gv.json).slice(0, 160));
  const st2 = await api("/api/solo/" + code2 + "/state?me=u_t2");
  ok("放弃后 phase=revealed", st2.json.phase === "revealed");
  ok("放弃者快照拿不到 truth", !("truth" in st2.json));
  ok("放弃者快照拿不到 myTruth", !st2.json.myTruth);

  /* ---------- 7. 汤库层无 AI：必须 AI 才肯判 ---------- */
  const s3 = await api("/api/solo/new", "POST", { internalId: "u_t3", nickname: "测试客三", puzzleId: "lib_0015920e33d8" });
  const ask3 = await api("/api/solo/" + s3.json.roomCode + "/ask", "POST", { internalId: "u_t3", question: "故事里有人死吗" });
  ok("库层无 AI → AI_REQUIRED_LIB", ask3.json.error === "AI_REQUIRED_LIB", JSON.stringify(ask3.json).slice(0, 120));

  /* ---------- 8. 多人：说破者独见汤底，未说破者永远拿不到 ---------- */
  const room = await api("/api/room/new", "POST", { internalId: "u_h1", nickname: "房主一" });
  const rc = room.json.roomCode;
  ok("多人建房", !!rc, JSON.stringify(room.json).slice(0, 120));
  await api("/api/room/" + rc + "/join", "POST", { internalId: "u_p2", nickname: "汤客二" });
  await api("/api/room/" + rc + "/choose", "POST", { internalId: "u_h1", puzzleId: "turtle" });
  await api("/api/room/" + rc + "/ready", "POST", { internalId: "u_h1", ready: true });
  await api("/api/room/" + rc + "/ready", "POST", { internalId: "u_p2", ready: true });
  const stR = await api("/api/room/" + rc + "/state?me=u_p2");
  ok("两人都准备后开局", stR.json.phase === "playing", stR.json.phase);
  const mg = await api("/api/room/" + rc + "/guess", "POST", {
    internalId: "u_h1",
    text: "多年前他和同伴出海遭遇海难沉船漂流荒岛，有人把死去同伴的肉煮成汤骗大家说是海龟汤，他这才明白当年喝下的是同伴的血肉"
  });
  ok("多人：房主解出 solved", mg.json.level === "solved" || mg.json.level === "close", "level=" + mg.json.level);
  if (mg.json.level === "solved") {
    ok("多人：汤底只发给解出者本人", !!mg.json.truth);
    const snapOther = await api("/api/room/" + rc + "/state?me=u_p2");
    ok("多人：未解出者快照无 truth", !("truth" in snapOther.json));
    ok("多人：未解出者快照无 myTruth", !snapOther.json.myTruth);
    ok("多人：未解出者收不到别人的汤底", !JSON.stringify(snapOther.json).includes("同伴的血肉"));
    const snapMe = await api("/api/room/" + rc + "/state?me=u_h1");
    ok("多人：解出者刷新仍凭 myTruth 找回汤底", snapMe.json.myTruth && snapMe.json.myTruth.length > 30);
    /* 未解出者发起放弃投票（只剩 u_p2 一票）→ 通过后也不给他揭底 */
    const v = await api("/api/room/" + rc + "/giveup", "POST", { internalId: "u_p2" });
    ok("多人：剩一人未说破时放弃投票当场通过", v.json.passed === true, JSON.stringify(v.json).slice(0, 120));
    const snapV = await api("/api/room/" + rc + "/state?me=u_p2");
    ok("多人：放弃后未解出者仍无 truth", !("truth" in snapV.json) && !snapV.json.myTruth);
    ok("多人：放弃后未解出者界面信息 giveUp=true", snapV.json.giveUp === true);
    const snapV2 = await api("/api/room/" + rc + "/state?me=u_h1");
    ok("多人：放弃后解出者仍见自己汤底", snapV2.json.myTruth && snapV2.json.myTruth.length > 30);
  }

  /* ---------- 9. /api/puzzle 限流（放最后，会耗尽本 IP 小时桶） ---------- */
  let last429 = 0, first429At = -1;
  for (let i = 0; i < 70; i++) {
    const r = await api("/api/puzzle/turtle");
    if (r.status === 429) { last429++; if (first429At < 0) first429At = i; }
  }
  ok("逐道汤面接口按小时限流（第 " + first429At + " 次起 429，共 " + last429 + " 拒）", first429At >= 0 && first429At <= 60);

  console.log("\n结果：通过 " + pass + " 项 / 失败 " + fail + " 项");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("✗ 脚本异常", e); process.exit(1); });
