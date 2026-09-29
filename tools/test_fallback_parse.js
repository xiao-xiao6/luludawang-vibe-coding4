/* 兜底解析验证器：对已存盘的页面跑「text_ 标签优先，缺失则取 JSON-LD」两套解析，打印结果与截断风险。
 * 用法：node tools/test_fallback_parse.js _p21792.html
 */
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");

const clean = (s) =>
  (s || "").replace(/\\r/g, "").replace(/\\n/g, "\n").replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'").replace(/&apos;/g, "'").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/[ \t\u00a0]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

const pick = (html, tag) => {
  const m = html.match(new RegExp("<" + tag + ">([\\s\\S]*?)</" + tag + ">"));
  return m ? m[1] : "";
};

function jsonld(html) {
  const out = { title: "", surface: "", truth: "", author: "", dateCreated: "", found: false, truncated: false };
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
      out.found = !!out.surface && !!out.truth;
      // 站方 JSON-LD 预览有硬截断：正文被切在约 5000 字，且结尾不成句
      out.truncated = [out.surface, out.truth].some((t) => t.length >= 4700 && t.length <= 5300);
      if (out.found) return out;
    }
  }
  return out;
}

for (const f of process.argv.slice(2)) {
  const html = fs.readFileSync(path.join(ROOT, "tools", f), "utf8");
  const t = clean(pick(html, "text_title")), s = clean(pick(html, "text_content")), k = clean(pick(html, "text_kaisetu"));
  const j = jsonld(html);
  console.log("=== " + f);
  console.log("  text_ 标签 : S:" + s.length + " T:" + k.length + " 标题「" + t.slice(0, 22) + "」");
  console.log("  JSON-LD    : S:" + j.surface.length + " T:" + j.truth.length + " 标题「" + j.title.slice(0, 22) + "」 found=" + j.found + " 疑似截断=" + j.truncated);
  console.log("  LD 汤尾 …" + j.truth.slice(-40).replace(/\n/g, "⏎"));
}
