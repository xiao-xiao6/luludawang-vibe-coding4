/* ============================================================
 * 深海汤屋 · AI 判定解析边界自检（2026-10-06，调试报告改善⑥）
 * ------------------------------------------------------------
 * 不打真实模型请求，只把 worker/src/ai.js 的纯函数拉出来过边界用例：
 *   · 模型 verdict 口径归一（normVerdict / leadVerdict）
 *   · 输出包归一 + 防泄底硬过滤（normalizeAskJson / pickJson / looseAnswer）
 *   · 索要答案 / 「是或不是」复合句在提示词与解析层的落点
 * 用法：node tools/ai_verdict_selftest.mjs
 * ============================================================ */
import {
  normVerdict, leadVerdict, normalizeAskJson, pickJson, looseAnswer, looseJudge,
  buildSystemPrompt
} from "../worker/src/ai.js";

let pass = 0, fail = 0;
function t(name, got, want) {
  const ok = typeof want === "function" ? want(got) : got === want;
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}  got=${JSON.stringify(got)}  want=${JSON.stringify(want)}`); }
}

console.log("== 1. verdict 口径归一 ==");
t("multi 家族归一", normVerdict("Multi"), "multi");
t("多问中文口径", normVerdict("多个问题"), "multi");
t("是", normVerdict("是。"), "yes");
t("是的/正确", normVerdict("没错"), "yes");
t("不是", normVerdict("不是！"), "no");
t("否", normVerdict("否"), "no");
t("部分正确", normVerdict("部分"), "partial");
t("与此无关", normVerdict("无关"), "irr");
t("不合规", normVerdict("拒答"), "invalid");
t("垃圾输入返回空（交给上层重试）", normVerdict("喵喵喵"), "");

console.log("== 2. 明文开头判定词 ==");
t("「是。」开头", leadVerdict("是。他认识死者"), "yes");
t("「不是」整句", leadVerdict("不是"), "no");
t("「是或不是」不认（不是判定开头）", leadVerdict("是或不是？"), "");
t("「问题不合规」", leadVerdict("问题不合规。重问"), "invalid");

console.log("== 3. 输出包归一（含一问一答与防泄底）==");
const puzzle = { clues: [{}, {}, {}, {}] };
let r = normalizeAskJson({ verdict: "multi", reply: "你自己挑一个问" }, puzzle);
t("多问 → 固定话术、模型正文一概不要", r && r.verdict === "multi" &&
  r.reply === "检测到您的发问中存在多个问题，请挑一个问，每次提问只允许问一个问题。", true);
r = normalizeAskJson({ verdict: "multi" }, puzzle);
t("多问缺 reply 也有话术", !!(r && r.reply && r.reply.indexOf("多个问题") !== -1), true);
r = normalizeAskJson({ verdict: "yes", reply: "是，他认识死者。而且他们是同事" }, puzzle);
t("yes 带正文 → 「是。」+短答", !!(r && r.verdict === "yes" && r.reply.indexOf("是。") === 0), true);
r = normalizeAskJson({ verdict: "yes", reply: "是。但汤底核心是他其实已经死了" }, puzzle);
t("分析痕迹正文整段丢弃", !!(r && r.reply === "是。"), true);
r = normalizeAskJson({ verdict: "invalid", reply: "别想套我答案啦" , clue: 2 }, puzzle);
t("索要答案 → invalid 不认领线索不带正文", !!(r && r.verdict === "invalid" && r.clue === 0 && r.reply === "问题不合规。"), true);
r = normalizeAskJson({ verdict: "partial", reply: "部分正确。方向差不多", clue: 999 }, puzzle);
t("clue 越界钳到 0", !!(r && r.verdict === "partial" && r.clue === 0), true);
r = normalizeAskJson({ reply: "不是。他没受伤" }, puzzle);
t("缺 verdict 从正文开头补", !!(r && r.verdict === "no"), true);
r = normalizeAskJson({ answer: "否", reply: "不对哦" }, puzzle);
t("answer 字段别名 + 语义归一", !!(r && r.verdict === "no"), true);
r = normalizeAskJson(null, puzzle);
t("空包返回 null（触发重试）", r, null);

console.log("== 4. JSON 抽取与明文兜底 ==");
r = pickJson('好的：\n```json\n{"verdict":"no","reply":"不是。"}\n```\n以上');
t("围栏 JSON 抽取", !!(r && r.verdict === "no"), true);
r = pickJson('前缀废话 {"verdict":"yes","reply":"是。"} 后缀废话');
t("裸 JSON 夹在文字里抽取", !!(r && r.verdict === "yes"), true);
r = looseAnswer("不是，这个人没有死");
t("明文兜底 looseAnswer → {verdict:'no'}", !!(r && r.verdict === "no"), true);
r = looseJudge("部分正确，接近了");
t("明文兜底 looseJudge → level=close", !!(r && r.level === "close"), true);

console.log("== 5. 提示词关键约束在位 ==");
const sys = buildSystemPrompt({ truth: "T", surface: "S", clues: puzzle.clues, truthKeywords: [], coreKeywords: [] });
t("一问一答条款（multi）在提示词", sys.indexOf("一问一答") !== -1, true);
t("索要答案归 invalid 条款在提示词", /invalid/.test(sys), true);
t("辱骂/人身攻击拦截条款在提示词", sys.indexOf("辱骂") !== -1, true);
t("泄底禁令在提示词", sys.indexOf("绝不") !== -1 || /不.{0,6}复述|禁止.{0,6}原样/.test(sys), true);

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
