/* YesNoGame 采集器（Phase 1 · 英文源）
 * ------------------------------------------------------------
 * 合规：robots.txt 的 User-agent:* 段仅屏蔽 /?*sort、/?*display、/?query，
 *       /en/stories/<id> 详情页不在禁止范围；sitemap 由站方主动提供。
 * 礼貌：串行 + 每页间隔 DELAY_MS，支持断点续传（缓存已抓页面）。
 * 用法：node tools/fetch_yng.js [--limit N]
 * 产出：tools/yng_dump.json（{id,url,title,surface,truth}）
 * ------------------------------------------------------------ */
const https = require("https");
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "tools", "yng_dump.json");
const DELAY_MS = 1200;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

function get(u, opts = {}, depth = 0) {
  return new Promise((resolve) => {
    const req = https.get(
      u,
      { headers: { "User-Agent": UA, "Accept-Language": "en;q=0.9" } },
      (s) => {
        if (s.statusCode >= 300 && s.statusCode < 400 && s.headers.location && depth < 4) {
          s.resume();
          return resolve(get(new URL(s.headers.location, u).href, opts, depth + 1));
        }
        const chunks = [];
        s.on("data", (c) => chunks.push(c));
        s.on("end", () => resolve({ code: s.statusCode, buf: Buffer.concat(chunks) }));
      }
    );
    req.on("error", (e) => resolve({ code: "ERR", buf: Buffer.from(String(e.message)) }));
    req.setTimeout(25000, () => { req.destroy(); resolve({ code: "TIMEOUT", buf: Buffer.alloc(0) }); });
  });
}

const dec = (s) =>
  s.replace(/<br\s*\/?>/gi, "\n")
   .replace(/<[^>]+>/g, " ")
   .replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
   .replace(/&amp;/g, "&").replace(/&mdash;/g, "—").replace(/&ndash;/g, "–")
   .replace(/&laquo;/g, "«").replace(/&raquo;/g, "»").replace(/&hellip;/g, "…")
   .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
   .replace(/[ \t\u00a0]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

/* 用卡片区块做“切片”抽取，避免嵌套 div 正则失配 */
function sliceCard(html, cls) {
  const key = `class="${cls}"`;
  const at = html.indexOf(key);
  if (at < 0) return "";
  const next = html.indexOf('class="quest__card', at + key.length);
  return html.slice(at + key.length, next > 0 ? next : at + 6000);
}

function parsePage(html, id) {
  const front = sliceCard(html, "quest__card__front quest__story quest__story_question");
  const back = sliceCard(html, "quest__card__back quest__story quest__story_answer");
  const t = html.match(/<h1[^>]*class="[^"]*quest__title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i)
         || html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const title = t ? dec(t[1]).replace(/^Situation puzzle\s*/i, "").trim() : "";
  const pull = (block) => {
    const m = block.match(/class="quest__story__text"[^>]*>([\s\S]*?)<\/div>/i);
    return dec(m ? m[1] : block);
  };
  return { id, title, surface: pull(front), truth: pull(back) };
}

(async () => {
  const limitArg = process.argv.indexOf("--limit");
  const LIMIT = limitArg > -1 ? parseInt(process.argv[limitArg + 1], 10) : 0;

  // 1) sitemap → 全量 id
  const sm = await get("https://yesnogame.net/sitemaps/sitemap.xml.gz");
  let xml = "";
  try { xml = zlib.gunzipSync(sm.buf).toString("utf8"); } catch (e) {
    console.error("sitemap 解压失败:", e.message); process.exit(1);
  }
  let ids = [...new Set((xml.match(/\/en\/stories\/(\d+)/g) || []).map((x) => +x.split("/").pop()))].sort((a, b) => a - b);
  if (LIMIT) ids = ids.slice(0, LIMIT);
  console.log("目标题目数:", ids.length);

  // 2) 断点续传
  const cache = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : { items: [], failed: [] };
  const doneIds = new Set(cache.items.map((x) => x.id));
  const todo = ids.filter((i) => !doneIds.has(i));
  console.log("已完成:", doneIds.size, "| 待抓:", todo.length);

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (const id of todo) {
    const r = await get(`https://yesnogame.net/en/stories/${id}`);
    if (r.code !== 200) {
      cache.failed.push({ id, code: r.code });
      console.log(`  ✗ #${id} -> ${r.code}`);
    } else {
      const p = parsePage(r.buf.toString("utf8"), id);
      if (p.surface && p.truth) {
        p.url = `https://yesnogame.net/en/stories/${id}`;
        p.src = "yesnogame.net";
        cache.items.push(p);
        console.log(`  ✓ #${id} ${p.title.slice(0, 40)} | S:${p.surface.length} T:${p.truth.length}`);
      } else {
        cache.failed.push({ id, code: "PARSE_EMPTY" });
        console.log(`  ✗ #${id} 解析为空`);
      }
    }
    fs.writeFileSync(OUT, JSON.stringify(cache, null, 0), "utf8");
    await sleep(DELAY_MS);
  }
  console.log(`\n完成：成功 ${cache.items.length} / 失败 ${cache.failed.length}`);
})();
