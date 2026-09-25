/* 复合提问提示词 + 复述空答拦截 自检（node tools/verify_compound_qa_fixes.js） */
"use strict";
require("../js/engine.js");
const AI = require("../js/ai.js");

let fails = 0;
function check(name, cond, detail) {
  if (cond) console.log("PASS " + name);
  else { fails++; console.log("FAIL " + name + (detail ? "  -> " + detail : "")); }
}

const puzzle = {
  surface: "一个男人走进餐厅，点了一碗海龟汤，喝完之后走出门自杀了。为什么？",
  truth: "男人曾是海难幸存者，当时同伴给他喝的是用死去同伴肉做的汤骗他是海龟汤；他尝出味道不对，明白真相后崩溃自杀。",
  truthKeywords: ["海难", "人肉", "骗"],
  clues: [
    { type: "yes", text: "男人以前也喝过一次海龟汤" },
    { type: "no", text: "餐厅的汤有问题" }
  ]
};

/* 1. 系统提示词包含复合提问规则 */
const sys = AI.buildSystemPrompt(puzzle);
check("sys rule12 compound", sys.indexOf("12.") !== -1 && sys.indexOf("玩家一次连着问了好几个小问题") !== -1);
check("sys rule2 relaxed", sys.indexOf("两小句") !== -1 && sys.indexOf("45 个字") !== -1);

/* 2. buildAskUser 对复合提问加提醒 */
const compound = "男人是正常男人吗，比如身高体重之类的是否是正常成年男人的范畴？";
const usr = AI.buildAskUser(puzzle, compound, { history: [] });
check("ask hint multi", usr.indexOf("含好几个小问题") !== -1);
const simple = "男人是自愿死的吗？";
check("ask hint single", AI.buildAskUser(puzzle, simple, { history: [] }).indexOf("含好几个小问题") === -1);

/* 3. guardAnswer：复述型空答打回 */
const meta = AI.guardAnswer(puzzle, { verdict: "partial", reply: "玩家问男人是否正常身高体重，是否正常成年男人范畴", clue: 0 });
check("meta-echo rejected", meta.ok === false && meta.reason === "meta-echo", JSON.stringify(meta));

/* 4. guardAnswer：合法的复合短答放行 */
const good = AI.guardAnswer(puzzle, { verdict: "partial", reply: "部分正确。人是正常成年男人，体重却偏轻。", clue: 0 });
check("compound answer passes", good.ok === true, JSON.stringify(good));

/* 5. guardAnswer：三句短答放行、四句打回 */
const three = AI.guardAnswer(puzzle, { verdict: "yes", reply: "是。身高正常。体重也正常。", clue: 0 });
check("three clauses pass", three.ok === true, JSON.stringify(three));
const four = AI.guardAnswer(puzzle, { verdict: "yes", reply: "是。身高正常。体重正常。体格也正常。", clue: 0 });
check("four clauses reject", four.ok === false && four.reason === "reason-dump", JSON.stringify(four));

/* 6. 剧透与思考链过滤仍然有效（剧透检测抓的是 ≥12 字连续原文重叠） */
const spoil = AI.guardAnswer(puzzle, { verdict: "yes", reply: "是。当时同伴给他喝的是用死去同伴肉做的汤。", clue: 0 });
check("spoiler still rejected", spoil.ok === false && spoil.reason === "spoiler-truth", JSON.stringify(spoil));
const think = AI.guardAnswer(puzzle, { verdict: "yes", reply: "根据汤底来看，是的。", clue: 0 });
check("reason tail still rejected", think.ok === false, JSON.stringify(think));

/* 7. 线索认领口径不变 */
const clueOk = AI.guardAnswer(puzzle, { verdict: "yes", reply: "是。他以前确实喝过一次。", clue: 1 });
check("clue claim ok", clueOk.ok === true && clueOk.clue === 1, JSON.stringify(clueOk));

console.log(fails ? ("FAILED " + fails) : "ALL PASS");
process.exit(fails ? 1 : 0);
