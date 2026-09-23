/* 联机全链路自测（UTF-8 安全）：node tools/test_room.js */
const BASE = "https://soup-room.57gqq9hsq.workers.dev";

async function api(path, method, body) {
  const res = await fetch(BASE + path, {
    method: method || "GET",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { json = { _raw: text }; }
  return { status: res.status, json };
}

(function main() {
  let code = "";
  api("/api/room/new", "POST", { internalId: "u_A", nickname: "阿甲" })
    .then((r) => {
      code = r.json.roomCode;
      console.log("1) 建房", code, "youUid=" + r.json.youUid, "房主=" + r.json.players[0].nickname);
      return api("/api/room/" + code + "/join", "POST", { internalId: "u_B", nickname: "阿乙" });
    })
    .then((r) => {
      console.log("2) 进房 人数=" + r.json.players.length, "youUid=" + r.json.youUid);
      return api("/api/room/" + code + "/choose", "POST", { internalId: "u_A", puzzleId: "turtle" });
    })
    .then(() => api("/api/room/" + code + "/ready", "POST", { internalId: "u_A", ready: true }))
    .then(() => api("/api/room/" + code + "/ready", "POST", { internalId: "u_B", ready: true }))
    .then((r) => {
      console.log("3) 开局 phase=" + r.json.phase, "order=[" + r.json.order.join(",") + "]", "turn=#" + r.json.turnUid);
      console.log("   题面下发无汤底? truth字段=" + (Object.prototype.hasOwnProperty.call(r.json, "truth")));
      const first = r.json.turnUid === 1 ? "u_A" : "u_B";
      const second = r.json.turnUid === 1 ? "u_B" : "u_A";
      return api("/api/room/" + code + "/ask", "POST", { internalId: second, question: "他是自杀的吗" })
        .then((bad) => { console.log("4) 非轮次玩家提问 → " + JSON.stringify(bad.json)); return first; })
        .then((who) => api("/api/room/" + code + "/ask", "POST", { internalId: who, question: "他是不是去过海上" }));
    })
    .then((r) => {
      const it = r.json.item || {};
      console.log("5) 轮次玩家提问 → verdict=" + it.verdict + " clue=" + it.clue);
      console.log("   reply=" + JSON.stringify(it.reply));
      return api("/api/room/" + code + "/state?me=u_A");
    })
    .then((r) => {
      console.log("6) 快照 youUid=" + r.json.youUid + " revealed=[" + (r.json.revealed || []).join(",") + "] turn=#" + r.json.turnUid);
      return api("/api/room/" + code + "/guess", "POST", { internalId: "u_B", text: "他以前遭遇海难，吃过人肉汤，所以喝到真正的海龟汤时才知道当年那碗不是海龟汤" });
    })
    .then((r) => {
      console.log("7) 猜底 level=" + r.json.level + " note=" + JSON.stringify(r.json.note));
      return api("/api/room/" + code + "/state");
    })
    .then((r) => {
      const s = r.json;
      console.log("8) phase=" + s.phase + " winner=#" + s.winnerUid + " " + s.winnerNick + " stars=" + s.stars);
      if (s.phase === "revealed") {
        console.log("   揭底后下发汤底=" + Object.prototype.hasOwnProperty.call(s, "truth"));
        console.log("   truth=" + JSON.stringify(String(s.truth || "").slice(0, 40)));
      }
      console.log("9) 线索总数=" + s.clueTotal + " 共享已解锁=" + (s.revealed || []).length);
    })
    .catch((e) => { console.error("✗ 失败：", e); process.exit(1); });
})();
