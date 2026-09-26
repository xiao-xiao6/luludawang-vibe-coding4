/* YesNoGame 可解析性深度探测（只读，不写数据）
   目标：确认 ① 汤底能否稳定抽出 ② 目录/分页规模 ③ robots 对通用 UA 的约束 */
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

const strip = (h) =>
  h.replace(/<script[\s\S]*?<\/script>/gi, " ")
   .replace(/<style[\s\S]*?<\/style>/gi, " ")
   .replace(/<br\s*\/?>/gi, "\n")
   .replace(/<\/p>/gi, "\n")
   .replace(/<[^>]+>/g, " ")
   .replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&amp;/g, "&")
   .replace(/&#39;|&apos;/g, "'").replace(/&laquo;/g, "«").replace(/&raquo;/g, "»")
   .replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

(async () => {
  // 1) robots 全文（看通用 UA 段）
  const rb = await get("https://yesnogame.net/robots.txt");
  console.log("===== robots.txt 全文 =====");
  console.log(rb.body.trim().slice(0, 1200));

  // 2) 详情页结构
  console.log("\n===== 详情页样本 =====");
  for (const id of [386, 175, 157]) {
    const d = await get(`https://yesnogame.net/en/stories/${id}`);
    if (d.code !== 200) { console.log(id, "->", d.code); continue; }
    // 找出 solution 相关节点
    const solIdx = d.body.search(/class="[^"]*(solution|spoiler|answer)[^"]*"/i);
    const txt = strip(d.body);
    const m = txt.match(/Situation puzzle\s+([^\n]{3,80})/i);
    console.log(`\n--- #${id} --- title-guess:`, m ? m[1].trim() : "(n/a)");
    console.log("  raw html len:", d.body.length, "| solution-node idx:", solIdx);
    if (solIdx >= 0) console.log("  around solution node:", strip(d.body.slice(solIdx - 200, solIdx + 700)).slice(0, 500));
    else console.log("  纯文本预览:", txt.slice(300, 800));
  }

  // 3) 目录规模 / 分页
  console.log("\n===== 分页与规模 =====");
  for (const q of ["/en", "/en?page=2", "/en?display=list", "/en/tag/murder"]) {
    const r = await get("https://yesnogame.net" + q);
    const ids = [...new Set((r.body.match(/\/en\/stories\/(\d+)/g) || []))];
    const total = (r.body.match(/in catalog\s*(\d+)/i) || [])[1];
    console.log(`  ${q.padEnd(18)} code=${r.code} story-links=${ids.length} total-hint=${total || "-"}`);
  }
})();
