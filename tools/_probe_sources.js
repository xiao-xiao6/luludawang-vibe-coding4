/* 源可行性探测：YesNoGame + Late-Late（只读，不写任何数据）
   用法：node tools/_probe_sources.js  */
const https = require("https");
const http = require("http");

function get(u, depth = 0) {
  return new Promise((resolve) => {
    const mod = u.startsWith("https") ? https : http;
    const req = mod.get(
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
    req.setTimeout(20000, () => {
      req.destroy();
      resolve({ code: "TIMEOUT", url: u, body: "" });
    });
  });
}

const strip = (h) =>
  h
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const uniq = (a) => [...new Set(a)];

(async () => {
  // ---------- robots ----------
  for (const u of ["https://yesnogame.net/robots.txt", "https://late-late.jp/robots.txt"]) {
    const r = await get(u);
    console.log("robots", u, "->", r.code, JSON.stringify(r.body.slice(0, 200)));
  }
  console.log();

  // ---------- YesNoGame ----------
  const Y = "https://yesnogame.net";
  let r = await get(Y + "/en");
  console.log("YNG index:", r.code, "len", r.body.length);
  let hrefs = uniq((r.body.match(/href="([^"]+)"/g) || []).map((x) => x.slice(6, -1)));
  const detail = hrefs.filter((h) => /\/en\/[^/]*\d/.test(h) || /\/en\/[a-z0-9-]{6,}/.test(h));
  console.log("YNG total hrefs:", hrefs.length, "| detail-like:", detail.length);
  detail.slice(0, 15).forEach((h) => console.log("   ", h));

  if (detail.length) {
    const d = await get(detail[0].startsWith("http") ? detail[0] : Y + detail[0]);
    const txt = strip(d.body);
    console.log("YNG detail:", d.code, "len", d.body.length);
    console.log("   has 'Solution'? ", /solution/i.test(txt), "| has spoiler class?", /spoiler|hidden|reveal/i.test(d.body));
    console.log("   text:", txt.slice(0, 400));
  }
  console.log();

  // ---------- Late-Late ----------
  for (const p of ["/mondai/solved", "/solved", "/mondai"]) {
    const d = await get("https://late-late.jp" + p);
    const txt = strip(d.body);
    const ids = uniq((d.body.match(/\/mondai\/[a-z_]+\/\d+/g) || []));
    console.log("LL", p, "->", d.code, "len", d.body.length, "| problem-links:", ids.length);
    if (ids.length) ids.slice(0, 6).forEach((x) => console.log("    ", x));
    console.log("   head:", txt.slice(0, 180));
  }
})();
