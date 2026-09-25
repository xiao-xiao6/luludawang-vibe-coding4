/* 第①条精准回归：复现「全桌挂机、轮询命中增量快路径」时超时是否会跳过。
 * 用法：node tools/test_timeout_sweep.mjs
 */
import { Room } from "../worker/src/room.js";

const store = {};
const ctx = {
  storage: {
    async get(k) { return store[k]; },
    async put(k, v) { store[k] = v; },
    async setAlarm(t) { store.__alarm = t; },
    async deleteAlarm() { store.__alarm = null; },
  },
};

const room = new Room(ctx, {});
let failed = 0;
function ok(name, cond, extra) {
  console.log((cond ? "  ✓ " : "  ✗ ") + name + (extra === undefined ? "" : "   [" + extra + "]"));
  if (!cond) failed++;
}

await room.create({ roomCode: "TEST01", internalId: "u_A", nickname: "甲" });
await room.addPlayer({ internalId: "u_B", nickname: "乙" });
await room.choosePuzzle({ internalId: "u_A", puzzleId: "turtle" });
await room.setReady({ internalId: "u_A", ready: true });
const afterB = await room.setReady({ internalId: "u_B", ready: true });

console.log("\n[开局]");
ok("两人准备后自动开局", afterB.snapshot ? afterB.snapshot.phase === "playing" : room.state.phase === "playing");
ok("90s 超时时长", Math.abs((room.state.turnDeadline - Date.now()) - 90000) < 3000,
  Math.round((room.state.turnDeadline - Date.now()) / 1000) + "s");
/* Alarm 由 fetch() 里的 syncAlarm() 预约；本测试直接调 setReady() 绕过了 fetch，
   所以到下面走过一次真实轮询后再断言（生产链路开局必定走 fetch，不受影响）。 */

const turn0 = room.state.order[room.state.turnIdx];

/* 模拟 91 秒过去：没人提问、没人动作，只有轮询 */
room.state.turnDeadline = Date.now() - 1000;
const revBefore = room.state.rev;
const res = await room.fetch(new Request("https://do/?action=state&me=u_A&since=" + revBefore, { method: "GET" }));
const snap = await res.json();

console.log("\n[挂机 91s 后，用 since=rev 轮询（旧的卡死场景）]");
ok("没有命中 unchanged 快路径", !snap.unchanged, JSON.stringify(snap).slice(0, 60));
const timeouts = (snap.qaLog || []).filter((x) => x.kind === "timeout");
ok("产生一条超时记录", timeouts.length === 1, timeouts.length);
ok("超时记录标了 feed:true（只进实时对话）", timeouts[0] && timeouts[0].feed === true);
ok("轮次已跳过给下一位", snap.turnUid !== turn0, "#" + turn0 + " → #" + snap.turnUid);
ok("新 deadline 重新计时 90s", Math.abs((snap.turnDeadline - Date.now()) - 90000) < 3000,
  Math.round((snap.turnDeadline - Date.now()) / 1000) + "s");
ok("rev 已推进（别的客户端也会拿到新快照）", (snap.rev || 0) > revBefore, revBefore + " → " + snap.rev);
ok("席位号 seat 已下发", (snap.players || []).every((p) => p.seat >= 1), JSON.stringify((snap.players || []).map(p => p.seat)));
ok("turnSeat 与 players 顺序一致", snap.turnSeat === (snap.players.find(p => p.uid === snap.turnUid) || {}).seat,
  "turnSeat=" + snap.turnSeat);
ok("问答不再下发 revealedClues/clueTotal（第⑥条）", !("revealedClues" in snap) && !("clueTotal" in snap));
ok("走过 fetch 后 Alarm 已预约到新 turnDeadline（全挂机兼底）", store.__alarm === room.state.turnDeadline,
  "alarm=" + store.__alarm + " deadline=" + room.state.turnDeadline);

/* 连续两位都超时时能连跳 */
room.state.turnDeadline = Date.now() - 1000;
const turn1 = room.state.order[room.state.turnIdx];
await room.fetch(new Request("https://do/?action=state&me=u_A", { method: "GET" }));
ok("第二次超时同样跳过", room.state.order[room.state.turnIdx] !== turn1);

console.log("\n[中途加入不打断（第⑧条）]");
await room.addPlayer({ internalId: "u_C", nickname: "丙" });
const c = room.state.players.find((p) => p.internalId === "u_C");
const before = room.state.order[room.state.turnIdx];
const r8 = await room.setReady({ internalId: "u_C", ready: true });
ok("playing 中点准备 = 排队尾，不掀桌", room.state.phase === "playing" && room.state.order[room.state.order.length - 1] === c.uid);
ok("当前轮次没被打断", room.state.order[room.state.turnIdx] === before);
const back = await room.setReady({ internalId: "u_C", ready: false });
ok("中途加入者撤回只退自己", room.state.phase === "playing" && room.state.order.indexOf(c.uid) === -1 &&
  room.state.players.filter(p => p.ready).length >= 2);

console.log("\n[房主转让（第⑨条）]");
const rt = await room.transferHost({ internalId: "u_A", uid: room.state.order[0] === 1 ? 2 : 1 });
ok("转让成功", rt.ok === true, JSON.stringify(rt));
ok("hostUid 已切换", room.state.hostUid !== 1 || !rt.ok, "hostUid=" + room.state.hostUid);

console.log("\n" + (failed === 0 ? "✅ 全部通过" : "❌ " + failed + " 项失败"));
process.exit(failed ? 1 : 0);
