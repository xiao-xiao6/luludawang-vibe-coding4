/* 一次性校验脚本：扫出 JS 里引用的 DOM id，与 index.html 实际 id 对账 */
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");

const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const htmlIds = new Set();
html.replace(/\bid="([^"]+)"/g, (m, id) => { htmlIds.add(id); return m; });

/* 动态生成的 id（JS 里 createElement + innerHTML 注入的），单独收集 */
const files = ["js/room-ui.js", "js/app.js", "js/net.js"];
const refs = new Map(); // id -> [files]
for (const f of files) {
  const src = fs.readFileSync(path.join(root, f), "utf8");
  /* 只抓静态选择器：$("#x") / getElementById("x") / querySelector("#x") / $$(".x") */
  const re = /(?:getElementById\(|\$\(|querySelector\()\s*["']#([A-Za-z0-9_-]+)["']/g;
  let m;
  while ((m = re.exec(src))) {
    const id = m[1];
    if (!refs.has(id)) refs.set(id, []);
    if (!refs.get(id).includes(f)) refs.get(id).push(f);
  }
  /* 局部生成后再 querySelector 的：同一文件里有 id="x" 的模板串就算存在 */
}

/* 收集 JS 模板里内联生成的 id */
const generated = new Set();
for (const f of files) {
  const src = fs.readFileSync(path.join(root, f), "utf8");
  src.replace(/id="([A-Za-z0-9_-]+)"/g, (m, id) => { generated.add(id); return m; });
}

const missing = [];
for (const [id, srcs] of refs) {
  if (!htmlIds.has(id) && !generated.has(id)) missing.push(id + "  ← " + srcs.join(", "));
}

console.log("HTML 内 id 总数:", htmlIds.size);
console.log("被 JS 静态引用的 id 数:", refs.size);
console.log("JS 内联生成的 id 数:", generated.size);
console.log("");
console.log(missing.length ? "❌ 悬空引用（HTML 和 JS 模板里都找不到）:\n" + missing.join("\n") : "✅ 没有悬空引用");
