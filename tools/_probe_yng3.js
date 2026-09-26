/* YesNoGame 详情页抽取规则定稿测试（只读）
   确认能不能稳定抽出：title / surface / truth / 标签
   用法：node tools/_probe_yng3.js */
const https = require("https");

function get(u, depth = 0) {
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
          return resolve(get(new URL(s.headers.location, u).href, depth + 1));
        }
        let b = "";
        s.setEncoding("utf8");
        s.on("data", (c) => (b += c));
        s.on("end", () => resolve({ code: s.statusCode, url: u, body: b }));
      }
    );
    req.on("error", (e) => resolve({ code: "ERR", url: u, body: String(e.message) }));
    req.setTimeout(20000, () => { req.destroy(); resolve({ code: "TIMEOUT", url: u, body: "" }); });
  });
}

/* 抽取：区块 → 纯文本 */
function block(html, cls) {
  const re = new RegExp('<div[^>]*class="[^"]*' + cls + '[^"]*"[^>]*>([\\s\\S]*?)</div>\\s*(?=<div|</div>)', "i");
  const m = html.match(re);
  if (!m) return "";
  return m[1]
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&").replace(/&mdash;/g, "—").replace(/&laquo;/g, "«").replace(/&raquo;/g, "»")
    .replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

(async () => {
  const ids = [386, 175, 157, 1, 473];
  for (const id of ids) {
    const r = await get(`https://yesnogame.net/en/stories/${id}`);
    if (r.code !== 200) { console.log(`#${id} -> ${r.code}`); continue; }
    const h = r.body;
    const title = (h.match(/<h1[^>]*class="[^"]*quest__title[^"]*"[^>]*>([\s\S]*?)<\/h1>/) ||
                   h.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || "";
    const titleTxt = title.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").replace(/^Situation puzzle\s*/i, "").trim();
    const q = block(h, "quest__story_question");
    const a = block(h, "quest__story_answer");
    const tags = [...new Set((h.match(/\/en\/tag\/[a-z0-9-]+/g) || []).map((x) => x.split("/").pop()))];
    console.log(`\n===== #${id} =====`);
    console.log("  title :", titleTxt.slice(0, 70));
    console.log("  surface:", q.replace(/\n/g, " ").slice(0, 130));
    console.log("  truth  :", a.replace(/\n/g, " ").slice(0, 130));
    console.log("  tags   :", tags.join(","));
    console.log("  OK抽取 :", !!titleTxt && q.length > 10 && a.length > 10);
  }
})();
