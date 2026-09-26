/* YesNoGame 合规闸门 + 全量清单探测（只读，不写数据）
   产出：① robots.txt 全文（尤其 User-agent: * 段）② sitemap 全量 story id ③ 详情页抽取锚点 */
const https = require("https");
const zlib = require("zlib");

function fetchBuf(u, depth = 0) {
  return new Promise((resolve) => {
    const req = https.get(
      u,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
          "Accept-Language": "en,ja;q=0.9"
        }
      },
      (s) => {
        if (s.statusCode >= 300 && s.statusCode < 400 && s.headers.location && depth < 4) {
          s.resume();
          return resolve(fetchBuf(new URL(s.headers.location, u).href, depth + 1));
        }
        const chunks = [];
        s.on("data", (c) => chunks.push(c));
        s.on("end", () => resolve({ code: s.statusCode, url: u, buf: Buffer.concat(chunks), headers: s.headers }));
      }
    );
    req.on("error", (e) => resolve({ code: "ERR", url: u, buf: Buffer.from(String(e.message)), headers: {} }));
    req.setTimeout(25000, () => { req.destroy(); resolve({ code: "TIMEOUT", url: u, buf: Buffer.alloc(0), headers: {} }); });
  });
}
const txt = (r) => r.buf.toString("utf8");

(async () => {
  // ---------- 1) robots 全文 ----------
  const rb = await fetchBuf("https://yesnogame.net/robots.txt");
  console.log("========== robots.txt（全文）==========");
  console.log(txt(rb).trim());
  const hasStar = /User-agent:\s*\*/i.test(txt(rb));
  const starBlock = (txt(rb).match(/User-agent:\s*\*[\s\S]*?(?=\nUser-agent:|\s*$)/i) || [""])[0];
  console.log("\n>>> 存在通配段:", hasStar, "| 通配段内容:", JSON.stringify(starBlock.trim().slice(0, 300)));

  // ---------- 2) sitemap ----------
  console.log("\n========== sitemap ==========");
  const SM = "https://yesnogame.net/sitemaps/sitemap.xml.gz";
  const sm = await fetchBuf(SM);
  console.log("sitemap.gz status:", sm.code, "| bytes:", sm.buf.length);
  let xml = "";
  try {
    xml = zlib.gunzipSync(sm.buf).toString("utf8");
  } catch (e) {
    console.log("gunzip 失败:", e.message, "| 原始:", txt(sm).slice(0, 200));
  }
  console.log("xml len:", xml.length, "| 头部:", xml.slice(0, 300).replace(/\n/g, " "));
  const allIds = [...new Set((xml.match(/\/(?:en|ru)\/stories\/(\d+)/g) || []).map((x) => x.split("/").pop()))];
  console.log("sitemap 内 story id 数:", allIds.length, "| 样本:", allIds.slice(0, 12).join(","));
  console.log("是否含 ru 语言版本:", /\/ru\/stories\//.test(xml));

  // ---------- 3) 详情页抽取锚点 ----------
  console.log("\n========== 详情页锚点 ==========");
  const d = await fetchBuf("https://yesnogame.net/en/stories/175");
  const html = txt(d);
  const classes = [...new Set((html.match(/class="(quest__[a-z0-9_ -]+)"/g) || []).map((x) => x.slice(7, -1)))];
  console.log("#175 classes:", classes.join(" | "));
  const qm = html.match(/quest__story__question"?>([\s\S]{0,400}?)<\/div>/);
  console.log("question 抽取:", qm ? qm[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200) : "(未命中)");
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  console.log("title 抽取:", h1 ? h1[1].replace(/<[^>]+>/g, "").trim().slice(0, 80) : "(未命中)");
  const nid = (html.match(/To the next situation puzzle[\s\S]{0,300}?\/en\/stories\/(\d+)/) || [])[1];
  console.log("next-story id:", nid || "(未命中)");
})();
