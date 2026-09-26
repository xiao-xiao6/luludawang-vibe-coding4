/* late-late.jp 样题结构探测（Phase 2 前置 · 只读，1 个请求）
 * 目的：抓 1 页详情页，落盘 HTML + 打印可用字段（题面/汤底/标题/作者/收藏数）。
 * 用法：node tools/_probe_llt3.js [id]
 * 产出：tools/llt_sample_<id>.html
 * ------------------------------------------------------------ */
const https = require("https");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const ID = process.argv[2] || "1";
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

const unesc = (s) =>
  s.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ")
   .replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
   .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
   .replace(/[ \t\u00a0]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

(async () => {
  const url = `https://late-late.jp/mondai/show/${ID}`;
  const r = await get(url);
  const html = r.buf.toString("utf8");
  const out = path.join(ROOT, "tools", `llt_sample_${ID}.html`);
  fs.writeFileSync(out, html, "utf8");
  console.log("GET", url, "->", r.code, r.buf.length, "bytes ->", path.basename(out));

  // 打印所有 class 名（去重、限 120 个），找容器
  const classes = [...new Set((html.match(/class="([^"]+)"/g) || []).map((x) => x.slice(7, -1)))];
  console.log("--- class 名 (共 " + classes.length + ") ---");
  classes.slice(0, 120).forEach((c) => console.log("  " + c));

  // 关键 meta
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  console.log("--- title ---", t ? unesc(t[1]) : "(none)");
  const desc = html.match(/<meta\s+name="description"\s+content="([^"]*)"/i);
  console.log("--- meta desc ---", desc ? desc[1] : "(none)");

  // 找可能的问题/解答区块
  for (const kw of ["problem", "mondai", "question", "answer", "solution", "kaitou", "truth", "story", "nazo"]) {
    const n = (html.match(new RegExp(kw, "gi")) || []).length;
    if (n) console.log(`   kw "${kw}" 出现 ${n} 次`);
  }
})();
