/* ============================================================
 * 深海汤屋 · 假 AI 汤主（测试替身，soup-mock-ai）
 * ------------------------------------------------------------
 * 只为「真人玩家实测」而存在：OpenAI 兼容 /v1/chat/completions，
 * 从收到的提示词里解析汤底，用确定性的二元组重叠度扮演模型：
 *   · ask  → 命中汤底句子就给方向（是/部分正确），开放式→invalid，
 *            一句多问→multi（验证一问一答链路）
 *   · judge→ 按玩家推理与汤底的相似度定档（70/30 尺）；
 *            推理以 LEAKTEST 开头时故意在 note 里原样引用汤底 12 字，
 *            用来验证服务端 leaksTruth 硬过滤是否兜得住。
 * 本文件不含任何汤的数据；测完即从 Cloudflare 删除。
 * ============================================================ */
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization, x-api-key, anthropic-version"
};

function norm(s) {
  return String(s == null ? "" : s).toLowerCase().replace(/[\s，。！？、,.?!~·“”"'‘’「」『』（）()《》【】：:；;…\-—_/\\|+=*&^%$#@<>?？]/g, "");
}
function bigrams(s) {
  const out = new Set();
  for (let i = 0; i + 2 <= s.length; i++) out.add(s.substr(i, 2));
  return out;
}
function overlap(a, b) {
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n;
}
function pickSystem(msgs) {
  for (const m of msgs) if (m.role === "system") return String(m.content || "");
  return "";
}
function pickUser(msgs) {
  for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === "user") return String(msgs[i].content || "");
  return "";
}
function extractBlock(sys, labelRe) {
  const m = sys.match(new RegExp(labelRe + "\\n([\\s\\S]+?)(?:\\n\\n|\\n【|$)"));
  return m ? m[1].trim() : "";
}

/* ---------------- ask：扮演持底回答的汤主 ---------------- */
function hostAsk(sys, usr) {
  const truth = extractBlock(sys, "【本题的汤底（[^】]*）】");
  const qm = usr.match(/【玩家这次问】\n([\s\S]+?)\n\n只输出一个 JSON/);
  const q = norm(qm ? qm[1] : usr.split("【玩家这次问】")[1] || usr);
  const raw = (qm ? qm[1] : usr);

  if (/为什么|是什么|是谁|讲讲|说说|描述|告诉我汤底|告诉我答案|提示我|给我.{0,4}线索/.test(raw)) {
    return { verdict: "invalid", reply: "问题不合规。", clue: 0 };
  }
  const qMarks = (raw.match(/[?？]/g) || []).length;
  const polar = (raw.match(/吗|是不是|是否|有没有/g) || []).length;
  if (qMarks >= 2 || polar >= 2) {
    return { verdict: "multi", reply: "检测到您的发问中存在多个问题，请挑一个问，每次提问只允许问一个问题。", clue: 0 };
  }
  const qb = bigrams(q);
  let best = null, bestHit = 0;
  for (const line of truth.split(/[。！？\n]/)) {
    const lb = bigrams(norm(line));
    if (!lb.size) continue;
    let lineHit = 0;
    for (const x of qb) if (lb.has(x)) lineHit++;
    if (lineHit > bestHit) { bestHit = lineHit; best = line; }
  }
  if (bestHit >= 3) return { verdict: "yes", reply: "是。" + String(best).slice(0, 30), clue: 0 };
  if (bestHit >= 1) return { verdict: "partial", reply: "部分正确。" + String(best).slice(0, 24), clue: 0 };
  return { verdict: "irr", reply: "与此无关。这和这个故事不沾边。", clue: 0 };
}

/* ---------------- judge：扮演定档的汤主（含故意的泄底模式） ---------------- */
function hostJudge(sys, usr) {
  const truth = extractBlock(sys, "【本题汤底（[^】]*）】");
  const gm = usr.match(/【玩家的推理】\n([\s\S]+?)\n\n/);
  const guess = gm ? gm[1] : "";
  const g = norm(guess);
  if (!g) return { level: "no", score: 0, note: "太短了，看不出因果。" };
  const gb = bigrams(g);
  const tb = bigrams(norm(truth));
  const sim = tb.size ? overlap(gb, tb) / Math.max(1, gb.size) : 0;
  const score = Math.round(sim * 100);
  /* 故意泄底模式：note 原样引用汤底里 12 个连续字（玩家没说过的）
     —— 用来验证 Worker 的 leaksTruth 硬过滤是否把这条整段丢弃 */
  if (/^LEAKTEST/.test(guess.trim())) {
    return { level: "close", score: 55, note: "没说破" + norm(truth).substr(12, 12) + "这一层" };
  }
  if (score >= 70) return { level: "solved", score, note: "说破了，就是这个真相。" };
  if (score >= 30) return { level: "close", score, note: "方向沾边，最关键的因果还没说中。" };
  return { level: "no", score, note: "方向不对，或只是在复述汤面。" };
}

export default {
  async fetch(req) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    const url = new URL(req.url);
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ ok: true, service: "soup-mock-ai" }), { headers: Object.assign({ "content-type": "application/json" }, CORS) });
    }
    let body = {};
    try { body = await req.json(); } catch (e) { }
    const msgs = (body.messages || []).map((m) => ({
      role: m.role,
      content: typeof m.content === "string" ? m.content : JSON.stringify(m.content || "")
    }));
    const sys = pickSystem(msgs);
    const usr = pickUser(msgs);
    let obj;
    if (sys.indexOf("把玩家这段推理与真实汤底对照") !== -1) obj = hostJudge(sys, usr);
    else obj = hostAsk(sys, usr);
    const content = JSON.stringify(obj);
    const out = {
      id: "mock-" + Date.now(),
      object: "chat.completion",
      model: body.model || "mock-host",
      choices: [{ index: 0, message: { role: "assistant", content: content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    };
    return new Response(JSON.stringify(out), { headers: Object.assign({ "content-type": "application/json" }, CORS) });
  }
};
