/* ============================================================
 * 2026-09-29 多人汤屋七项改动 · 本地端到端回归
 *   ① 昵称不得与在座的人重复
 *   ② 猜底 🔴 冷却 180s → 120s，🟡 维持 60s
 *   ③ 每多一人说破，剩余玩家的 🔴/🟡 冷却按人数档位递减（10 / 7.5 / 5 秒），
 *      下限 🟡 10s、🔴 30s
 *   ④ 放弃投票：只有还没说破的人能表态；需全员同意；一人拒绝即流产；60s 发起冷却
 *   ⑤ 一票定音：投过不能改、也不能再点另一个按钮
 *   ⑥ 发言顺序按编号由小到大真顺序轮转（中途加入按编号插队）
 * 前置：node tools/mock_soup_ai.mjs（8790） + npx wrangler dev -p 8788
 * 跑法：node tools/test_20260929_room_rules.mjs
 * ============================================================ */
const BASE = process.env.SOUP_API || "http://127.0.0.1:8788";
const AI_CFG = {
  /* localtest.me → 127.0.0.1，绕开「机房不可达本机」守卫，只用于本地联调 */
  provider: "custom", kind: "openai",
  baseUrl: "http://localtest.me:8790/v1", model: "mock", apiKey: "sk-test"
};

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
const near = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 1500 : tol);
const sec = (ms) => Math.round(ms / 1000);

let seq = 0;
const P = (nick) => ({ id: "u_" + (Date.now()) + "_" + (seq++) + "_" + nick, nick });

async function newRoom(host, players, withAI) {
  const created = await req("/api/room/new", "POST", { internalId: host.id, nickname: host.nick });
  const code = created.roomCode;
  for (const p of players) await join(code, p);
  if (withAI) await act(code, "set-ai", host.id, { config: AI_CFG });
  return code;
}

(async () => {
  /* ================= ① 昵称唯一 ================= */
  console.log("== ① 昵称不得重复 ==");
  const A = P("甲甲"), B = P("乙乙"), C = P("丙丙");
  let code = await newRoom(A, [B, C], false);
  ok((await errOf(join(code, P(A.nick)))) === "NICKNAME_TAKEN", "重名的人进房被拒");
  ok((await errOf(act(code, "set-nick", B.id, { nickname: A.nick }))) === "NICKNAME_TAKEN", "改名撞名被拒");
  /* 大小写同名同样拦下 */
  const upper = "Tom" + Date.now().toString(36);
  const T1 = P(upper), T2 = P(upper.toLowerCase());
  const codeT = await newRoom(T1, [], false);
  ok((await errOf(join(codeT, T2))) === "NICKNAME_TAKEN", "只差大小写的同名也被拦");
  /* 人走了，名字就能重用 */
  await act(code, "leave", C.id, {});
  const C2 = P(C.nick);
  ok(!(await errOf(join(code, C2))), "原主离开后，同名可以重新进房");
  const snapNick = await st(code, A.id);
  ok((await errOf(act(code, "set-nick", B.id, { nickname: "换个名" }))) === null, "不撞名时改名照常成功");
  ok((await st(code, B.id)).players.some((p) => p.nickname === "换个名"), "改名落库");

  /* ================= ② + ⑥ 开局：120s 冷却 / 按编号轮转 ================= */
  console.log("== ② 🔴 120s、🟡 60s ｜ ⑥ 按编号轮转 ==");
  const H = P("汤主大人"), B1 = P("阿B"), B2 = P("小C"), B3 = P("丁丁");
  code = await newRoom(H, [B1, B2, B3], true);
  const list = await req("/api/puzzles?limit=5", "GET");
  const pid = list.puzzles[0].id;
  await act(code, "choose", H.id, { puzzleId: pid });
  for (const p of [H, B1, B2, B3]) await act(code, "ready", p.id, { ready: true });
  let s = await st(code, H.id);
  ok(s.phase === "playing", "全员准备 → 开锅", s.phase);
  const bySeat = {};
  s.players.forEach((p) => { bySeat[p.seat] = p; });
  ok(JSON.stringify(s.order) === JSON.stringify(s.order.slice().sort((a, b) => a - b)), "发言顺序 = 编号由小到大", { order: s.order });
  ok(s.turnUid === s.order[0] && s.turnSeat === 1, "第一棒是 #1", { turnSeat: s.turnSeat });
  ok(s.turnsUntilMe === 0, "#1 自己：还差 0 棒");
  ok((await st(code, B1.id)).turnsUntilMe === 1, "#2 看到「还差 1 棒」");
  ok(s.turnQueue && s.turnQueue[0].offset === 0 && s.turnQueue[1].offset === 1 && s.turnQueue[3].offset === 3, "发言顺序条按轮转偏移排好");

  /* 走完一圈，验证 1→2→3→4→1 */
  const byNick = {};
  [H, B1, B2, B3].forEach((p) => { byNick[p.nick] = p; });
  const seen = [];
  for (let i = 0; i < 4; i++) {
    const cur = await st(code, H.id);
    const row = cur.players.filter((p) => p.uid === cur.turnUid)[0];
    seen.push(row.seat);
    await act(code, "ask", byNick[row.nickname].id, { question: "循环第 " + i + " 棒？" });
  }
  ok(seen.join(",") === "1,2,3,4", "一问一答依次轮转，不跳号不乱序", seen);

  /* 冷却时长：4 人房（档位 10s），无人说破 → 🔴 120s / 🟡 60s */
  const gRed = await act(code, "guess", B1.id, { text: "瞎猜一通 NO" });
  ok(gRed.level === "no" && near(gRed.cooldownMs, 120000), "🔴 完全错误冷却 120 秒", sec(gRed.cooldownMs));
  const gYel = await act(code, "guess", B2.id, { text: "沾点边 CLOSE" });
  ok(gYel.level === "close" && near(gYel.cooldownMs, 60000), "🟡 部分正确冷却仍是 60 秒", sec(gYel.cooldownMs));
  const b1v = await st(code, B1.id);
  ok(b1v.myNextCooldown.no === 120000 && b1v.myNextCooldown.close === 60000, "快照回传下一次实际冷却时长");
  ok(b1v.cooldownTier.total === 4 && b1v.cooldownTier.step === 10000, "4 人房 → 每多说破一人减 10 秒", b1v.cooldownTier);

  /* ================= ③ 说破递减 ================= */
  console.log("== ③ 每多一人说破，冷却递减 ==");
  const g1 = await act(code, "guess", B3.id, { text: "B3 说破 SOLVED" });
  ok(g1.level === "solved", "#4 先说破一个");
  const after1 = await st(code, B1.id);
  ok(after1.cooldownTier.solved === 1, "快照记录本锅已说破 1 人");
  ok(near(after1.myNextCooldown.no, 110000) && near(after1.myNextCooldown.close, 50000), "1 人说破 → 🔴 110s / 🟡 50s", after1.myNextCooldown);
  /* B2 冷却已过期前不能猜，先拿没冷却的人验证递减 */
  const g2 = await act(code, "guess", H.id, { text: "汤主 CLOSE" });
  ok(near(g2.cooldownMs, 50000), "汤主 🟡 冷却按 1 人说破递减到 50 秒", sec(g2.cooldownMs));
  const g3 = await act(code, "guess", B2.id, { text: "换个人猜 NO" }).then(() => null, (e) => e.message);
  /* B2 还在冷却（上一发 60s），这里必须被拒 */
  ok(g3 === "COOLDOWN", "冷却内再猜被拒（冷却只算在猜的人身上）", g3);

  /* ================= ④ + ⑤ 放弃投票 ================= */
  console.log("== ④ 只有没猜出来的人能表态，且需全员同意 ==");
  /* 此时 #4 丁丁已说破 → 旁观；其余 3 人还没说破 */
  const dView = await st(code, B3.id);
  ok(dView.vote === null, "开局没有投票");
  ok((await errOf(act(code, "giveup", B3.id, {}))) === "SOLVED_NO_GIVEUP", "说破者不能发起放弃");
  ok((await errOf(act(code, "vote", B3.id, { yes: true }))) === "NO_VOTE", "没有投票时表态无处可投");
  const gv = await act(code, "giveup", H.id, {});
  ok(gv.ok && gv.vote && gv.vote.need === 3, "发起投票：门槛 = 还没说破的 3 人", gv.vote && gv.vote.need);
  const b3Uid = (await st(code, H.id)).players.filter((p) => p.nickname === B3.nick)[0].uid;
  ok(gv.vote.voters.length === 3 && !gv.vote.voters.some((x) => x.uid === b3Uid),
    "名单里只有没猜出来的人", gv.vote.voters);
  /* 说破者连投票卡都点不动 */
  ok((await errOf(act(code, "vote", B3.id, { yes: true }))) === "SOLVED_NO_VOTE", "说破者投票被服务端拒");
  /* 一票定音 */
  const v1 = await act(code, "vote", B1.id, { yes: true });
  ok(v1.ok && v1.vote.yes === 2, "同意票入账（发起者自己已算一票）", v1.vote && v1.vote.yes);
  ok((await errOf(act(code, "vote", B1.id, { yes: false }))) === "ALREADY_VOTED", "投过同意就不能再点拒绝");
  ok((await errOf(act(code, "vote", B1.id, { yes: true }))) === "ALREADY_VOTED", "同方向也不能重复投");
  /* 一人拒绝 → 当场流产 */
  const vNo = await act(code, "vote", B2.id, { yes: false }).then(null, (e) => e);
  /* B2 上一发猜底被拒（还在冷却），但投票与冷却无关，应当投得进 */
  ok(vNo === null || (vNo && vNo.passed === false), "还没猜出来的人可以拒绝", vNo && vNo.message);
  const afterNo = vNo && vNo.snapshot ? vNo.snapshot : await st(code, H.id);
  ok(afterNo.vote === null && afterNo.phase === "playing", "有人拒绝 → 投票立刻作废，本锅继续");
  ok(afterNo.giveupCooldownLeft > 0, "流产后进入 60 秒发起冷却", afterNo.giveupCooldownLeft);
  ok((await errOf(act(code, "giveup", H.id, {}))) === "GIVEUP_COOLDOWN", "冷却内不能再发起");
  /* 让冷却走完：直接改 DO 时间戳做不到，用第二锅验证全票通过路径 */
  console.log("== ⑤ 全员同意才揭底 ==");
  await act(code, "ready", H.id, { ready: false });   /* 掀回大堂 */
  s = await st(code, H.id);
  ok(s.phase === "lobby", "撤回准备 → 回大堂");
  for (const p of [H, B1, B2, B3]) await act(code, "ready", p.id, { ready: true });
  s = await st(code, H.id);
  ok(s.phase === "playing", "第二锅开打", s.phase);
  ok(s.giveupCooldownLeft === 0, "新锅不带上一锅的放弃冷却");
  const gv2 = await act(code, "giveup", B1.id, {});
  ok(gv2.ok && gv2.vote.need === 4, "4 人全没说破 → 需 4 票", gv2.vote && gv2.vote.need);
  const r2 = await act(code, "vote", B2.id, { yes: true });
  const r3 = await act(code, "vote", B3.id, { yes: true });
  const r4 = await act(code, "vote", H.id, { yes: true });
  ok([r2, r3, r4].some((r) => r.passed === true), "最后一票齐了 → 全员同意，揭底");
  const fin = await st(code, H.id);
  ok(fin.phase === "revealed" && fin.giveUp === true && !!fin.truth, "揭底走 revealed 通道并带汤底");

  /* ================= ⑥ 中途加入按编号插位 ================= */
  console.log("== ⑥ 中途加入按编号插进序列 ==");
  const H2 = P("房主二");
  const code2 = await newRoom(H2, [], true);
  await act(code2, "choose", H2.id, { puzzleId: pid });
  await act(code2, "ready", H2.id, { ready: true });
  let s2 = await st(code2, H2.id);
  ok(s2.phase === "playing", "单人 also 可先开锅", s2.phase);
  /* 第二个人进房排队（编号 #2），第三个人 #3 */
  const mid1 = P("半路一"), mid2 = P("半路二");
  await join(code2, mid1);
  await act(code2, "ready", mid1.id, { ready: true });
  await join(code2, mid2);
  await act(code2, "ready", mid2.id, { ready: true });
  s2 = await st(code2, mid2.id);
  const uids = s2.order.slice();
  ok(JSON.stringify(uids) === JSON.stringify(uids.slice().sort((a, b) => a - b)), "中途加入后队列仍按编号升序", { order: uids, seats: s2.players.map((p) => p.seat + ":" + p.uid) });
  ok(s2.turnQueue.every((x, i) => i === 0 || x.offset === s2.turnQueue[i - 1].offset + 1), "偏移逐棒 +1");

  /* ================= 单人模式回归 ================= */
  console.log("== 单人回归 ==");
  const solo = await req("/api/solo/new", "POST", { internalId: "u_solo_r29", nickname: "汤客", puzzleId: pid });
  const sc = solo.roomCode;
  await req(`/api/solo/${sc}/set-ai`, "POST", { internalId: "u_solo_r29", config: AI_CFG });
  const sg = await req(`/api/solo/${sc}/guess`, "POST", { internalId: "u_solo_r29", text: "单人猜错 NO" });
  ok(sg.level === "no" && near(sg.cooldownMs, 120000), "单人 🔴 也是 120 秒", sec(sg.cooldownMs));
  const sg2 = await req(`/api/solo/${sc}/guess`, "POST", { internalId: "u_solo_r29", text: "单人说破 SOLVED" }).then(null, (e) => e.message);
  ok(sg2 === "COOLDOWN", "单人冷却内不可再猜");

  console.log("\n=====  PASS " + pass + "  /  FAIL " + fail + "  =====");
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("\x1b[31m测试脚本炸了:\x1b[0m", e && e.message, e && e.data ? JSON.stringify(e.data).slice(0, 400) : "");
  process.exit(2);
});
