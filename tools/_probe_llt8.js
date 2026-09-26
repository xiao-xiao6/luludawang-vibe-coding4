/* late-late.jp 高质量候选池入口探测（Phase 2 · 只读，3 个请求）
 * 目的：找出「按社区评价排序」的列表页，用最少请求拿到优先采集的 id 池。
 * 候选入口：
 *   1) /mondai/solved/sort:good/direction:desc  ← 按 Good 降序（若存在）
 *   2) /mondai/collections                      ← 站方/用户精选问题集
 *   3) /ranking?type=good                       ← 月度 Good 榜
 * 礼貌：单线程，站方 Crawl-delay: 5 → 用 6s 间隔。
 * 用法：node tools/_probe_llt8.js
 * 产出：tools/llt_sorted.html / llt_collections.html / llt_rank_good.html / llt_probe8_report.txt
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
    ["sorted", "https://late-late.jp/mondai/solved/sort:good/direction:desc"],
    ["collections", "https://late-late.jp/mondai/collections"],
    ["rank_good", "https://late-late.jp/ranking?type=good"],
  ];

  for (let i = 0; i < targets.length; i++) {
    const [tag, url] = targets[i];
    const r = await get(url);
    const html = r.buf.toString("utf8");
    fs.writeFileSync(path.join(ROOT, "tools", `llt_${tag}.html`), html, "utf8");

    const show = [...new Set((html.match(/\/mondai\/show\/(\d+)/g) || []).map((x) => +x.split("/").pop()))];
    const good = [...new Set((html.match(/\/mondai\/good_comment\/(\d+)/g) || []).map((x) => +x.split("/").pop()))];
    const coll = [...new Set((html.match(/\/mondai\/collections\/[^"'\s]+/g) || []))];
    const pages = [...new Set((html.match(/page:(\d+)/g) || []))].slice(0, 6);

    say(`=== ${tag} ${url}`);
    say(`    code=${r.code} len=${r.buf.length}`);
    say(`    show ids: ${show.length} | good_comment ids: ${good.length} | collections: ${coll.length}`);
    say(`    ids: ${(show.length ? show : good).slice(0, 40).join(", ")}`);
    say(`    page 线索: ${pages.join(" ") || "(none)"}`);
    say(`    collections 样本: ${coll.slice(0, 12).join(" | ") || "(none)"}`);
    say("");

    if (i < targets.length - 1) await new Promise((res) => setTimeout(res, 6000));
  }

  fs.writeFileSync(path.join(ROOT, "tools", "llt_probe8_report.txt"), L.join("\n"), "utf8");
  console.log("done -> tools/llt_probe8_report.txt");
})();
