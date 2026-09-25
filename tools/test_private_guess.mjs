/* ============================================================
 * 多人「私有猜底」大改 · 本地端到端回归（2026-09-25）
 * 前置：node tools/mock_soup_ai.mjs（8790） + npx wrangler dev -p 8788
 * 跑法：node tools/test_private_guess.mjs
 * ============================================================ */
const BASE = process.env.SOUP_API || "http://127.0.0.1:8788";

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log("  \x1b[32m✓\x1b[0m " + name); }
  else {
    fail++;
    console.log("  \x1b[31m✗ " + name + "\x1b[0m" + (extra !== undefined ? "  → " + JSON.stringify(extra).slice(0, 400) : ""));
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
const errOf = (p) => p.then(() => null, (e) => e.message);

const HOST = { id: "u_host_t1", nick: "汤主大人" };
const B = { id: "u_b_t1", nick: "阿B" };
const C = { id: "u_c_t1", nick: "小C" };
const D = { id: "u_d_t1", nick: "丁丁" };
const E = { id: "u_e_t1", nick: "路人E" };
const byNick = { "汤主大人": HOST, "阿B": B, "小C": C };

(async () => {
  /* ---------------- 开局：房 + 3 人 + mock 汤主 ---------------- */
  console.log("== 开局 ==");
  const created = await req("/api/room/new", "POST", { internalId: HOST.id, nickname: HOST.nick });
  const code = created.roomCode;
  ok(!!code, "建房拿到房号");
  await join(code, B);
  await join(code, C);
  const list = await req("/api/puzzles?limit=5", "GET");
  const pid = list.puzzles[0].id;
  await act(code, "set-ai", HOST.id, {
    /* 本机 TUN/代理环境下 localtest.me → 127.0.0.1，绕开「机房不可达本机」守卫，只用于本地联调 */
    config: { provider: "custom", kind: "openai", baseUrl: "http://localtest.me:8790/v1", model: "mock", apiKey: "sk-test" }
  });
  await act(code, "choose", HOST.id, { puzzleId: pid });
  for (const p of [HOST, B, C]) await act(code, "ready", p.id, { ready: true });
  let s = await st(code, HOST.id);
  ok(s.phase === "playing", "全员准备 → 自动开锅", s.phase);

  /* 普通提问仍全桌共享 */
  const turnWho = byNick[(s.players.find((p) => p.uid === s.turnUid) || {}).nickname];
  const askOut = await act(code, "ask", turnWho.id, { question: "他是自愿的吗？" });
  ok(askOut.ok && askOut.item.verdict === "no", "轮到的人可提问（mock 判：不是）");
  const cView = await st(code, C.id);
  ok((cView.qaLog || []).some((x) => x.kind === "ask" && x.question === "他是自愿的吗？"), "普通问答照常全桌可见");

  /* ---------------- ① 猜底全程私密 ---------------- */
  console.log("== ① 猜底全程私密 ==");
  await join(code, E);          /* 路人 E 进房但没排队 */
  const w = await act(code, "guess", E.id, { text: "我瞎猜一通 E-TEXT-9527" });
  ok(w.private === true, "多人猜底响应带 private 标记");
  ok(w.level === "no" && !w.truth, "🔴 判定不附带汤底", Object.keys(w));
  ok((await errOf(act(code, "guess", E.id, { text: "再猜 SOLVED" }))) === "COOLDOWN", "猜错后是猜的人自己的冷却");

  for (const P of [HOST, B, C, D, E]) {
    const v = await st(code, P.id);
    ok(!(v.qaLog || []).some((x) => x.kind === "guess"), `${P.nick} 视角：问答记录/实时对话无猜底条目`);
    ok(v.lastGuess === null || v.lastGuess === undefined, `${P.nick} 视角：lastGuess 不再全桌广播`);
  }
  const eView = await st(code, E.id);
  const cView2 = await st(code, C.id);
  ok((eView.myGuessLog || []).length === 1 && eView.myGuessLog[0].level === "no", "E 的手账里有自己那一条");
  ok((cView2.myGuessLog || []).length === 0, "C 的手账空空（不知道 E 猜过）");
  ok(JSON.stringify(cView2).indexOf("E-TEXT-9527") === -1, "C 的整包快照搜不到 E 的猜底原文");
  ok(!(cView2.chatLog || []).some((x) => x.type === "congrats"), "猜错没有任何报喜");

  /* ---------------- ② 猜对：只弹给猜对的人 ---------------- */
  console.log("== ② 猜对只庆祝本人 ==");
  const g2 = await act(code, "guess", HOST.id, { text: "全部串起来了：就是他自己 SOLVED" });
  ok(g2.level === "solved" && !!g2.truth, "猜对：响应带汤底（仅本人）");
  ok(g2.rank === 1 && g2.participants === 3 && g2.snapshot.phase === "playing", "第 1 个说破 ≠ 本锅结束");
  ok(g2.snapshot.mySolved === true && g2.snapshot.myRank === 1 && !!g2.snapshot.myTruth, "说破者视角：iSolved + myTruth + 名次");

  const cAfter = await st(code, C.id);
  ok(cAfter.phase === "playing" && !cAfter.truth && !cAfter.myTruth, "别人视角：未揭底、无汤底字段");
  const hostRow = cAfter.players.find((p) => p.nickname === "汤主大人") || {};
  ok(hostRow.solved === true, "名单上「汤主大人」挂已说破徽章");
  ok(!cAfter.order.includes(hostRow.uid), "说破者退出轮询队列");
  const cg = (cAfter.chatLog || []).filter((x) => x.type === "congrats");
  ok(cg.length === 1 && cg[0].text.includes("汤主大人") && cg[0].rank === 1 && cg[0].nickname === "汤主", "聊天：汤主报喜（人名 + 第 1 个）");
  ok(JSON.stringify(cAfter.chatLog).indexOf("全部串起来") === -1, "报喜不含猜底原文");
  ok(JSON.stringify(cAfter.chatLog).indexOf(String(g2.truth || "@@")) === -1, "报喜不含汤底原文");

  ok((await errOf(act(code, "guess", HOST.id, { text: "再猜 SOLVED" }))) === "ALREADY_SOLVED", "说破者再猜被拒");
  ok((await errOf(act(code, "giveup", HOST.id, {}))) === "SOLVED_NO_GIVEUP", "说破者不能发起放弃投票");
  await act(code, "ready", HOST.id, { ready: false }).catch(() => {});
  ok((await st(code, B.id)).phase === "playing", "说破者撤准备不掀桌");

  /* B 说破：rank2，仍未终局 */
  const g3 = await act(code, "guess", B.id, { text: "B 也悟了 SOLVED" });
  ok(g3.rank === 2 && g3.snapshot.phase === "playing", "第 2 个说破仍不揭底");

  /* ---------------- ③ 中途排队者也算「全员」 ---------------- */
  console.log("== ③ 全员说破才揭底 ==");
  await join(code, D);
  await act(code, "ready", D.id, { ready: true });   /* 第⑧条：排进本锅队尾 → 也算本锅的人 */
  const g4 = await act(code, "guess", C.id, { text: "C 说出真相 SOLVED" });
  ok(g4.rank === 3 && g4.snapshot.phase === "playing", "首发全说破，但中途排队的丁丁没猜对 → 不揭底");
  const dView = await st(code, D.id);
  ok(!dView.truth && dView.players.find((p) => p.nickname === "汤主大人").solved === true, "丁丁能旁观已说破名单，但拿不到汤底");

  const g5 = await act(code, "guess", D.id, { text: "丁丁也猜对 SOLVED" });
  ok(g5.rank === 4 && g5.snapshot.phase === "revealed" && g5.snapshot.allSolved === true, "最后一个说破 → 全员揭底");
  const fin = g5.snapshot;
  ok(!!fin.truth, "终局快照带汤底");
  ok((fin.solveOrder || []).length === 4 && fin.solveOrder.map((o) => o.nickname).join(",") === "汤主大人,阿B,小C,丁丁", "排行榜按说破先后排序", fin.solveOrder);
  ok(fin.winnerNick === "汤主大人", "冠军 = 第一个说破的人");
  const cFinal = await st(code, C.id);
  ok(cFinal.phase === "revealed" && !!cFinal.truth && cFinal.allSolved === true, "全桌统一进入揭底态");
  ok((cFinal.chatLog || []).filter((x) => x.type === "congrats").length === 4, "四条报喜齐了");
  const eFinal = await st(code, E.id);
  ok(eFinal.phase === "revealed", "路人 E（未排队）不阻塞终局");

  /* ---------------- ④ 下一锅：一切清零 ---------------- */
  console.log("== ④ 下一锅清零 ==");
  await act(code, "next", HOST.id, { puzzleId: pid });
  const np = await st(code, C.id);
  ok(np.phase === "lobby", "下一锅先回大堂（E 未准备）", np.phase);
  ok((np.players || []).every((p) => !p.solved) && (np.solveOrder || []).length === 0 && !np.allSolved, "说破名单/徽章/全员标志清零");
  ok((np.myGuessLog || []).length === 0, "私有猜底手账清零");
  for (const P of [HOST, B, C, D, E]) await act(code, "ready", P.id, { ready: true });
  const pot2 = await st(code, HOST.id);
  ok(pot2.phase === "playing", "全员准备 → 第二锅开打", pot2.phase);

  /* ---------------- ⑤ 放弃投票揭底（回归：老通道还在） ---------------- */
  console.log("== ⑤ 投票放弃 ==");
  const gv = await act(code, "giveup", E.id, {});
  ok(gv.ok && gv.vote, "路人 E 发起放弃投票");
  for (const P of [HOST, B, C, D, E]) {
    const r = await errOf(act(code, "vote", P.id, { yes: true }));
    if (r === null) continue;               /* 正常投进 */
    if (r === "NO_VOTE") break;             /* 已提前达标结账 */
    ok(false, "投票意外报错：" + r);
    break;
  }
  const voted = await st(code, C.id);
  ok(voted.phase === "revealed" && voted.giveUp === true && !!voted.truth && !voted.allSolved, "投票通过 → 直接揭底（非全员模式）");

  /* ---------------- ⑥ 单人模式回归（行为完全不变） ---------------- */
  console.log("== ⑥ 单人回归 ==");
  const solo = await req("/api/solo/new", "POST", { internalId: "u_solo_t1", nickname: "汤客", puzzleId: pid });
  const sc = solo.roomCode;
  await req(`/api/solo/${sc}/set-ai`, "POST", { internalId: "u_solo_t1", config: { provider: "custom", kind: "openai", baseUrl: "http://localtest.me:8790/v1", model: "mock", apiKey: "sk-test" } });
  const sg = await req(`/api/solo/${sc}/guess`, "POST", { internalId: "u_solo_t1", text: "单人直接说破 SOLVED" });
  ok(sg.level === "solved" && !sg.private && !sg.truth, "单人猜底响应保持旧形状");
  const ss = await req(`/api/solo/${sc}/state?me=u_solo_t1`, "GET");
  ok(ss.phase === "revealed" && !!ss.truth, "单人判对 = 立刻揭底");
  ok((ss.qaLog || []).some((x) => x.kind === "guess"), "单人猜底仍进自己的问答记录（旧行为）");

  console.log("\n=====  PASS " + pass + "  /  FAIL " + fail + "  =====");
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("\x1b[31m测试脚本炸了:\x1b[0m", e && e.message, e && e.data ? JSON.stringify(e.data).slice(0, 300) : "");
  process.exit(2);
});
