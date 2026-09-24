/* 线上 Worker「单房上限」探针：建房后连塞玩家，看第几个被挡。
 * 用法：node tools/probe_room_cap.js
 * 只读式验证 —— 只新建一间临时房，不碰任何既有房间。
 */
const BASE = process.env.SOUP_BASE || "https://soup-room.57gqq9hsq.workers.dev";

async function j(path, opt) {
  const r = await fetch(BASE + path, Object.assign({
    headers: { "content-type": "application/json", origin: "https://xiao-xiao6.github.io" }
  }, opt));
  const t = await r.text();
  let d = null;
  try { d = JSON.parse(t); } catch (e) { d = t; }
  return { status: r.status, data: d };
}

(async () => {
  const mk = await j("/api/room/new", {
    method: "POST",
    body: JSON.stringify({ internalId: "cap-probe-host", nickname: "探针房主" })
  });
  if (!mk.data || !mk.data.roomCode) {
    console.log("建房失败：", mk.status, JSON.stringify(mk.data));
    process.exit(1);
  }
  const code = mk.data.roomCode;
  console.log("建房成功：", code);

  let accepted = 1;
  let firstRejected = null;
  for (let i = 2; i <= 20; i++) {
    const r = await j("/api/room/" + code + "/join", {
      method: "POST",
      body: JSON.stringify({ internalId: "cap-probe-" + i, nickname: "探针" + i })
    });
    const err = r.data && r.data.error;
    if (err) {
      firstRejected = { n: i, err: err, status: r.status };
      break;
    }
    accepted++;
  }

  const snap = await j("/api/room/" + code + "/state?me=cap-probe-host");
  const players = (snap.data && snap.data.players) || [];
  console.log("成功进房人数：", accepted);
  console.log("被拒的第一个：", firstRejected ? JSON.stringify(firstRejected) : "（没被拒，异常）");
  console.log("快照实际人数：", players.length);

  const pass = accepted === 15 && firstRejected && firstRejected.err === "ROOM_FULL";
  console.log(pass ? "\n✅ 线上上限 = 15 人，第 16 个被 ROOM_FULL 挡下"
                   : "\n❌ 与预期不符（期望 15 人后 ROOM_FULL）");
  process.exit(pass ? 0 : 1);
})();
