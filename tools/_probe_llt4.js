/* late-late.jp 样题解剖（Phase 2 · 只读本地文件，不发请求）
 * 目的：判断「汤面 / 汤底」是否可直接从 HTML 抽取。
 * 用法：node tools/_probe_llt4.js [id]
 * 产出：tools/llt_sample_<id>_report.txt（UTF-8，用 read_file 看）
 * ------------------------------------------------------------ */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const ID = process.argv[2] || "1";
const html = fs.readFileSync(path.join(ROOT, "tools", `llt_sample_${ID}.html`), "utf8");
const L = [];
const say = (s) => L.push(s);

const unesc = (s) =>
  s.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ")
   .replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
   .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
   .replace(/[ \t\u00a0]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

say("=== 文件: llt_sample_" + ID + ".html, " + html.length + " chars ===");

// 1) 关键字命中
for (const kw of ["耳たぶ", "解答", "解説", "かいとう", "答え", "正解", "かいせつ", "回答"]) {
  const n = (html.split(kw).length - 1);
  say(`kw "${kw}": ${n}`);
}

// 2) 内嵌 JSON 数据？
for (const pat of ["__NEXT_DATA__", "window.__", "application/ld+json", "data-mondai", "data-problem", "data-answer", "items:", '"mondai"']) {
  const n = (html.split(pat).length - 1);
  say(`pat "${pat}": ${n}`);
}

// 3) 上下文：耳たぶ 出现处
say("\n=== 上下文: 耳たぶ ===");
let idx = -1, k = 0;
while ((idx = html.indexOf("耳たぶ", idx + 1)) !== -1 && k < 12) {
  say(`--- @${idx} ---`);
  say(html.slice(Math.max(0, idx - 300), idx + 500).replace(/\s+/g, " "));
  k++;
}

// 4) react-body 区块
for (const cls of ["react-body", "react-head", "related-mondai", "opgauge-box", "hukidasi-box"]) {
  const at = html.indexOf('class="' + cls);
  if (at < 0) { say(`\n=== ${cls}: 未找到 ===`); continue; }
  say(`\n=== ${cls} @${at} ===`);
  say(unesc(html.slice(at, at + 2500)));
}

// 5) <script> 内联长度排行（找数据脚本）
say("\n=== 内联 <script> 体积排行 ===");
const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)]
  .map((m) => ({ attrs: m[1].trim().slice(0, 120), len: m[2].length, head: m[2].replace(/\s+/g, " ").slice(0, 160) }))
  .sort((a, b) => b.len - a.len);
scripts.slice(0, 10).forEach((s) => say(`len=${String(s.len).padStart(7)} | ${s.attrs} | ${s.head}`));

fs.writeFileSync(path.join(ROOT, "tools", `llt_sample_${ID}_report.txt`), L.join("\n"), "utf8");
console.log("report -> tools/llt_sample_" + ID + "_report.txt");
