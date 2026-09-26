/* late-late.jp 侦察第二步（Phase 2 前置 · 只读）
 * 目的：1) robots.txt 全文落盘 → tools/llt_robots.txt（供人工判红线）
 *       2) sitemap.xml 全文落盘 → tools/llt_sitemap.xml
 *       3) 统计 sitemap 里各路径形态的数量（ASCII 输出，避免控制台编码炸）
 * 礼貌：本脚本只发 2 个请求。
 * 用法：node tools/_probe_llt2.js
 * ------------------------------------------------------------ */
const https = require("https");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

function get(u, depth = 0) {
  return new Promise((resolve) => {
    const req = https.get(
      u,
      { headers: { "User-Agent": UA, "Accept-Language": "ja;q=0.9" } },
      (s) => {
        if (s.statusCode >= 300 && s.statusCode < 400 && s.headers.location && depth < 4) {
          s.resume();
          return resolve(get(new URL(s.headers.location, u).href, depth + 1));
        }
        const chunks = [];
        s.on("data", (c) => chunks.push(c));
        s.on("end", () => resolve({ code: s.statusCode, buf: Buffer.concat(chunks) }));
      }
    );
    req.on("error", (e) => resolve({ code: "ERR", buf: Buffer.from("ERR " + e.message) }));
    req.setTimeout(30000, () => { req.destroy(); resolve({ code: "TIMEOUT", buf: Buffer.alloc(0) }); });
  });
}

(async () => {
  const r1 = await get("https://late-late.jp/robots.txt");
  fs.writeFileSync(path.join(ROOT, "tools", "llt_robots.txt"), r1.buf, "utf8");
  console.log("robots.txt ->", r1.code, r1.buf.length, "bytes -> tools/llt_robots.txt");
  await new Promise((r) => setTimeout(r, 1500));

  const r2 = await get("https://late-late.jp/sitemap.xml");
  fs.writeFileSync(path.join(ROOT, "tools", "llt_sitemap.xml"), r2.buf, "utf8");
  const xml = r2.buf.toString("utf8");
  console.log("sitemap.xml ->", r2.code, r2.buf.length, "bytes");

  const locs = (xml.match(/<loc>([^<]+)<\/loc>/g) || []).map((x) => x.replace(/<\/?loc>/g, ""));
  console.log("loc total:", locs.length);

  // 按路径形态归类（去掉 id 段）
  const shapes = {};
  for (const u of locs) {
    let p = u.replace(/^https?:\/\/late-late\.jp/, "");
    p = p.replace(/\/\d+/g, "/{n}").replace(/\/[a-z0-9_]{6,}/gi, "/{s}");
    shapes[p] = (shapes[p] || 0) + 1;
  }
  const rows = Object.entries(shapes).sort((a, b) => b[1] - a[1]);
  console.log("--- 路径形态 top 30 ---");
  for (const [p, n] of rows.slice(0, 30)) console.log(String(n).padStart(7), p);

  // 疑似题目详情页
  const detail = locs.filter((u) => /\/mondai\/[^/]+\/\d+$/.test(u));
  console.log("--- 疑似题目详情页(/mondai/*/N) ---", detail.length);
  detail.slice(0, 8).forEach((u) => console.log("   ", u));
})();
