/* 线上 Worker 运行验证：题库口径 + 15 人上限（回归）。
 * 服务端汤底的「字节级」取证在 tools/verify_deployed_script.js。
 * 用法：node tools/verify_worker_live.js
 */
const BASE = process.env.SOUP_BASE || "https://soup-room.57gqq9hsq.workers.dev";

/* 网络偶发抖动（ECONNRESET）时自动重试，避免把瞬时故障当成验证失败 */
async function j(p, opt) {
  let lastErr = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const r = await fetch(BASE + p, Object.assign({
        headers: { "content-type": "application/json", origin: "https://xiao-xiao6.github.io" }
      }, opt));
      const t = await r.text();
      let d = null;
      try { d = JSON.parse(t); } catch (e) { d = t; }
      return { status: r.status, data: d };
    } catch (e) {
      lastErr = e;
      await new Promise((res) => setTimeout(res, 400 * attempt));
    }
  }
  return { status: 0, data: { error: "NETWORK", detail: String(lastErr && lastErr.message) } };
}

(async () => {
  let fail = 0;
  const ok = (n, c, x) => { console.log((c ? "  ✓ " : "  ✗ ") + n + (x ? "   [" + x + "]" : "")); if (!c) fail++; };

  console.log("\n[1] 健康检查 /api/health");
  const h = await j("/api/health");
  ok("接口可达", h.status === 200, "status=" + h.status + " " + JSON.stringify(h.data).slice(0, 80));

  console.log("\n[2] 题库概览 /api/puzzle-stats");
  const st = await j("/api/puzzle-stats");
  ok("接口可达", st.status === 200 && st.data && st.data.ok === true, "status=" + st.status);
  if (st.data && st.data.ok) {
    ok("总数 1088", st.data.total === 1088, "total=" + st.data.total);
    ok("核心 100", st.data.core === 100, "core=" + st.data.core);
    ok("汤库 988", st.data.lib === 988, "lib=" + st.data.lib);
  }

  console.log("\n[3] 建房 + 单人房选到历史污染题（确认线上确有这样一锅）");
  const pid = "lib_314cc038dce2";
  const mk2 = await j("/api/solo/new", { method: "POST",
    body: JSON.stringify({ internalId: "live-1", nickname: "验证", puzzleId: pid }) });
  ok("单人房创建", !!(mk2.data && mk2.data.roomCode), mk2.data && mk2.data.roomCode);
  if (mk2.data && mk2.data.roomCode) {
    const s = await j("/api/solo/" + mk2.data.roomCode + "/state?me=live-1");
    const d = s.data || {};
    ok("选中了该题", d.puzzleId === pid, "puzzleId=" + d.puzzleId);
    ok("阶段进入 playing", d.phase === "playing", "phase=" + d.phase);
    ok("题面正确（借书）", (d.puzzle || {}).dispTitle === "借书", "title=" + (d.puzzle || {}).dispTitle);
    ok("下发的题面不含 truth（汤底只在服务端）", (d.puzzle || {}).truth === undefined);
  }

  console.log("\n[4] 多人房 15 人上限（回归）");
  const mk = await j("/api/room/new", { method: "POST",
    body: JSON.stringify({ internalId: "cap-host", nickname: "上限验证" }) });
  if (mk.data && mk.data.roomCode) {
    const code = mk.data.roomCode;
    let accepted = 1, rej = null;
    for (let i = 2; i <= 20; i++) {
      const r = await j("/api/room/" + code + "/join", { method: "POST",
        body: JSON.stringify({ internalId: "cap-" + i, nickname: "上限" + i }) });
      if (r.data && r.data.error) { rej = r.data.error; break; }
      accepted++;
    }
    ok("15 人上限（第 16 个 ROOM_FULL）", accepted === 15 && rej === "ROOM_FULL",
       "进房=" + accepted + " 拒绝=" + rej);
  } else {
    ok("建房", false, JSON.stringify(mk.data).slice(0, 80));
  }

  console.log("\n" + (fail === 0 ? "✅ 线上 Worker 运行验证全过" : "❌ 有失败") + "  " + fail + " failed\n");
  process.exit(fail === 0 ? 0 : 1);
})();
