/* 前端 id 接线自检：node tools/check_ids.js */
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");

const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const htmlIds = new Set();
let m;
const reId = /id="([^"]+)"/g;
while ((m = reId.exec(html))) htmlIds.add(m[1]);

const files = ["js/app.js", "js/room-ui.js"];
let missing = [];
let checked = 0;
files.forEach((f) => {
  const src = fs.readFileSync(path.join(ROOT, f), "utf8");
  const re = /(?:\$\(\s*"#|getElementById\(\s*")([A-Za-z0-9_-]+)/g;
  let k;
  while ((k = re.exec(src))) {
    checked++;
    if (!htmlIds.has(k[1])) missing.push(f + " → #" + k[1]);
  }
});

console.log("HTML 里定义的 id：" + htmlIds.size);
console.log("JS 里引用的 id 次数：" + checked);
console.log("引用但 HTML 里不存在的 id：" + (missing.length ? "\n  " + missing.join("\n  ") : "（无）"));

/* 反向：HTML 有、但没人用的房间 id（仅提示，不报错） */
const roomIds = [...htmlIds].filter((x) => x.indexOf("room-") === 0 || x === "screen-room");
const jsAll = files.map((f) => fs.readFileSync(path.join(ROOT, f), "utf8")).join("\n");
const unused = roomIds.filter((x) => jsAll.indexOf(x) === -1);
console.log("HTML 里定义但 JS 未用的房间 id：" + (unused.length ? unused.join(", ") : "（无）"));
