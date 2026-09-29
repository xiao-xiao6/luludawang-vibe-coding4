/* late-late.jp 采集器 v3（第三轮 · 目标 458 道入库，多抓防损）
 * ------------------------------------------------------------
 * 合规（tools/llt_robots.txt）：User-agent:* → Crawl-delay: 5，Allow: /
 *   硬约束：串行、每页间隔 >= 6.5s，失败退避重试；只取列表页与详情页，不做全站盲扫。
 * 纪律：无解説（未解决/无汤底）的题一律丢弃，不 AI 补底。
 * 正文取页面内嵌 <text_content> / <text_kaisetu>（完整正文，不受 JSON-LD 5000 字截断）。
 * 用法：node tools/fetch_llt3.js [--target 560]
 * 产出：tools/llt_dump3.json（断点续传）
 * ------------------------------------------------------------ */
const https = require("https");
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const POOL = path.join(ROOT, "tools", "llt_pool3.json");
const OUT = path.join(ROOT, "tools", "llt_dump3.json");
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
        } catch (e) { /* 解压失败按原文处理 */ }
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

/* 兜底：站方部分页面不再内嵌 <text_*>，改为只在 <script type="application/ld+json"> 的
 * QAPage.mainEntity 里给正文。取得到就用，但站方这份预览有约 5000 字的硬截断，
 * 因此长度落在截断区间的一律判为不完整直接丢弃（沿用「宁可少收也不收残汤」的纪律）。 */
function jsonld(html) {
  const out = { title: "", surface: "", truth: "", author: "", dateCreated: "", ok: false, truncated: false };
  const blocks = html.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g) || [];
  for (const b of blocks) {
    let obj;
    try { obj = JSON.parse(b.replace(/^<script[^>]*>/, "").replace(/<\/script>$/, "")); } catch (e) { continue; }
    for (const o of (Array.isArray(obj) ? obj : [obj]).flatMap((x) =>
      x && x.mainEntity ? [x].concat(Array.isArray(x.mainEntity) ? x.mainEntity : [x.mainEntity]) : [x])) {
      if (!o || (o["@type"] !== "Question" && o["@type"] !== "DiscussionTopic")) continue;
      const acc = o.acceptedAnswer || (Array.isArray(o.acceptedAnswer) ? o.acceptedAnswer[0] : null);
      out.title = clean(o.name || "");
      out.surface = clean(o.text || "");
      out.truth = clean((acc && acc.text) || "");
      out.author = clean((o.author && o.author.name) || "");
      out.dateCreated = clean(o.dateCreated || "");
      out.ok = !!out.surface && !!out.truth;
      out.truncated = [out.surface, out.truth].some((t) => t.length >= 4700 && t.length <= 5300);
      if (out.ok) return out;
    }
  }
  return out;
}

function parse(html, id) {
  let title = clean(pick(html, "text_title")).replace(/^【BS】/, "").trim();
  let surface = clean(pick(html, "text_content"));
  let truth = clean(pick(html, "text_kaisetu"));
  let via = "text_";
  if (!surface || !truth) {
    const j = jsonld(html);
    if (j.ok && !j.truncated) {
      surface = surface || j.surface; truth = truth || j.truth;
      title = title || j.title; via = "ld+json";
    } else if (j.truncated) {
      return { _drop: "LD_TRUNC" };
    }
  }
  return {
    id, title: title || jsonld(html).title,
    surface, truth, _via: via,
    author: clean(pick(html, "text_name")) || jsonld(html).author,
    dateCreated: clean(pick(html, "text_created")) || jsonld(html).dateCreated,
    bookmarks: (() => { const bm = html.match(/ブクマ[\s\S]{0,40}?>(\d+)</) || html.match(/ブクマ\s*(\d+)/); return bm ? parseInt(bm[1], 10) : null; })(),
    good: ((g) => (g ? +g : null))((html.match(/良質[\s\S]{0,40}?>(\d+)</) || [])[1]),
    tags: [...new Set((html.match(/<div class='tag'>([^<]+)<\/div>/g) || []).map((x) => clean(x.replace(/<[^>]+>/g, ""))))],
  };
}

(async () => {
  const ti = process.argv.indexOf("--target");
  const TARGET = ti > -1 ? parseInt(process.argv[ti + 1], 10) : 560;
  const pool = JSON.parse(fs.readFileSync(POOL, "utf8")).ids;
  const cache = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : { items: [], failed: [] };
  const done = new Set(cache.items.map((x) => x.id).concat(cache.failed.map((x) => x.id)));
  const todo = pool.filter((i) => !done.has(i));
  console.log(`池 ${pool.length} | 已完成 ${done.size} | 待抓 ${todo.length} | 目标落地 ${TARGET}`);

  for (const id of todo) {
    if (cache.items.length >= TARGET) { console.log(`已达目标 ${TARGET} 题，收工`); break; }
    let r = await get(`https://late-late.jp/mondai/show/${id}`);
    for (let t = 0; r.code !== 200 && t < 2; t++) { await sleep(12000); r = await get(`https://late-late.jp/mondai/show/${id}`); }
    if (r.code !== 200) {
      cache.failed.push({ id, code: String(r.code) });
      console.log(`  ✗ #${id} ${r.code}`);
    } else {
      const p = parse(r.buf.toString("utf8"), id);
      if (p._drop === "LD_TRUNC") {
        cache.failed.push({ id, code: "LD_TRUNC" });
        console.log(`  ✗ #${id} 仅有 JSON-LD 且疑似被站方截断 → 丢弃`);
      } else if (!p.surface || !p.truth) {
        cache.failed.push({ id, code: "NO_KAISETU" });
        console.log(`  ✗ #${id} 无解説/无汤底 → 丢弃`);
      } else {
        p.url = `https://late-late.jp/mondai/show/${id}`;
        p.src = "late-late.jp";
        cache.items.push(p);
        console.log(`  ✓ #${id} ${p.title.slice(0, 22)} | S:${p.surface.length} T:${p.truth.length} ブクマ:${p.bookmarks} [${p._via}]`);
      }
    }
    fs.writeFileSync(OUT, JSON.stringify(cache), "utf8");
    await sleep(DELAY_MS);
  }
  console.log(`\n完成：成功 ${cache.items.length} / 失败 ${cache.failed.length}`);
})();
