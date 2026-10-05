/* ============================================================
 * 判定话术防泄底 + 一问一答 单元测试（纯本地，不连 Worker）
 * 用法：node tools/test_judge_filter.js
 * ============================================================ */
const path = require("path");
const { pathToFileURL } = require("url");

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (detail ? "  → " + detail : "")); }
}

(async function () {
  const engDir = path.resolve(__dirname, "..", "worker", "src");
  const engine = await import(pathToFileURL(engDir + "/engine.js").href);
  const ai = await import(pathToFileURL(engDir + "/ai.js").href);
  const turtle = engine.getPuzzle("turtle");

  /* ---------- 1. leaksTruth：note 原样带出汤底连续 ≥7 字 = 泄底 ---------- */
  ok("leaksTruth 抓到「同伴的肉煮成汤」式泄底",
    engine.leaksTruth(turtle, "我怕鱼是因为有过不好的回忆", "没说中同伴的肉煮成汤骗他这一关键因果") === true);
  ok("leaksTruth 放行空泛指路",
    engine.leaksTruth(turtle, "他吃过人", "方向对了一半，最关键的因果还没说中。") === false);
  ok("leaksTruth 玩家自己说过的不算泄底",
    engine.leaksTruth(turtle, "当年同伴的肉煮成汤骗他说是海龟汤", "你说了肉煮成汤骗他，但没说破为什么") === false);
  ok("leaksTruth 汤面自带的词不算泄底",
    engine.leaksTruth(turtle, "随便猜猜", "他确实走进过海边的餐厅") === false);
  ok("leaksTruth 空 note 不误伤", engine.leaksTruth(turtle, "x", "") === false);

  /* ---------- 2. 一问一答：multi 档贯通 ---------- */
  ok("normVerdict 认 multi", ai.normVerdict("multi") === "multi" && ai.normVerdict("多个问题") === "multi");
  const m = ai.normalizeAskJson({ verdict: "multi", reply: "随便写的复述", clue: 3 }, turtle);
  ok("normalizeAskJson：multi 固定话术 + clue 归零",
    m && m.verdict === "multi" && m.clue === 0 &&
    m.reply === "检测到您的发问中存在多个问题，请挑一个问，每次提问只允许问一个问题。",
    JSON.stringify(m));

  /* ---------- 3. 提示词落位 ---------- */
  const sys = ai.buildSystemPrompt(turtle);
  ok("ask 系统提示含「一问一答」与 multi 取值", sys.indexOf("【一问一答】") !== -1 && sys.indexOf("invalid / multi") !== -1);
  ok("ask 系统提示不再教模型迁就多问", sys.indexOf("把每个小问题都答到") === -1);
  const usr = ai.buildAskUser(turtle, "男人是正常男人吗，身高体重是不是正常成年男人的范畴？", {});
  ok("buildAskUser 不再注入多问迁就指令", usr.indexOf("把每个小问题都简短答到") === -1);
  const js = ai.buildJudgeSystem(turtle);
  ok("judge 用 70/30 新尺", js.indexOf("score ≥ 70") !== -1 && js.indexOf("30 ≤ score < 70") !== -1);
  ok("judge 含 note 防泄底铁律", js.indexOf("note 铁律（防泄底") !== -1 && js.indexOf("否定句式") !== -1);

  /* ---------- 4. REASON_TAIL 英文思维链 ---------- */
  ok("REASON_TAIL 认英文思维链",
    ai.REASON_TAIL.test("We need answer as judge. Need evaluate player's reasoning") === true &&
    ai.REASON_TAIL.test("Let me think about the player's guess first") === true);

  console.log("\n结果：通过 " + pass + " 项 / 失败 " + fail + " 项");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("✗ 脚本异常", e); process.exit(1); });
