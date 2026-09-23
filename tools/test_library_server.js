/* 库层服务端化自测：node tools/test_library_server.js
 * 验证：库题汤底在服务端可用、但绝不下发前端 */
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
    const stats = await api("/api/puzzle-stats");
    console.log("1) 题库概览 →", JSON.stringify(stats.json));

    const core = await api("/api/puzzles");
    console.log("2) 默认清单 layer=" + core.json.layer + " total=" + core.json.total);
    console.log("   含 truth? " + JSON.stringify(core.json).includes('"truth"'));

    const lib = await api("/api/puzzles?layer=lib&limit=5");
    console.log("3) 库层清单 total=" + lib.json.total + " 本次返回=" + lib.json.puzzles.length);
    const libId = lib.json.puzzles[0].id;
    console.log("   样例 id=" + libId + " 标题=" + JSON.stringify(lib.json.puzzles[0].dispTitle));
    console.log("   含 truth? " + JSON.stringify(lib.json).includes('"truth"'));

    const one = await api("/api/puzzle/" + libId);
    console.log("4) 单题详情 → layer=" + one.json.puzzle.layer + " clueCount=" + one.json.puzzle.clueCount);
    console.log("   含 truth? " + JSON.stringify(one.json).includes('"truth"'));

    /* 库题开局：没配 AI 时应拒绝关键词判定 */
    const mk = await api("/api/solo/new", "POST", { internalId: "u_lib", nickname: "库汤客", puzzleId: libId });
    const code = mk.json.roomCode;
    console.log("5) 开库题单人局 " + code);
    const ask = await api("/api/solo/" + code + "/ask", "POST", { internalId: "u_lib", question: "他是自杀的吗" });
    console.log("6) 库题未配 AI 提问 → " + JSON.stringify(ask.json));
    const g = await api("/api/solo/" + code + "/guess", "POST", { internalId: "u_lib", text: "随便猜一下试试看结果" });
    console.log("7) 库题未配 AI 猜底 → " + JSON.stringify(g.json));

    const st = await api("/api/solo/" + code + "/state?me=u_lib");
    console.log("8) 快照 含 truth? " + Object.prototype.hasOwnProperty.call(st.json, "truth") + " phase=" + st.json.phase);
  } catch (e) {
    console.error("✗ 失败", e);
    process.exit(1);
  }
})();
