/* ============================================================
 * 说破战况统计 + 播报人数联动 回归（2026-09-26）
 * 前置：node tools/mock_soup_ai.mjs（:8790）+ npx wrangler dev -p 8788
 * 跑法：node tools/test_guess_stats.mjs
 * ============================================================ */
const BASE = process.env.SOUP_API || "http://127.0.0.1:8788";

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log("  \x1b[32m✓\x1b[0m " + name); }
  else {
    fail++;
    console.log("  \x1b[31m✗ " + name + "\x1b[0m" + (extra !== undefined ? "  → " + JSON.stringify(extra).slice(0, 300) : ""));
  }
}
async function req(path, method, body) {
  const opt = { method: method || "GET", headers: { "content-type": "application/json" } };
  if (body) opt.body = JSON.stringify(body);
  const r = await fetch(BASE + path, opt);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j && j.error ? j.error : "HTTP_" + r.status); e.data = j; throw e; }
  return j;
}
const act = (code, action, me, body) => req(`/api/room/${code}/${action}`, "POST", Object.assign({ internalId: me }, body || {}));
const join = (code, p) => req(`/api/room/${code}/join`, "POST", { internalId: p.id, nickname: p.nick });
const st = (code, me) => req(`/api/room/${code}/state?me=${encodeURIComponent(me)}`, "GET");

const A = { id: "u_a_s1", nick: "甲甲" };
const B = { id: "u_b_s1", nick: "乙乙" };
const C = { id: "u_c_s1", nick: "丙丙" };

(async () => {
  console.log("== 开局 3 人 + mock 汤主 ==");
  const created = await req("/api/room/new", "POST", { internalId: A.id, nickname: A.nick });
  const code = created.roomCode;
  ok(!!code, "建房拿到房号");
  await join(code, B);
  await join(code, C);
  const list = await req("/api/puzzles?limit=5", "GET");
  const pid = list.puzzles[0].id;
  await act(code, "set-ai", A.id, {
    config: { provider: "custom", kind: "openai", baseUrl: "http://localtest.me:8790/v1", model: "mock", apiKey: "sk-test" }
  });
  await act(code, "choose", A.id, { puzzleId: pid });
  for (const p of [A, B, C]) await act(code, "ready", p.id, { ready: true });
  let s = await st(code, A.id);
  ok(s.phase === "playing", "全员准备 → 开锅");

  /* -------- 问 5 句，攒出个人提问数与全桌提问数 -------- */
  console.log("== 攒提问 ==");
  const list2 = { [A.nick]: A, [B.nick]: B, [C.nick]: C };
  const mine = {};
  for (let i = 0; i < 5; i++) {
    s = await st(code, A.id);
    const who = s.players.find((p) => p.uid === s.turnUid);
    const me2 = list2[who.nickname];
    await act(code, "ask", me2.id, { question: "他是自愿的吗" + i });
    mine[who.uid] = (mine[who.uid] || 0) + 1;
  }
  s = await st(code, A.id);
  ok(s.askStats && s.askStats.total === 5, "快照 askStats.total = 5", s.askStats);
  const sumByUid = Object.values((s.askStats || {}).byUid || {}).reduce((a, b) => a + b, 0);
  ok(sumByUid === 5, "askStats.byUid 合计 = 5", s.askStats && s.askStats.byUid);

  /* -------- 乙乙第一个说破：三个战况数据随答返回 -------- */
  console.log("== ① 说破带战况 ==");
  const uidB = s.players.find((p) => p.nickname === "乙乙").uid;
  const g1 = await act(code, "guess", B.id, { text: "乙乙说破 SOLVED" });
  ok(g1.level === "solved" && !!g1.stats, "猜对响应带 stats", Object.keys(g1));
  ok(g1.stats.askMine === (mine[uidB] || 0), "stats.askMine = 乙乙个人提问数", g1.stats);
  ok(g1.stats.askTotal === 5, "stats.askTotal = 全桌提问数", g1.stats);
  ok(g1.stats.ms >= 0, "stats.ms 从开锅算起", g1.stats);

  let v = await st(code, A.id);
  const entryB = v.solveOrder.find((o) => o.nickname === "乙乙");
  ok(entryB && entryB.stats && entryB.stats.askTotal === 5, "排行榜条目冻结了说破那一刻的战况", v.solveOrder);
  const cg1 = (v.chatLog || []).filter((x) => x.type === "congrats").slice(-1)[0];
  ok(cg1 && cg1.stats && cg1.stats.askMine === (mine[uidB] || 0), "报喜消息带同一份战况", cg1 && cg1.stats);
  ok(cg1.rank === 1 && cg1.total === 3, "报喜 1/3", cg1 && { r: cg1.rank, t: cg1.total });

  /* -------- 甲甲第二个说破，然后乙乙（已说破）退出 -------- */
  console.log("== ② 说破者退出：分子分母一起 -1 ==");
  const uidA = v.youUid;
  const g2 = await act(code, "guess", A.id, { text: "甲甲也悟了 SOLVED" });
  ok(g2.rank === 2, "甲甲第 2 个说破", g2.rank);
  v = await st(code, C.id);
  ok(v.solveOrder.length === 2, "排行榜此刻 2 人", v.solveOrder.map((o) => o.nickname));

  await act(code, "leave", B.id, {});
  v = await st(code, C.id);
  ok(v.solveOrder.length === 1 && v.solveOrder[0].nickname === "甲甲", "乙乙退出：排行榜除名（人数 -1）", v.solveOrder.map((o) => o.nickname));
  ok(v.potCount === 2, "丙丙视角：本锅人数同步只剩 2", v.potCount);

  /* -------- 丙丙最后说破：rank 2 / total 2，绝不出现 3/2 -------- */
  console.log("== ③ 最后说破：数字对得上 ==");
  const g3 = await act(code, "guess", C.id, { text: "丙丙压轴说破 SOLVED" });
  ok(g3.rank === 2 && g3.participants === 2, "丙丙 = 第 2/2 个（旧 bug 会是 3/2）", { r: g3.rank, p: g3.participants });
  ok(g3.snapshot.phase === "revealed" && g3.snapshot.allSolved === true, "还在座的全说破 → 当场揭底");
  const last = (g3.snapshot.chatLog || []).filter((x) => x.type === "congrats").slice(-1)[0];
  ok(last.rank <= last.total && last.total === 2, "报喜永不超过总人数", last && { r: last.rank, t: last.total });
  ok(last.stats && last.stats.askMine === (mine[g3.snapshot.youUid] || 0), "丙丙的报喜也带战况", last && last.stats);
  ok(g3.snapshot.solveOrder.length === 2, "终局排行榜只剩在座的 2 人", g3.snapshot.solveOrder.map((o) => o.nickname));
  ok(g3.snapshot.solveOrder.every((o) => o.stats && o.stats.askTotal <= 5), "终局每行都有战况小格数据");

  console.log("\n=====  PASS " + pass + "  /  FAIL " + fail + "  =====");
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("\x1b[31m测试脚本炸了:\x1b[0m", e && e.message, e && e.data ? JSON.stringify(e.data).slice(0, 300) : "");
  process.exit(2);
});
