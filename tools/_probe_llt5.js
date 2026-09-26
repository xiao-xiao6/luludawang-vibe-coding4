/* late-late.jp 入口/榜单探测（Phase 2 前置 · 只读，2 个请求）
 * 目的：找「低请求量就能拿到高质量候选 id」的入口页。
 *       /ranking 榜单顺序 = 社区质量顺序，比盲抓 id 1..N 高效得多。
 * 礼貌：本脚本只发 2 个请求（遵守站方 Crawl-delay: 5 → 用 6s 间隔）。
 * 用法：node tools/_probe_llt5.js
 * 产出：tools/llt_ranking.html / tools/llt_solved.html / tools/llt_probe5_report.txt
 * ------------------------------------------------------------ */
const https = require("https");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

function get(u, depth = 0) {
  return new Promise((resolve) => {
    const req = https.get(u, { headers: { "User-Agent": UA, "Accept-Language": "ja;q=0.9" } }, (s) => {
      if (s.statusCode >= 300 && s.statusCode < 400 && s.headers.location && depth < 4) {
        s.resume();
        return resolve(get(new URL(s.headers.location, u).href, depth + 1));
      }
      const chunks = [];
      s.on("data", (c) => chunks.push(c));
      s.on("end", () => resolve({ code: s.statusCode, buf: Buffer.concat(chunks) }));
    });
    req.on("error", (e) => resolve({ code: "ERR", buf: Buffer.from("ERR " + e.message) }));
    req.setTimeout(30000, () => { req.destroy(); resolve({ code: "TIMEOUT", buf: Buffer.alloc(0) }); });
  });
}

const L = [];
const say = (s) => L.push(String(s));

(async () => {
  const targets = [
    ["ranking", "https://late-late.jp/ranking"],
    ["solved", "https://late-late.jp/mondai/solved"],
  ];

  for (let i = 0; i < targets.length; i++) {
    const [tag, url] = targets[i];
    const r = await get(url);
    const html = r.buf.toString("utf8");
    fs.writeFileSync(path.join(ROOT, "tools", `llt_${tag}.html`), html, "utf8");

    const ids = [...new Set((html.match(/\/mondai\/show\/(\d+)/g) || []).map((x) => +x.split("/").pop()))];
    say(`=== /${tag} -> ${r.code} len=${r.buf.length} | 唯一题目 id: ${ids.length} | 文件 tools/llt_${tag}.html`);
    say(`   前 40 个 id: ${ids.slice(0, 40).join(", ")}`);
    say(`   id 范围: ${ids.length ? Math.min(...ids) + " ~ " + Math.max(...ids) : "(none)"}`);

    // 找分页线索
    const pages = [...new Set((html.match(/page[=:/](\d+)/g) || []))].slice(0, 10);
    say(`   分页线索: ${pages.join(" ") || "(none)"}`);
    const links = [...new Set((html.match(/href="([^"]*(?:ranking|mondai|tag)[^"]*)"/g) || []).map((x) => x.slice(6, -1)))].slice(0, 30);
    say(`   相关链接: ${links.join(" | ")}`);
    say("");
    if (i < targets.length - 1) await new Promise((res) => setTimeout(res, 6000));
  }

  fs.writeFileSync(path.join(ROOT, "tools", "llt_probe5_report.txt"), L.join("\n"), "utf8");
  console.log("report -> tools/llt_probe5_report.txt");
})();
