/* 库层数据结构体检：node tools/inspect_library.js */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ROOT = path.resolve(__dirname, "..");
const sandbox = { console, Math, JSON, module: { exports: {} } };
sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.self = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, "js", "library.data.js"), "utf8"), sandbox, { filename: "library.data.js" });

const lib = sandbox.SOUP_LIBRARY || [];
console.log("库层题数 =", lib.length);
const p = lib[0];
console.log("字段 =", Object.keys(p).join(", "));
let withTruth = 0, withClues = 0, bytes = 0;
lib.forEach((x) => {
  if (x.truth) withTruth++;
  if (x.clues && x.clues.length) withClues++;
});
bytes = JSON.stringify(lib).length;
console.log("有汤底 =", withTruth, " 有线索 =", withClues);
console.log("纯 JSON 体积 =", (bytes / 1024 / 1024).toFixed(2), "MB");
console.log("样例 =", JSON.stringify({
  id: p.id, dispTitle: p.dispTitle, surfaceLen: (p.surface || "").length,
  mode: p.mode, lang: p.lang, src: p.src, difficulty: p.difficulty,
  cats: p.cats, hasTruth: !!p.truth, truthLen: (p.truth || "").length
}));
