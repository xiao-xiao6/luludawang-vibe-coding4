/* late-late.jp 采集器（Phase 2 · 日文源）
 * ------------------------------------------------------------
 * 合规依据（2026-09-26 实读 tools/llt_robots.txt）：
 *   User-agent: * → Crawl-delay: 5 → Allow: /
 *   站方只拒「SEO 外链爬虫」与「AI 学習用の大量収集」；
 *   限速小批取汤落在允许区间。硬约束：请求间隔 >= 5s（本脚本用 6.5s）。
 * 策略（不盲扫 2 万页）：
 *   A) 质量池枚举：站方社区标签页 /tag/tag/<tag>/page:N
 *      首选 tag = 20ブクマ（20+ 收藏）、10ブクマ（10+ 收藏）
 *   B) 逐题取详情：/mondai/show/<id>，解析内嵌 JSON-LD（QAPage）
 *      → title / surface(Question.text) / truth(acceptedAnswer.text)
 *        / author / dateCreated  + ブクマ数 + 标签
 * 纪律：无 acceptedAnswer 的题（未解决/无汤底）一律丢弃，不 AI 补底。
 * 断点续传：tools/llt_dump.json
 * 用法：node tools/fetch_llt.js [--limit N] [--pool-only]
 * ------------------------------------------------------------ */
const https = require("https");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "tools", "llt_dump.json");
const POOL = path.join(ROOT, "tools", "llt_pool.json");
const DELAY_MS = 6500; // >= 站方 Crawl-delay: 5
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

const QUALITY_TAGS = ["20ブクマ", "10ブクマ"];
const MAX_TAG_PAGES = 12;

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const unesc = (s) =>
  (s || "")
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
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/* ---------- A. 质量池枚举 ---------- */
async function discoverPool(tagName) {
  const ids = [];
  const perPage = [];
  for (let p = 1; p <= MAX_TAG_PAGES; p++) {
    const url =
      `https://late-late.jp/tag/tag/${encodeURIComponent(tagName)}` + (p > 1 ? `/page:${p}` : "");
    const r = await get(url);
    if (r.code !== 200) break;
    const found = [
      ...new Set((r.buf.toString("utf8").match(/\/mondai\/show\/(\d+)/g) || []).map((x) => +x.split("/").pop())),
    ];
    perPage.push(found.length);
    if (!found.length) break;
    ids.push(...found);
    await sleep(DELAY_MS);
  }
  return { ids: [...new Set(ids)], perPage };
}

/* ---------- B. 单题解析（JSON-LD） ---------- */
function parseDetail(html, id) {
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!m) return { id, err: "no-ldjson" };
  let j;
  try {
    j = JSON.parse(m[1]);
  } catch (e) {
    return { id, err: "ldjson-parse" };
  }
  const q = j && j.mainEntity;
  if (!q) return { id, err: "no-mainEntity" };

  const title = (q.name || "").trim();
  const surface = unesc(String(q.text || "").replace(/\\n/g, "\n"));
  const ans = q.acceptedAnswer && q.acceptedAnswer.text;
  const truth = ans ? unesc(String(ans).replace(/\\n/g, "\n")) : "";
  const author = (q.author && q.author.name) || "";
  const dateCreated = j.dateCreated || q.dateCreated || "";

  // ブクマ数（react-head: 「ブクマ 22」）
  const bm = html.match(/ブクマ[\s\S]{0,40}?>(\d+)</) || html.match(/ブクマ\s*(\d+)/);
  const bookmarks = bm ? parseInt(bm[1], 10) : null;

  // 题目自带标签
  const tags = [...new Set((html.match(/<div class='tag'>([^<]+)<\/div>/g) || []).map((x) => unesc(x.replace(/<[^>]+>/g, ""))))];

  return { id, title, surface, truth, author, dateCreated, bookmarks, tags };
}

(async () => {
  const li = process.argv.indexOf("--limit");
  const LIMIT = li > -1 ? parseInt(process.argv[li + 1], 10) : 0;
  const POOL_ONLY = process.argv.includes("--pool-only");

  /* A. 池 */
  let pool = { tags: {}, ids: [] };
  if (fs.existsSync(POOL)) pool = JSON.parse(fs.readFileSync(POOL, "utf8"));
  for (const t of QUALITY_TAGS) {
    if (pool.tags[t] && pool.tags[t].done) continue;
    console.log(`[pool] 枚举标签 ${t} ...`);
    const r = await discoverPool(t);
    pool.tags[t] = { done: true, count: r.ids.length, perPage: r.perPage };
    pool.ids = [...new Set([...(pool.ids || []), ...r.ids])];
    fs.writeFileSync(POOL, JSON.stringify(pool, null, 0), "utf8");
    console.log(`[pool] ${t}: ${r.ids.length} 题 (每页 ${r.perPage.join("/")}) | 池累计 ${pool.ids.length}`);
    await sleep(DELAY_MS);
  }
  console.log(`[pool] 候选池总计 ${pool.ids.length} 题`);
  if (POOL_ONLY) return;

  /* B. 逐题取 */
  const cache = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : { items: [], failed: [] };
  const doneIds = new Set(cache.items.map((x) => x.id));
  let todo = pool.ids.filter((i) => !doneIds.has(i));
  if (LIMIT) todo = todo.slice(0, LIMIT);
  console.log(`[fetch] 已完成 ${doneIds.size} | 本轮待抓 ${todo.length}`);

  for (const id of todo) {
    const url = `https://late-late.jp/mondai/show/${id}`;
    const r = await get(url);
    if (r.code !== 200) {
      cache.failed.push({ id, code: r.code });
      console.log(`  x #${id} -> ${r.code}`);
    } else {
      const p = parseDetail(r.buf.toString("utf8"), id);
      if (p.err) {
        cache.failed.push({ id, code: p.err });
        console.log(`  x #${id} -> ${p.err}`);
      } else if (!p.surface || !p.truth) {
        // 无汤底 = 违反纪律，丢弃（不补底）
        cache.failed.push({ id, code: p.surface ? "NO_TRUTH" : "NO_SURFACE" });
        console.log(`  x #${id} -> ${p.surface ? "NO_TRUTH" : "NO_SURFACE"} (丢弃)`);
      } else {
        p.url = url;
        p.src = "late-late.jp";
        cache.items.push(p);
        console.log(
          `  v #${id} S:${p.surface.length} T:${p.truth.length} bm:${p.bookmarks} tags:${p.tags.length} author:${p.author ? "y" : "n"}`
        );
      }
    }
    fs.writeFileSync(OUT, JSON.stringify(cache, null, 0), "utf8");
    await sleep(DELAY_MS);
  }
  console.log(`\n完成：成功 ${cache.items.length} / 失败 ${cache.failed.length}`);
})();
