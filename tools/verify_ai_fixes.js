/* 针对本轮修复的行为自检：不联网，直接喂假 transport / 假响应。
   跑法：node tools/verify_ai_fixes.js （在 海龟汤小游戏/ 目录下） */
"use strict";

var path = require("path");
var assert = require("assert");

var pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); }
}

/* ---------- 1. 浏览器端 js/ai.js ---------- */
var SoupAI = require(path.join(__dirname, "..", "js", "ai.js"));

console.log("\n[1] js/ai.js · extractText 兜底");
function fakeRes(obj) { return { status: 200, text: JSON.stringify(obj) }; }
var cfgOpen = { kind: "openai", baseUrl: "https://x/v1", model: "m", apiKey: "k", timeoutMs: 1000, maxTokens: 1200, temperature: 0.4 };

ok("content 正常时直取",
  SoupAI.extractText(cfgOpen, fakeRes({ choices: [{ message: { content: "是。对的" } }] })) === "是。对的");

ok("content 为空 + reasoning_content 有货时兜底",
  SoupAI.extractText(cfgOpen, fakeRes({ choices: [{ message: { content: "", reasoning_content: '{"verdict":"yes","reply":"是。","clue":0}' } }] }))
    .indexOf("verdict") !== -1);

ok("content 是数组时拼接",
  SoupAI.extractText(cfgOpen, fakeRes({ choices: [{ message: { content: [{ text: "部分" }, { text: "正确。" }] } }] })) === "部分正确。");

ok("anthropic content blocks",
  SoupAI.extractText({ kind: "anthropic" }, fakeRes({ content: [{ text: "与此无关。" }] })) === "与此无关。");

ok("json.output 兜底",
  SoupAI.extractText(cfgOpen, fakeRes({ output: "是。" })) === "是。");

console.log("\n[2] js/ai.js · leadKey 标点放宽");
ok("是。", SoupAI.leadKey("是。对的") === "yes");
ok("是的 → 不认（防止把陈述当判定）", SoupAI.leadKey("是的他去了") === "");
ok("反问句不误判", SoupAI.leadKey("是不是有人进过房间") === "");
ok("叹号收尾也认", SoupAI.leadKey("不是！他没去过") === "no");
ok("冒号收尾也认", SoupAI.leadKey("部分正确：还差一层") === "partial");

console.log("\n[3] js/ai.js · parseAnswer 思考块 / 围栏 / 举例");
var withThink = "思考中：先看汤面……\n<think>\n玩家问的是xxx，我给{\"verdict\":\"no\"}\n</think>\n```json\n{\"verdict\":\"partial\",\"reply\":\"部分正确。方向对了\",\"clue\":0}\n```";
var p1 = SoupAI.parseAnswer(withThink);
ok("剥思考块后取到真答案", p1 && p1.verdict === "partial", JSON.stringify(p1));

var multi = '{"verdict":"irr","reply":"示例"} 然后最终答案是 {"verdict":"yes","reply":"是。他确实去过海边。","clue":2}';
var p2 = SoupAI.parseAnswer(multi);
ok("多个 JSON 时取最像答案的（靠后优先）", p2 && p2.verdict === "yes", JSON.stringify(p2));

console.log("\n[4] js/ai.js · guardAnswer 线索判定重写不再产出空 reply");
var puz = { truth: "他跳了", truthKeywords: [], clues: [{ type: "no", text: "他没去过" }] };
var g = SoupAI.guardAnswer(puz, { verdict: "yes", reply: "是。", clue: 1 });
ok("clue 判定覆盖 verdict 且 reply 非空", g.ok && g.verdict === "no" && g.reply === "不是。", JSON.stringify(g));

console.log("\n[4b] js/ai.js · 明文判定兜底（模型不吐 JSON 时）");
var plain1 = SoupAI.parseAnswer("是的，他确实去过海边。");
ok("明文「是的，…」认出 yes 且补标准开头", plain1 && plain1.verdict === "yes" && plain1.reply.indexOf("是。") === 0, JSON.stringify(plain1));
var plain2 = SoupAI.parseAnswer("这个问题和案件无关。");
ok("明文「无关」认出 irr", plain2 && plain2.verdict === "irr", JSON.stringify(plain2));
var plain3 = SoupAI.parseAnswer("他是不是去过海边？我不能说。");
ok("反问句不误判成 no", !plain3 || plain3.verdict !== "no", JSON.stringify(plain3));
var plain4 = SoupAI.parseAnswer("嗯，不是的，他没有去过。");
ok("判定词在句中也认得出 no", plain4 && plain4.verdict === "no", JSON.stringify(plain4));

console.log("\n[4c] js/ai.js · guardAnswer 不再因开头缺判定词整句丢弃");
var g2 = SoupAI.guardAnswer(puz, { verdict: "yes", reply: "他确实去过海边。", clue: 0 });
ok("没放开头自动补「是。」", g2.ok && g2.reply.indexOf("是。") === 0, JSON.stringify(g2));
var g3 = SoupAI.guardAnswer(puz, { verdict: "yes", reply: "不是。他没去过。", clue: 0 });
ok("开头判定词与 verdict 冲突时以开头为准", g3.ok && g3.verdict === "no", JSON.stringify(g3));

console.log("\n[4d] js/ai.js · 猜底明文兜底");
var gj = SoupAI.parseGuess("你猜得很接近了，就差一层。");
ok("明文认出 close", gj && gj.level === "close", JSON.stringify(gj));

console.log("\n[5] js/ai.js · callModel 空正文报 empty-reply（且会重试一次）");
/* ask() 会先查 isReady，所以先把一份完整配置写进假的 localStorage */
var fakeStore = {};
globalThis.localStorage = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(fakeStore, k) ? fakeStore[k] : null; },
  setItem: function (k, v) { fakeStore[k] = String(v); }
};
SoupAI.save({ enabled: true, provider: "custom", baseUrl: "https://x/v1", model: "m", apiKey: "k" });
var calls = 0;
SoupAI.__setTransport(function () {
  calls++;
  return Promise.resolve(fakeRes({ choices: [{ message: { content: "" } }] }));
});
SoupAI.ask({ surface: "s", truth: "t", clues: [] }, "他去了吗", {}).then(function () {
  ok("不该成功", false);
}, function (err) {
  ok("报 empty-reply 而不是笼统 unparsable", err.code === "empty-reply", err.code);
  ok("重试了一次（共 2 次调用）", calls === 2, "calls=" + calls);
  SoupAI.__resetTransport();
  return afterEmptyReply(err);
}).then(function (mod) {
  if (!mod || !mod.isLocalOnlyUrl) {
    console.log("\n跳过后半段（服务端模块导入失败）");
    console.log("\n--------------------------------------------------");
    console.log("通过 " + pass + " 项，失败 " + fail + " 项");
    process.exit(fail ? 1 : 0);
  }
  var f = mod.isLocalOnlyUrl;
  ok("127.0.0.1 判本机", f("http://127.0.0.1:8123/v1") === true);
  ok("localhost 判本机", f("http://localhost:8000/v1") === true);
  ok("192.168.x 判内网", f("http://192.168.1.9:1234/v1") === true);
  ok("10.x 判内网", f("http://10.0.0.5/v1") === true);
  ok("172.16~31 判内网", f("http://172.20.3.4/v1") === true);
  ok("公网地址不误伤", f("https://api.deepseek.com/v1") === false);
  ok("172.32 不是内网段", f("http://172.32.0.1/v1") === false);

  console.log("\n--------------------------------------------------");
  console.log("通过 " + pass + " 项，失败 " + fail + " 项");
  process.exit(fail ? 1 : 0);
}).catch(function (e) {
  console.log("\nharness 异常：" + (e && e.stack || e));
  process.exit(2);
});

function afterEmptyReply() {
  console.log("\n[6] js/ai.js · describeError 分因文案");
  ok("empty-reply 有专属文案", /空内容|截断/.test(SoupAI.describeError({ code: "empty-reply" })));
  ok("guarded:lead-missing 有中文解释", /判定词没放在开头/.test(SoupAI.describeError({ code: "guarded:lead-missing" })));

  console.log("\n[7] worker/src/ai.js · isLocalOnlyUrl");
  var target = path.join(__dirname, "..", "worker", "src", "ai.js");
  return import("file://" + target.replace(/\\/g, "/"));
}