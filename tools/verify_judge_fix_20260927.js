/* ============================================================
 * 2026-09-27 「误判与此无关 / 半截思维链上屏」专项验收（不联网）
 * ------------------------------------------------------------
 * 跑法：node tools/verify_judge_fix_20260927.js
 *
 * 复现的是主人在多人房截图里看到的两类翻车：
 *   A. 玩家问「女儿是同人女吗」→ 汤主回了「与此无关」
 *      （故事内提问被误判成题外话）
 *   B. 判「部分正确」后，正文带出「但汤底核心：她想被叫妈妈，是因为…想」
 *      半截分析，而且被 28 字硬截断，看起来像漏了半截思维链
 * ============================================================ */
"use strict";

var path = require("path");
var fs = require("fs");
var assert = require("assert");

var pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  \u2713 " + name); }
  else { fail++; console.log("  \u2717 " + name + (extra ? "  \u2192 " + extra : "")); }
}

/* 截图里那一锅的真实数据（龟女 / 龟男，来自 js/library.public.js） */
var puzzle = {
  surface: "龟女今年的圣诞节登记结婚了。龟女之所以能对婚姻积极主动，是因为龟男列出的择偶条件，自己竟然条条吻合。婚后同住，龟女觉得龟男越来越可爱、越看越心疼。可这样的龟女，却｛不想让龟男叫自己的名字｝，理由到底是什么呢？",
  truth: "龟女其实｛是龟男父亲的爱人｝。两人交往顺利，但她没自信能被龟男接纳为一家人，迟迟踏不进婚姻。直到某天，从寄给圣诞老人的信里，她发现龟男许愿「希望龟女做我的妈妈（也就是父亲的｛结婚对象｝）」，于是两人立刻结了婚。把成了自己继子的男孩疼得像亲生孩子一样的龟女，想被叫的不是「龟女小姐」，而是｛「妈妈」｝。",
  truthKeywords: [],
  clues: []
};

console.log("\n[1] js/ai.js · 提示词补上铁律13（故事内提问不许判与此无关）");
var SoupAI = require(path.join(__dirname, "..", "js", "ai.js"));
var sysP = SoupAI.buildSystemPrompt(puzzle);
ok("含铁律13", sysP.indexOf("13. ") !== -1 && sysP.indexOf("与此无关") !== -1);
ok("明确举例「女儿是同人女」", sysP.indexOf("不是。这个故事里没有女儿。") !== -1);

console.log("\n[2] js/ai.js · 「但汤底核心：…」这类分析尾巴必须被拦住");
var leak = "部分正确。但汤底核心：她想被叫妈妈，是因为把龟男疼得像亲生孩子，想";
var gl = SoupAI.guardAnswer(puzzle, { verdict: "partial", reply: leak, clue: 0 });
ok("带「但汤底核心」的 reply 被打回或清干净",
  gl.ok === false || gl.reply.indexOf("汤底") === -1,
  JSON.stringify(gl));

/* 截图 B 的另一种形态：分析痕迹在判定词之后，且被 28 字砍断 */
var gl2 = SoupAI.guardAnswer(puzzle, {
  verdict: "partial",
  reply: "部分正确。汤底的关键是她想被叫妈妈，是因为把龟男疼得像亲生孩子一样疼"
});
ok("带「汤底的关键是」也不放行",
  gl2.ok === false || gl2.reply.indexOf("汤底") === -1, JSON.stringify(gl2));

console.log("\n[3] js/ai.js · 不再把正文硬截成 28 字");
/* 28 字是旧版魔数：截完会出现「…，想」这种半截句。
   这里用一句 29 字、且第 28 字后面还有内容的话当探针——旧版必被砍。 */
var longBody = "不是。他确实在那天去过海边，而且回来得很晚，身上还带着咸味的海水";
var g3 = SoupAI.guardAnswer(puzzle, { verdict: "no", reply: longBody });
ok("正文完整保留、句尾没被砍（旧版会截到 28 字）",
  g3.ok === true && g3.reply === longBody, JSON.stringify(g3));
ok("结尾是完整句子（不以逗号/顿号断尾）",
  !/[，,、：:；;]$/.test(g3.reply), JSON.stringify(g3.reply));

console.log("\n[4] js/ai.js · 明文兜底路径同样不硬截");
var plainSrc = "嗯，不是的，他确实在那天去过海边，而且回来得很晚，身上还有咸咸的海水味。";
var p4 = SoupAI.parseAnswer(plainSrc);
ok("明文判定保留完整首句（尾部在 28 字之后）",
  !!p4 && p4.reply.indexOf("海水味") !== -1, JSON.stringify(p4));

console.log("\n[5] js/ai.js · 合法短答不被误杀（回归保护）");
var gKeep = SoupAI.guardAnswer(puzzle, { verdict: "yes", reply: "是。他确实去过海边。" });
ok("普通短答照旧通过", gKeep.ok === true && gKeep.reply === "是。他确实去过海边。", JSON.stringify(gKeep));
var gAway = SoupAI.guardAnswer(puzzle, { verdict: "irr", reply: "与此无关。汤底要自己熬出来。" });
ok("索要答案的标准话术没被误杀", gAway.ok === true, JSON.stringify(gAway));
var gCompound = SoupAI.guardAnswer({ truth: "t", clues: [] }, { verdict: "partial", reply: "部分正确。人是正常成年男人，体重却偏轻。" });
ok("复合提问的三段短答仍放行", gCompound.ok === true, JSON.stringify(gCompound));

console.log("\n[6] js/ai.js · 截断检测（finish_reason=length）");
var fakeStore = {};
globalThis.localStorage = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(fakeStore, k) ? fakeStore[k] : null; },
  setItem: function (k, v) { fakeStore[k] = String(v); }
};
SoupAI.save({ enabled: true, provider: "custom", baseUrl: "https://x/v1", model: "m", apiKey: "k" });
var seenBudgets = [];
SoupAI.__setTransport(function (req) {
  var b = req.body || {};
  seenBudgets.push(b.max_tokens);
  /* 第一把故意返回被截断的（半截 JSON），第二把返回完整答案 */
  if (seenBudgets.length === 1) {
    return Promise.resolve({ status: 200, text: JSON.stringify({
      choices: [{ finish_reason: "length", message: { content: '{"verdict":"partial","reply":"部分正确。她想被叫妈妈，是因' } }]
    }) });
  }
  return Promise.resolve({ status: 200, text: JSON.stringify({
    choices: [{ finish_reason: "stop", message: { content: '{"verdict":"partial","reply":"部分正确。她想被叫妈妈。","clue":0}' } }]
  }) });
});

SoupAI.ask(puzzle, "龟女为什么不想被叫名字？", {}).then(function (out) {
  ok("截断后自动重试并成功", out && out.verdict === "partial", JSON.stringify(out));
  ok("重试时放宽了 max_tokens", seenBudgets.length === 2 && seenBudgets[1] > seenBudgets[0],
    JSON.stringify(seenBudgets));
  ok("上屏文案没有半截尾巴", out && /[。]$/.test(out.reply), JSON.stringify(out && out.reply));

  console.log("\n[7] worker/src/ai.js · 服务端同口径");
  return import("file://" + path.join(__dirname, "..", "worker", "src", "ai.js").replace(/\\/g, "/"));
}).then(function (mod) {
  var sysW = mod.buildSystemPrompt(puzzle);
  ok("Worker 提示词同样含铁律13", sysW.indexOf("13. ") !== -1 && sysW.indexOf("不是。这个故事里没有女儿。") !== -1);
  ok("Worker 导出 normalizeAskJson / normVerdict",
    typeof mod.normalizeAskJson === "function" && typeof mod.normVerdict === "function");

  /* A. 判定码认不出时不再静默落 irr —— 必须返回 null 交给上层重试 */
  var bad = mod.normalizeAskJson({ verdict: "maybe", reply: "嗯……" }, puzzle);
  ok("认不出的判定码返回 null（不再默认 irr）", bad === null, JSON.stringify(bad));
  /* B. 中文判定词仍能归一 */
  var cn = mod.normalizeAskJson({ verdict: "部分正确。", reply: "部分正确。她想被叫妈妈。" }, puzzle);
  ok("带标点的中文判定能归一成 partial", !!cn && cn.verdict === "partial", JSON.stringify(cn));
  /* C. 「但汤底核心：…」必须被清干净 */
  var leakW = mod.normalizeAskJson({ verdict: "partial", reply: leak }, puzzle);
  ok("Worker 侧同样拦住「但汤底核心」",
    !!leakW && leakW.reply.indexOf("汤底") === -1, JSON.stringify(leakW));
  /* D. 英文判定码 */
  var en = mod.normalizeAskJson({ verdict: "YES", reply: "是。他去过。" }, puzzle);
  ok("英文 YES 归一成 yes", !!en && en.verdict === "yes", JSON.stringify(en));
  /* E. 字段缺失但 reply 开头有判定词 */
  var noField = mod.normalizeAskJson({ reply: "不是。故事里没有女儿。" }, puzzle);
  ok("字段缺失时从 reply 开头认判定", !!noField && noField.verdict === "no", JSON.stringify(noField));

  console.log("\n[8] worker/src/room.js · 出口不再静默降级");
  var room = fs.readFileSync(path.join(__dirname, "..", "worker", "src", "room.js"), "utf8");
  ok("room.js 已 import normalizeAskJson", /normalizeAskJson/.test(room));
  ok("room.js 里旧的「var verdict = \"irr\"」兜底已移除",
    !/var verdict = "irr";/.test(room));
  ok("room.js 认不出时返回 AI_BAD_FORMAT", /AI_BAD_FORMAT/.test(room));
  ok("Worker REASON_TAIL 覆盖「但汤底」", mod.REASON_TAIL.test("但汤底核心：她想被叫妈妈"));
  ok("Worker REASON_TAIL 不误伤「汤底要自己熬出来」",
    !mod.REASON_TAIL.test("汤底要自己熬出来。"));

  console.log("\n--------------------------------------------------");
  console.log((fail === 0 ? "\u2705 全部通过  " : "\u274c 有失败  ") + pass + " passed / " + fail + " failed");
  process.exit(fail ? 1 : 0);
}).catch(function (e) {
  console.log("\nharness 异常：" + (e && e.stack || e));
  process.exit(2);
});
