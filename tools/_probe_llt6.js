/* late-late.jp 入口页本地解剖（Phase 2 · 只读本地 HTML，零请求）
 * 目的：1) /ranking 为什么抓不到 id？2) /solved 列表页是否自带收藏/评分 → 能否免翻详情页预筛
 * 用法：node tools/_probe_llt6.js
 * 产出：tools/llt_probe6_report.txt
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

for (const tag of ["ranking", "solved"]) {
  const f = path.join(ROOT, "tools", `llt_${tag}.html`);
  if (!fs.existsSync(f)) { say(`(缺文件 ${tag})`); continue; }
  const html = fs.readFileSync(f, "utf8");
  say("=".repeat(72));
  say(`### ${tag}.html  len=${html.length}`);
  say(`  /mondai/show/N 命中: ${(html.match(/\/mondai\/show\/\d+/g) || []).length}`);
  say(`  "mondai" 命中: ${(html.split("mondai").length - 1)}`);
  say(`  排名/榜单关键词: ランキング=${html.split("ランキング").length - 1} ランキング一覧=${html.split("ランキング一覧").length - 1}`);
  say(`  收藏关键词: ブクマ=${html.split("ブクマ").length - 1} お気に入り=${html.split("お気に入り").length - 1}`);

  // 所有 href 形态去重
  const hrefs = [...new Set((html.match(/href='([^']+)'|href="([^"]+)"/g) || [])
    .map((x) => x.replace(/^href=['"]/, "").replace(/['"]$/, ""))
    .filter((h) => h.includes("mondai") || h.includes("ranking") || h.includes("tag")))];
  say(`  相关 href 去重后 ${hrefs.length} 条:`);
  hrefs.slice(0, 40).forEach((h) => say("     " + h));

  // 找题目条目容器的 class
  const classes = [...new Set((html.match(/class=[\'"]([^\'"]+)[\'"]/g) || [])
    .map((x) => x.replace(/^class=[\'"]/, "").replace(/[\'"]$/, "")))];
  const cand = classes.filter((c) => /(item|list|mondai|card|entry|rank|problem|title)/i.test(c));
  say(`  疑似条目 class: ${cand.slice(0, 30).join(" | ") || "(none)"}`);

  // 打印第一个疑似列表容器附近文本
  for (const key of ["ranking", "mondai/list", "mondaiListItem", "rank-", "mondai__"]) {
    const at = html.indexOf(key);
    if (at > -1) {
      say(`  --- 上下文 "${key}" @${at} ---`);
      say("     " + unesc(html.slice(Math.max(0, at - 200), at + 1200)).slice(0, 1200));
      break;
    }
  }
  say("");
}

fs.writeFileSync(path.join(ROOT, "tools", "llt_probe6_report.txt"), L.join("\n"), "utf8");
console.log("report -> tools/llt_probe6_report.txt");
