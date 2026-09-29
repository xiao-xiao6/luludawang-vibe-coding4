/* late-late.jp 候选池枚举 v3（第三轮 · 好评降序继续往后翻页）
 * ------------------------------------------------------------
 * 合规：站方 robots → User-agent:* Crawl-delay: 5，Allow: /
 *       串行、间隔 6.5s；只打列表页，不打详情页。
 * 排除：库里已收录的 srcNo + 前两轮候选池已枚举过的 id（避免重复抓取）。
 * 用法：node tools/pool_llt3.js --start 49 --pages 140
 * 产出：tools/llt_pool3.json
 * ------------------------------------------------------------ */
const https = require("https");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "tools", "llt_pool3.json");
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

function load(path_) { return fs.existsSync(path_) ? JSON.parse(fs.readFileSync(path_, "utf8")) : null; }

(async () => {
  const ai = process.argv.indexOf("--start");
  const START = ai > -1 ? parseInt(process.argv[ai + 1], 10) : 49;
  const pi = process.argv.indexOf("--pages");
  const PAGES = pi > -1 ? parseInt(process.argv[pi + 1], 10) : 140;

  // 排除集由 tools/llt3_have.json 提供：库里已收录的 late-late srcNo + 前两轮池全部 id
  const excl = new Set(load(path.join(ROOT, "tools", "llt3_have.json")).map(String));

  let pool = load(OUT) || { ids: [], pages: START - 1, perPage: [] };
  const have = new Set(pool.ids.map(String));
  console.log(`排除集 ${excl.size} | 起点 page ${Math.max(START, pool.pages + 1)} → ${PAGES}`);

  for (let p = Math.max(START, pool.pages + 1); p <= PAGES; p++) {
    const url = `https://late-late.jp/mondai/solved/sort:good/direction:desc/page:${p}`;
    let r = await get(url);
    for (let t = 0; r.code !== 200 && t < 3; t++) { await sleep(9000); r = await get(url); }
    if (r.code !== 200) { console.log(`page ${p} -> ${r.code}，停止`); break; }
    const found = [...new Set((r.buf.toString("utf8").match(/\/mondai\/show\/(\d+)/g) || []).map((x) => +x.split("/").pop()))];
    const fresh = found.filter((x) => !excl.has(String(x)) && !have.has(String(x)));
    pool.ids.push(...fresh);
    pool.pages = p;
    pool.perPage.push({ p, seen: found.length, fresh: fresh.length });
    fresh.forEach((x) => have.add(String(x)));
    fs.writeFileSync(OUT, JSON.stringify(pool), "utf8");
    console.log(`page ${p}: 页内 ${found.length}，新增 ${fresh.length}，池累计 ${pool.ids.length}`);
    if (!found.length) break;
    await sleep(DELAY_MS);
  }
  console.log(`\n候选池 v3 总计 ${pool.ids.length} 题（翻到 page ${pool.pages}）`);
})();
