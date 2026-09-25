/* 2026-09-25 「提问」提示词与思维链硬过滤的验收自检（不联网）
 * 跑法：node tools/verify_prompt_20260925.js
 */
"use strict";
const path = require("path");
const fs = require("fs");
const SoupAI = require(path.join(__dirname, "..", "js", "ai.js"));
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); }
}

console.log("\n[1] 前端 js/ai.js · 提示词新规");
const sys = SoupAI.buildSystemPrompt({ surface: "汤面X", truth: "汤底Y", truthKeywords: ["k"], clues: [] });
ok("含铁律10（判定锚在汤面）", sys.indexOf("10. 玩家只能看到汤面") !== -1);
ok("含铁律11（禁止输出思维链）", sys.indexOf("11. 思考") !== -1);
ok("猜底提示词加「不要解释怎么判断」", SoupAI.buildGuessUser({ truth: "t" }, "g").indexOf("不要解释") !== -1);

console.log("\n[2] 前端 js/ai.js · 思维链硬过滤");
const p1 = SoupAI.parseAnswer("让我想想，不是的，他没有去过。");
ok("明文分析段不再整段透传", !!p1 && p1.verdict === "no" && p1.reply.indexOf("让我") === -1, JSON.stringify(p1));
const p1b = SoupAI.parseAnswer("我先分析一下：根据汤底，他去过海边，所以是的，他去过。");
ok("判定词前的分析被丢弃", !p1b || (p1b.reply.indexOf("根据") === -1 && p1b.reply.indexOf("分析") === -1), JSON.stringify(p1b));
const g1 = SoupAI.guardAnswer({ truth: "很久以前他去了海边又回来", clues: [] }, { verdict: "yes", reply: "是。因为汤底写着他去过海边。", clue: 0 });
ok("把关拒绝带「汤底写」的 reply", !g1.ok && g1.reason === "reason-dump", JSON.stringify(g1));
const g2 = SoupAI.guardAnswer({ truth: "很久以前他去了海边", clues: [] }, { verdict: "yes", reply: "是。他确实去过。", clue: 0 });
ok("正常短答不受影响", g2.ok && g2.reply === "是。他确实去过。", JSON.stringify(g2));

console.log("\n[3] Worker worker/src/ai.js · 同口径");
import("file://" + path.join(__dirname, "..", "worker", "src", "ai.js").replace(/\\/g, "/")).then(function (mod) {
  const sys2 = mod.buildSystemPrompt({ surface: "汤面X", truth: "汤底Y" });
  ok("Worker 提示词含铁律10/11", sys2.indexOf("10. 玩家只能看到汤面") !== -1 && sys2.indexOf("11. 思考") !== -1);
  ok("Worker 导出 REASON_TAIL", mod.REASON_TAIL instanceof RegExp);
  const la = mod.looseAnswer("让我分析一下，根据汤底他去过。不是，他没去过。");
  ok("Worker 明文兜底剥掉分析", !!la && la.verdict === "no" && la.reply.indexOf("根据") === -1 && la.reply.indexOf("分析") === -1, JSON.stringify(la));
  const room = fs.readFileSync(path.join(__dirname, "..", "worker", "src", "room.js"), "utf8");
  ok("房间上屏出口过 REASON_TAIL", /REASON_TAIL\.test\(reply\)/.test(room) && /REASON_TAIL\.test\(note\)/.test(room));
  console.log("\n" + (fail === 0 ? "✅ 全部通过" : "❌ 有失败") + "  " + pass + " passed / " + fail + " failed");
  process.exit(fail ? 1 : 0);
}, function (e) {
  console.log("worker import 失败: " + e.message);
  process.exit(2);
});
