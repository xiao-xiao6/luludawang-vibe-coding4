/* late-late.jp 采集器 v2（本轮 · 新候选池 768 题）
 * ------------------------------------------------------------
 * 合规（2026-09-26 实读 tools/llt_robots.txt）：User-agent:* → Crawl-delay: 5，Allow: /
 *   硬约束：串行、每页间隔 >= 6.5s，失败退避重试；只取列表页与详情页，不做全站盲扫。
 * 纪律：无解説（未解决/无汤底）的题一律丢弃，不 AI 补底。
 * 关键改进：上一轮取 JSON-LD 的 acceptedAnswer，被站方截在 5000 字；
 *   本轮改取页面内嵌的 <text_content> / <text_kaisetu>（完整正文，实测 7000+ 字不截断）。
 * 用法：node tools/fetch_llt2.js [--limit N]
 * 产出：tools/llt_dump2.json（断点续传）
 * ------------------------------------------------------------ */
const https = require("https");
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const POOL = path.join(ROOT, "tools", "llt_pool2.json");
const OUT = path.join(ROOT, "tools", "llt_dump2.json");
const DELAY_MS = 6500;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

function get(u, depth = 0) {
  return new Promise((resolve) => {
    const req = https.get(u, { headers: { "User-Agent": UA, "Accept-Language": "ja;q=0.9", "Accept-Encoding": "gzip, deflate" } }, (s) => {
      if (s.statusCode >= 300 && s.statusCode < 400 && s.headers.location && depth < 4) {
        s.resume();
        return resolve(get(new URL(s.headers.location, u).href, depth + 1));
      }
      const c = [];
      s.on("data", (x) => c.push(x));
      s.on("end", () => {
        const raw = Buffer.concat(c);
        const enc = String(s.headers["content-encoding"] || "").toLowerCase();
        let buf = raw;
        try {
          if (enc === "gzip") buf = zlib.gunzipSync(raw);
          else if (enc === "deflate") buf = zlib.inflateSync(raw);
        } catch (e) { /* 解压失败就按原文处理 */ }
        resolve({ code: s.statusCode, buf });
      });
    });
    req.on("error", (e) => resolve({ code: "ERR", buf: Buffer.from(String(e.message)) }));
    req.setTimeout(30000, () => { req.destroy(); resolve({ code: "TIMEOUT", buf: Buffer.alloc(0) }); });
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const clean = (s) =>
  (s || "")
    .replace(/\\r/g, "")
    .replace(/\\n/g, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

function pick(html, tag) {
  const m = html.match(new RegExp("<" + tag + ">([\\s\\S]*?)</" + tag + ">"));
  return m ? m[1] : "";
}

function parse(html, id) {
  const title = clean(pick(html, "text_title")).replace(/^【BS】/, "").trim();
  const author = clean(pick(html, "text_name"));
  const created = clean(pick(html, "text_created"));
  const surface = clean(pick(html, "text_content"));
  const truth = clean(pick(html, "text_kaisetu"));
  const bm = html.match(/ブクマ[\s\S]{0,40}?>(\d+)</) || html.match(/ブクマ\s*(\d+)/);
  const bookmarks = bm ? parseInt(bm[1], 10) : null;
  const good = (html.match(/良質[\s\S]{0,40}?>(\d+)</) || [])[1];
  const tags = [...new Set((html.match(/<div class='tag'>([^<]+)<\/div>/g) || [])
    .map((x) => clean(x.replace(/<[^>]+>/g, ""))))];
  return { id, title, surface, truth, author, dateCreated: created, bookmarks, good: good ? +good : null, tags };
}

(async () => {
  const li = process.argv.indexOf("--limit");
  const LIMIT = li > -1 ? parseInt(process.argv[li + 1], 10) : 0;
  const ti = process.argv.indexOf("--target");
  const TARGET = ti > -1 ? parseInt(process.argv[ti + 1], 10) : 0; // 落地够数即收工，少给原站添负担
  const pool = JSON.parse(fs.readFileSync(POOL, "utf8")).ids;
  const cache = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : { items: [], failed: [] };
  const done = new Set(cache.items.map((x) => x.id).concat(cache.failed.map((x) => x.id)));
  let todo = pool.filter((i) => !done.has(i));
  if (LIMIT) todo = todo.slice(0, LIMIT);
  console.log(`池 ${pool.length} | 已完成 ${done.size} | 本轮待抓 ${todo.length}`);

  for (const id of todo) {
    if (TARGET && cache.items.length >= TARGET) { console.log(`已达目标 ${TARGET} 题，收工`); break; }
    let r = await get(`https://late-late.jp/mondai/show/${id}`);
    for (let t = 0; r.code !== 200 && t < 2; t++) { await sleep(12000); r = await get(`https://late-late.jp/mondai/show/${id}`); }
    if (r.code !== 200) {
      cache.failed.push({ id, code: String(r.code) });
      console.log(`  ✗ #${id} ${r.code}`);
    } else {
      const p = parse(r.buf.toString("utf8"), id);
      if (!p.surface || !p.truth) {
        cache.failed.push({ id, code: "NO_KAISETU" });
        console.log(`  ✗ #${id} 无解説/无汤底 → 丢弃`);
      } else {
        p.url = `https://late-late.jp/mondai/show/${id}`;
        p.src = "late-late.jp";
        cache.items.push(p);
        console.log(`  ✓ #${id} ${p.title.slice(0, 26)} | S:${p.surface.length} T:${p.truth.length} ブクマ:${p.bookmarks}`);
      }
    }
    fs.writeFileSync(OUT, JSON.stringify(cache, null, 0), "utf8");
    await sleep(DELAY_MS);
  }
  console.log(`\n完成：成功 ${cache.items.length} / 失败 ${cache.failed.length}`);
})();
