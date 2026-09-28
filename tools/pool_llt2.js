/* late-late.jp 候选池枚举 v2（本轮 · 按 Good 好评降序取解决済み）
 * ------------------------------------------------------------
 * 合规：站方 robots → User-agent:* Crawl-delay: 5，Allow: /
 *       串行、间隔 6.5s；只取列表页，不打详情页。
 * 策略：/mondai/solved/sort:good/direction:desc/page:N 逐页取 id（好评优先），
 *       排除 tools/llt_pool.json 已枚举过的 273 个 id。
 * 用法：node tools/pool_llt2.js [--pages N]
 * 产出：tools/llt_pool2.json
 * ------------------------------------------------------------ */
const https = require("https");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "tools", "llt_pool2.json");
const OLD = path.join(ROOT, "tools", "llt_pool.json");
const DELAY_MS = 6500;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

function get(u, depth = 0) {
  return new Promise((resolve) => {
    const req = https.get(u, { headers: { "User-Agent": UA, "Accept-Language": "ja;q=0.9" } }, (s) => {
      if (s.statusCode >= 300 && s.statusCode < 400 && s.headers.location && depth < 4) {
        s.resume();
        return resolve(get(new URL(s.headers.location, u).href, depth + 1));
      }
      const c = [];
      s.on("data", (x) => c.push(x));
      s.on("end", () => resolve({ code: s.statusCode, buf: Buffer.concat(c) }));
    });
    req.on("error", (e) => resolve({ code: "ERR", buf: Buffer.from(String(e.message)) }));
    req.setTimeout(30000, () => { req.destroy(); resolve({ code: "TIMEOUT", buf: Buffer.alloc(0) }); });
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const pi = process.argv.indexOf("--pages");
  const PAGES = pi > -1 ? parseInt(process.argv[pi + 1], 10) : 30;
  const old = fs.existsSync(OLD) ? new Set(JSON.parse(fs.readFileSync(OLD, "utf8")).ids) : new Set();

  let pool = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : { ids: [], pages: 0, perPage: [] };
  const have = new Set(pool.ids);
  for (let p = pool.pages + 1; p <= PAGES; p++) {
    const url = `https://late-late.jp/mondai/solved/sort:good/direction:desc/page:${p}`;
    let r = await get(url);
    for (let tries = 0; r.code !== 200 && tries < 3; tries++) {
      console.log(`  page ${p} 第 ${tries + 1} 次失败(${r.code})，稍后重试`);
      await sleep(9000);
      r = await get(url);
    }
    if (r.code !== 200) { console.log(`page ${p} -> ${r.code}，停止`); break; }
    const found = [...new Set((r.buf.toString("utf8").match(/\/mondai\/show\/(\d+)/g) || []).map((x) => +x.split("/").pop()))];
    const fresh = found.filter((i) => !old.has(i) && !have.has(i));
    pool.ids.push(...fresh);
    pool.pages = p;
    pool.perPage.push({ p, seen: found.length, fresh: fresh.length });
    fresh.forEach((i) => have.add(i));
    console.log(`page ${p}: 页内 ${found.length} 题，新增 ${fresh.length}，池累计 ${pool.ids.length}`);
    fs.writeFileSync(OUT, JSON.stringify(pool, null, 0), "utf8");
    if (!found.length) break;
    await sleep(DELAY_MS);
  }
  console.log(`\n候选池 v2 总计 ${pool.ids.length} 题（已排除旧池 ${old.size}）`);
})();
