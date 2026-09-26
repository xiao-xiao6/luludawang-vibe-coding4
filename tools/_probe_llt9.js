/* late-late.jp 质量标签候选池探测（Phase 2 · 只读，3 个请求）
 * 目的：`20ブクマ`（20 收藏）标签页 = 站方社区沉淀的高质量池。
 *       确认它有多少题、分页规律，能否直接当候选池入口。
 * 礼貌：单线程，站方 Crawl-delay: 5 → 6s 间隔。
 * 用法：node tools/_probe_llt9.js
 * 产出：tools/llt_tag20b.html / llt_tag20b_p2.html / llt_probe9_report.txt
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
  const tag = encodeURIComponent("20ブクマ");
  const targets = [
    ["tag20b", `https://late-late.jp/tag/tag/${tag}`],
    ["tag20b_p2", `https://late-late.jp/tag/tag/${tag}/page:2`],
  ];

  for (let i = 0; i < targets.length; i++) {
    const [name, url] = targets[i];
    const r = await get(url);
    const html = r.buf.toString("utf8");
    fs.writeFileSync(path.join(ROOT, "tools", `llt_${name}.html`), html, "utf8");

    const show = [...new Set((html.match(/\/mondai\/show\/(\d+)/g) || []).map((x) => +x.split("/").pop()))];
    const pages = [...new Set((html.match(/page:(\d+)/g) || []))];
    const totalMatch = html.match(/(\d+)\s*件/);
    say(`=== ${name} ${url}`);
    say(`    code=${r.code} len=${r.buf.length} | show ids: ${show.length}`);
    say(`    ids: ${show.join(", ")}`);
    say(`    page 线索: ${pages.slice(0, 12).join(" ") || "(none)"}`);
    say(`    件数线索: ${totalMatch ? totalMatch[0] : "(none)"}`);
    say("");
    if (i < targets.length - 1) await new Promise((res) => setTimeout(res, 6000));
  }

  fs.writeFileSync(path.join(ROOT, "tools", "llt_probe9_report.txt"), L.join("\n"), "utf8");
  console.log("done -> tools/llt_probe9_report.txt");
})();
