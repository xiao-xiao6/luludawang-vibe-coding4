/* 单人服务端会话自测：node tools/test_solo.js */
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

(async function () {
  try {
    const created = await api("/api/solo/new", "POST", { internalId: "u_solo", nickname: "独汤客", puzzleId: "turtle" });
    console.log("1) 开单人局", JSON.stringify(created.json));
    const code = created.json.roomCode;
    const st = await api("/api/solo/" + code + "/state?me=u_solo");
    console.log("2) phase=" + st.json.phase + " solo=" + st.json.solo + " youUid=" + st.json.youUid + " 有汤底? " + Object.prototype.hasOwnProperty.call(st.json, "truth"));
    const a = await api("/api/solo/" + code + "/ask", "POST", { internalId: "u_solo", question: "他是不是去过海上" });
    console.log("3) 提问 verdict=" + (a.json.item || {}).verdict + " clue=" + (a.json.item || {}).clue);
    const h = await api("/api/solo/" + code + "/hint", "POST", { internalId: "u_solo" });
    console.log("4) 提示 → 线索#" + (h.json.clue || {}).n + " [" + (h.json.clue || {}).type + "] hintsUsed=" + h.json.hintsUsed);
    const h2 = await api("/api/solo/" + code + "/state?me=u_solo");
    console.log("5) 已解锁线索 " + (h2.json.revealed || []).length + "/" + h2.json.clueTotal + "（含文字? " + ((h2.json.revealedClues || [])[0] ? "是" : "否") + "）");
    const g = await api("/api/solo/" + code + "/guess", "POST", { internalId: "u_solo", text: "他以前遭遇海难，吃过人肉汤，所以喝到真正的海龟汤时才知道当年那碗不是海龟汤" });
    console.log("6) 猜底（未配 AI → 服务端关键词判定）level=" + g.json.level + " note=" + JSON.stringify(g.json.note));
    const st2 = await api("/api/solo/" + code + "/state?me=u_solo");
    console.log("7) phase=" + st2.json.phase + " 揭底后下发汤底? " + Object.prototype.hasOwnProperty.call(st2.json, "truth"));
    /* 单人下「准备」是多余的：确认 choose 后直接 playing */
    console.log("8) 单人不需要 ready：phase 已为 " + st.json.phase);
  } catch (e) {
    console.error("✗ 失败", e);
    process.exit(1);
  }
})();
