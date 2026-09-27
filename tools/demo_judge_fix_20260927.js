/* ============================================================
 * 2026-09-27 判定修复 · 前后对比演示（不联网，可控输出）
 * ------------------------------------------------------------
 * 跑法：node tools/demo_judge_fix_20260927.js
 *
 * 用主人截图里的两个真实场景，对比「修之前」和「修之后」玩家实际能看到什么。
 * 两种修复要分清：
 *   (1) 提示词级 —— 影响模型下一次怎么答（本地没法真跑模型，这里只做提示词差分 + 断言）
 *   (2) 管道级   —— 模型照旧乱答时，代码能不能兜住（本地可完整复现）
 * 「修之前」的旧逻辑按仓库里改动前那份代码原样复刻。
 * ============================================================ */
"use strict";

var path = require("path");
var fs = require("fs");
var SoupAI = require(path.join(__dirname, "..", "js", "ai.js"));

var line = function (s) { console.log(s == null ? "" : s); };
var rule = function () { console.log("-".repeat(68)); };
var ipass = 0, ifail = 0;
function chk(name, cond, extra) {
  if (cond) { ipass++; line("     \u2713 " + name); }
  else { ifail++; line("     \u2717 " + name + (extra ? "  \u2192 " + extra : "")); }
}

var puzzle = {
  surface: "龟女今年的圣诞节登记结婚了。龟女之所以能对婚姻积极主动，是因为龟男列出的择偶条件，自己竟然条条吻合。婚后同住，龟女觉得龟男越来越可爱、越看越心疼。可这样的龟女，却｛不想让龟男叫自己的名字｝，理由到底是什么呢？",
  truth: "龟女其实｛是龟男父亲的爱人｝。两人最终结婚，把成了自己继子的男孩疼得像亲生孩子一样的龟女，想被叫的不是｛「龟女小姐」｝，而是｛「妈妈」｝。",
  truthKeywords: [],
  clues: []
};

/* ---------- 旧逻辑（改动前仓库里的原样复刻） ---------- */
var OLD_REASON = /(根据(汤底|题目|故事|设定|材料|题面)|汤底(说|写|里|中|表明|显示)|让我(们)?(先)?(想|分析|看|梳理|猜|盘)|我先(想|分析|看|梳理)|首先|其次|综上|分析一下|分析过程|分析如下|推理(过程|一下|链)|思考(过程|一下)|真正的答案|解释一下|举个?例|也就是说)/;
var LEAD = { yes: "是", no: "不是", partial: "部分正确", irr: "与此无关" };

function oldGuard(answer) {
  var reply = SoupAI.sanitize(answer.reply);
  var v = String(answer.verdict || "").toLowerCase();
  var lk = SoupAI.leadKey(reply);
  if (!lk) {
    var m = reply.match(/^[^。！？；]{0,28}/);       /* 旧版写死 28 字 */
    reply = ((LEAD[v] || "与此无关") + "。" + (m ? m[0] : "")).slice(0, 158);
  } else if (lk !== v) { v = lk; }
  if (OLD_REASON.test(reply) || (reply.match(/[。！？]/g) || []).length >= 4) {
    return { ok: false, reason: "reason-dump" };
  }
  return { ok: true, verdict: v, reply: reply };
}

line("");
line("============ 判定修复 · 前后对比（本地，不联网）============");

/* ================= 场景 A ================= */
line("");
rule();
line("场景 A｜玩家问「女儿是同人女吗」，汤主回了「与此无关」");
rule();
line("  【根因】这是「故事内提问」——问故事里有没有这个元素。");
line("     旧提示词只示范了「现实知识 / 闲聊 / 要答案 → 与此无关」，");
line("     没讲「故事里没这个人」该怎么办，模型就把「汤面没出现」当成了「与本题无关」。");
line("     这是**提示词盲区**，跟模型智力无关。");
line("");
line("  【修复点 1】提示词补铁律 13（影响模型下次怎么答）");
var sysNew = SoupAI.buildSystemPrompt(puzzle);
var sysOld = sysNew.replace(/13\. 【关键】[\s\S]*$/, "");
line("     旧提示词里有铁律13吗？ " + (sysOld.indexOf("13. ") === -1 ? "没有" : "有"));
chk("新提示词含铁律13", sysNew.indexOf("13. 【关键】") !== -1);
chk("新提示词明确「不是。这个故事里没有女儿。」这条示范",
  sysNew.indexOf("不是。这个故事里没有女儿。") !== -1);
chk("新提示词要求：故事内提问不许判与此无关",
  /绝不许因为[\s\S]{0,40}就判「与此无关」/.test(sysNew));
line("     ⚠ 提示词只能引导模型，本地不真跑模型就没法保证它一定照做 ——");
line("       所以下面这层「管道兜底」才是硬保证。");

line("");
line("  【修复点 2】管道兜底：判定码认不出时不再静默判成「与此无关」");
line("     假设模型不老实，回了个它自己编的判定码：{\"verdict\":\"maybe\",\"reply\":\"嗯……\"}");
line("     ❌ 修之前（room.js 里 var verdict = \"irr\"）：直接当「与此无关」上屏。");
line("     ✅ 修之后：返回 null → 带更强提醒重试；两次都不行才报「格式不对」。");
line("     本地实测（直接调用服务端归一函数）：");
/* 服务端模块是 ESM，CJS 里用子进程跑，避免顶层 await */
var cp = require("child_process");
var probe = "import { normalizeAskJson } from " + JSON.stringify(
  "file://" + path.join(__dirname, "..", "worker", "src", "ai.js").replace(/\\/g, "/")
) + ";\n" +
"const r = normalizeAskJson({ verdict: 'maybe', reply: '嗯……' }, { surface: '', truth: '', clues: [] });\n" +
"process.stdout.write(JSON.stringify(r));";
var probeOut = cp.execFileSync(process.execPath, ["--input-type=module", "-e", probe], { encoding: "utf8" }).trim();
line("        normalizeAskJson({verdict:\"maybe\"}) → " + probeOut);
chk("旧版会在这里落 irr，新版返回 null（交给上层重试）", probeOut === "null");
var roomSrc = fs.readFileSync(path.join(__dirname, "..", "worker", "src", "room.js"), "utf8");
line("        （room.js 里旧的 `var verdict = \"irr\"` → "
  + (/var verdict = "irr";/.test(roomSrc) ? "❌ 还在" : "✅ 已移除") + "）");
chk("room.js 改为认不出时返回 AI_BAD_FORMAT", /AI_BAD_FORMAT/.test(roomSrc));

/* ================= 场景 B ================= */
line("");
rule();
line("场景 B｜判「部分正确」时，把内部推理尾巴吐上了屏（还断在半句话上）");
rule();
var leak = { verdict: "partial", reply: "部分正确。但汤底核心：她想被叫妈妈，是因为把龟男疼得像亲生孩子，想" };
line("  【根因】模型 reply 里带了内部推理尾巴：");
line("     " + JSON.stringify(leak.reply));
line("     ① 旧过滤词表只有「汤底说 / 汤底写」，**没有「但汤底」**，所以没拦住；");
line("     ② 旧版还把没带判定词开头的正文**硬砍成前 28 个字**，句子正好断在「…，想」——");
line("        这就是截图上那半截「像漏了思维链」的字。");
line("");
line("     ❌ 修之前 · 玩家看到的：");
var before = oldGuard(leak);
line("        " + (before.ok ? ("【" + before.verdict + "】" + before.reply) : ("打回重试（" + before.reason + "）")));
line("");
line("     ✅ 修之后 · 本地实测：");
var after = SoupAI.guardAnswer(puzzle, leak);
line("        " + (after.ok ? ("【" + after.verdict + "】" + after.reply) : ("打回重试（reason = " + after.reason + "）→ 脏内容不上屏")));
chk("「但汤底核心：…」这类尾巴被拦住（不放行或已清干净）",
  after.ok === false || after.reply.indexOf("汤底") === -1, JSON.stringify(after));

line("");
line("  【修复点 3】28 字硬截断改掉：正常长句按整句保留，不再拦腰断");
line("     （28 字魔数在**前端** js/ai.js：模型忘了把判定词放开头时，旧版会砍前 28 字）");
var longBody = "他确实在那天去过海边，而且回来得很晚，身上还带着一股咸咸的海水味";
line("     模型这一把吐的是（没带判定词开头）： " + longBody + "   [" + longBody.length + " 字]");
var oldLong = oldGuard({ verdict: "no", reply: longBody });
var newLong = SoupAI.guardAnswer(puzzle, { verdict: "no", reply: longBody });
line("     ❌ 修之前： " + (oldLong.ok ? oldLong.reply : "（打回）"));
line("     ✅ 修之后： " + (newLong.ok ? newLong.reply : "（打回）"));
chk("长句完整保留（旧版会砍到 28 字、断在半句）",
  newLong.ok && newLong.reply.indexOf("海水味") !== -1,
  JSON.stringify(newLong));
chk("旧版确实会砍断（对照组有效）",
  oldLong.ok && oldLong.reply.indexOf("海水味") === -1, JSON.stringify(oldLong));

line("");
line("  【修复点 4】finish_reason=length（被 max_tokens 掐断）不再当答案用");
line("     模型话说到一半就被额度掐断时，会把半个 JSON / 半句话当结果 —— 这是");
line("     「像漏了思维链」的另一来源。现在会识别出来、临时放宽额度重试一次。");

/* ================= 汇总 ================= */
line("");
rule();
line("本地断言汇总：" + (ifail === 0 ? "\u2705 全部通过" : "\u274c 有失败") + "  " + ipass + " passed / " + ifail + " failed");
rule();
line("");
line("一句话总结：");
line("  · 判错「与此无关」→ 提示词补铁律13 + 判定码认不出时不再静默降级（两处一起修）");
line("  · 半截思维链上屏 → 过滤词表补「但汤底…」+ 干掉 28 字硬截断 + 识别被截断的回复");
line("");
process.exit(ifail ? 1 : 0);
