/* 线上冒烟：放弃投票 + 中途加入队列（一次性验证脚本） */
const BASE = "https://soup-room.57gqq9hsq.workers.dev";
let fail = 0;
const ok = (cond, msg) => { console.log((cond ? "PASS" : "FAIL") + " | " + msg); if (!cond) fail = 1; };

async function req(path, method, body) {
  const r = await fetch(BASE + path, {
    method: method || "GET",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  return r.json();
}

const puzzles = await req("/api/puzzles?layer=core&limit=1");
const pid = puzzles.puzzles[0].id;

const created = await req("/api/room/new", "POST", { internalId: "t_a", nickname: "甲" });
const code = created.roomCode;
ok(!!code, "建房 " + code);
await req("/api/room/" + code + "/join", "POST", { internalId: "t_b", nickname: "乙" });
await req("/api/room/" + code + "/choose", "POST", { internalId: "t_a", puzzleId: pid });
await req("/api/room/" + code + "/ready", "POST", { internalId: "t_a", ready: true });
let snap = await req("/api/room/" + code + "/ready", "POST", { internalId: "t_b", ready: true });
ok(snap.phase === "playing", "两人准备后开锅 phase=" + snap.phase);

/* 中途加入：第三人 ready:true 应排进队尾，不掀桌 */
await req("/api/room/" + code + "/join", "POST", { internalId: "t_c", nickname: "丙" });
snap = await req("/api/room/" + code + "/ready", "POST", { internalId: "t_c", ready: true });
ok(snap.phase === "playing", "中途加入不掀桌 phase=" + snap.phase);
ok((snap.order || []).indexOf(snap.players.find(p => p.nickname === "丙").uid) !== -1, "丙排进提问队列 order=" + JSON.stringify(snap.order));

/* 放弃投票：甲发起，乙同意 → 3 人房 need=2，甲自动同意已 1 票，乙投完应通过 */
const gv = await req("/api/room/" + code + "/giveup", "POST", { internalId: "t_a" });
ok(gv.ok && gv.snapshot.vote && gv.snapshot.vote.need === 2, "发起投票 need=" + (gv.snapshot.vote && gv.snapshot.vote.need));
const vt = await req("/api/room/" + code + "/vote", "POST", { internalId: "t_b", yes: true });
ok(vt.passed === true, "乙同意后投票通过 passed=" + vt.passed);
ok(vt.snapshot.phase === "revealed", "投票通过即揭底 phase=" + vt.snapshot.phase);
ok(!!vt.snapshot.truth, "快照带汤底 truth=" + String(vt.snapshot.truth).slice(0, 12) + "…");
ok(vt.snapshot.giveUp === true, "giveUp 标记=" + vt.snapshot.giveUp);
ok(vt.snapshot.vote === null, "投票已清空");

/* 拒绝流产路径：再来一锅，两人房 need=1 → 发起者自己就达标（规则如此）；
   三人房乙拒绝 → 数学上仍可 2 同意，不流产；丙也拒绝 → 流产 */
await req("/api/room/" + code + "/next", "POST", { internalId: "t_a", puzzleId: pid });
await req("/api/room/" + code + "/ready", "POST", { internalId: "t_a", ready: true });
await req("/api/room/" + code + "/ready", "POST", { internalId: "t_b", ready: true });
await req("/api/room/" + code + "/ready", "POST", { internalId: "t_c", ready: true });
snap = await req("/api/room/" + code + "/state?me=t_a", "GET");
ok(snap.phase === "playing", "下一锅开打 phase=" + snap.phase);
await req("/api/room/" + code + "/giveup", "POST", { internalId: "t_a" });
let r1 = await req("/api/room/" + code + "/vote", "POST", { internalId: "t_b", yes: false });
ok(r1.ok && !r1.passed && r1.vote, "1 拒绝仍可继续 vote.yes=" + (r1.vote && r1.vote.yes));
let r2 = await req("/api/room/" + code + "/vote", "POST", { internalId: "t_c", yes: false });
ok(r2.passed === false, "2 拒绝立即流产 passed=" + r2.passed);
snap = await req("/api/room/" + code + "/state?me=t_a", "GET");
ok(snap.vote === null && snap.phase === "playing", "流产后恢复游戏");

console.log(fail ? "\n❌ 有失败项" : "\n✅ 全部通过");
process.exit(fail);
