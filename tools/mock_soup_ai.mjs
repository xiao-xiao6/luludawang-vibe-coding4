/* ============================================================
 * 本地测试用「假汤主」：OpenAI 兼容 /v1/chat/completions
 * ------------------------------------------------------------
 * 只在 wrangler dev 本地联调时起作用（tools/test_private_guess.mjs 配套）。
 * 规则：推理里带 SOLVED/CLOSE/VAGUE 标记就直接给对应判定，方便写断言。
 * ============================================================ */
import http from "node:http";

const PORT = Number(process.env.MOCK_AI_PORT || 8790);

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type,authorization",
      "access-control-allow-methods": "POST,OPTIONS"
    });
    return res.end();
  }
  let body = "";
  req.on("data", (c) => { body += c; });
  req.on("end", () => {
    let j = {};
    try { j = JSON.parse(body || "{}"); } catch (e) { /* 忽略 */ }
    const msgs = j.messages || [];
    const user = String((msgs.filter((m) => m.role === "user").slice(-1)[0] || {}).content || "");
    let content;
    if (user.includes("【玩家的推理】")) {
      // 判定通道
      let level = "no";
      if (user.includes("SOLVED")) level = "solved";
      else if (user.includes("CLOSE")) level = "close";
      else if (user.includes("VAGUE")) level = "vague";
      const note = { solved: "说破了。", close: "已经很近了。", vague: "再讲清楚一点。", "no": "方向还不对。" }[level];
      content = JSON.stringify({ level, note });
    } else {
      // 提问通道
      content = JSON.stringify({ verdict: "no", reply: "不是。", clue: 0 });
    }
    res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
    res.end(JSON.stringify({
      id: "mock", object: "chat.completion",
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }]
    }));
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("[mock-ai] listening on http://127.0.0.1:" + PORT + "/v1");
});
