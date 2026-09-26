/* late-late.jp 合规侦察（Phase 2 前置 · 只读探测，不入库）
 * 目的：1) 实读 robots.txt 原文（红线不能凭记忆）
 *       2) 找入口页/sitemap/题号规律，判断能否枚举题目
 * 礼貌：每请求间隔 1.5s，单轮只打 4 个 URL，不做翻页、不做全站。
 * 用法：node tools/_probe_llt.js
 * 产出：tools/llt_probe_out.json（各 URL 的 code / len / 前 3000 字符）
 * ------------------------------------------------------------ */
const https = require("https");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "tools", "llt_probe_out.json");
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
        s.on("end", () =>
          resolve({ url: u, finalUrl: u, code: s.statusCode, headers: s.headers, buf: Buffer.concat(chunks) }));
      }
    );
    req.on("error", (e) => resolve({ url: u, code: "ERR", err: String(e.message), buf: Buffer.alloc(0) }));
    req.setTimeout(25000, () => {
      req.destroy();
      resolve({ url: u, code: "TIMEOUT", buf: Buffer.alloc(0) });
    });
  });
}

(async () => {
  const targets = [
    "https://late-late.jp/robots.txt",
    "https://late-late.jp/sitemap.xml",
    "https://late-late.jp/",
  ];
  const out = [];
  for (const t of targets) {
    const r = await get(t);
    const body = r.buf.toString("utf8");
    const rec = {
      url: t,
      code: r.code,
      err: r.err || null,
      len: r.buf.length,
      head: body.slice(0, 3000),
    };
    out.push(rec);
    console.log(`=== ${t} -> ${r.code} len=${r.buf.length} ${r.err ? "ERR:" + r.err : ""}`);
    console.log(rec.head.slice(0, 1800));
    console.log("");
    await new Promise((res) => setTimeout(res, 1500));
  }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2), "utf8");
  console.log("已写入 " + OUT);
})();
