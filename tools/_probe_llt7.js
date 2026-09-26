/* late-late.jp 榜单页本地解剖 v2（Phase 2 · 只读本地 HTML，零请求）
 * 目的：/ranking（月度 Good 榜）里题目 id 藏在哪？rank-item / rank-mondai 块结构。
 * 用法：node tools/_probe_llt7.js
 * 产出：tools/llt_probe7_report.txt
 * ------------------------------------------------------------ */
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const L = [];
const say = (s) => L.push(String(s));

const unesc = (s) =>
  s.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ")
   .replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, "&")
   .replace(/[ \t\u00a0]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

const f = path.join(ROOT, "tools", "llt_ranking.html");
const html = fs.readFileSync(f, "utf8");

say("### llt_ranking.html len=" + html.length);

// 1) rank-item 块逐个抽
const blocks = [];
let idx = 0;
const key = 'class="rank-item';
while ((idx = html.indexOf(key, idx)) !== -1) {
  blocks.push(html.slice(idx, idx + 1400));
  idx += key.length;
}
say("rank-item 块数: " + blocks.length);
blocks.slice(0, 3).forEach((b, i) => {
  say(`\n--- rank-item #${i + 1} 原文 ---`);
  say(b.slice(0, 1000));
  say(`--- #${i + 1} 文本 ---`);
  say(unesc(b).slice(0, 400));
});

// 2) 所有含数字的 href（找题目 id 线索）
const allHref = [...new Set((html.match(/href=["']([^"']+)["']/g) || []).map((x) => x.slice(6, -1)))];
say("\n### 全部 href（含数字）:");
allHref.filter((h) => /\d{3,}/.test(h)).slice(0, 60).forEach((h) => say("   " + h));

// 3) data-* 属性里的 id
const dataAttrs = [...new Set((html.match(/data-[a-z-]+=["'][^"']*["']/g) || []))];
say("\n### data-* 属性（含数字）:");
dataAttrs.filter((d) => /\d{3,}/.test(d)).slice(0, 40).forEach((d) => say("   " + d));

// 4) onclick / js 跳转
const onclicks = [...new Set((html.match(/onclick=["'][^"']*["']/g) || []))].filter((d) => /\d{3,}/.test(d));
say("\n### onclick（含数字）:");
onclicks.slice(0, 20).forEach((d) => say("   " + d));

// 5) 站内 id 数字直搜：形如 217xx 的 5 位数字
const nums5 = [...new Set((html.match(/\b2\d{4}\b/g) || []))];
say("\n### 5 位数字（2xxxx）出现: " + nums5.length + " 个");
say("   " + nums5.slice(0, 60).join(", "));

fs.writeFileSync(path.join(ROOT, "tools", "llt_probe7_report.txt"), L.join("\n"), "utf8");
console.log("report -> tools/llt_probe7_report.txt | rank-item blocks:", blocks.length, "| 5-digit nums:", nums5.length);
