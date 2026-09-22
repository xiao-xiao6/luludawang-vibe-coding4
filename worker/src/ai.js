/* ============================================================
 * 深海汤屋 · 服务端 AI 汤主
 * ------------------------------------------------------------
 * 规格 #11 / #12：判定走 AI，**key 只存服务端**（房间级配置，
 * 只有房主 #1 能配）。与前端 js/ai.js 同一套提示词口径。
 * ============================================================ */

const LEAD_OF = { yes: "是", no: "不是", partial: "部分正确", irr: "与此无关" };

function listText(arr, cap) {
  var a = (arr || []).slice(0, cap || 40);
  return a.length ? a.join(" / ") : "（无）";
}

export function buildSystemPrompt(puzzle) {
  var p = puzzle || {};
  var clues = p.clues || [];
  var clueLines = [];
  for (var i = 0; i < clues.length; i++) {
    clueLines.push((i + 1) + ". [" + (LEAD_OF[clues[i].type] || "线索") + "] " + String(clues[i].text || ""));
  }
  var clueBlock = clues.length
    ? ["【本题的线索清单（内部记账用，绝对不可念给玩家听）】",
       "每条线索都有编号、判定和汤主原话。玩家问到哪一条，你就认领哪一条。",
       clueLines.join("\n")].join("\n")
    : ["【本题没有预设线索清单】",
       "你只依据汤面与汤底作答。永远不要把 clue 置为非 0。"].join("\n");
  return [
    "你是海龟汤游戏《深海汤屋》里的汤主。玩家只能通过向你提问，一步步逼近真相。",
    "",
    "【本题的汤面（玩家看到的部分）】",
    String(p.surface || ""),
    "",
    "【本题的汤底（只有你能看，绝对不可泄露）】",
    String(p.truth || ""),
    "",
    "【内部参考：判定时要抓住的关键词】",
    listText(p.truthKeywords, 40),
    "",
    clueBlock,
    "",
    "【铁律，任何情况都不能违反】",
    "1. 回答只能落在四种判定上，并且判定词必须放在最前面：",
    "   「是。」「不是。」「部分正确。」「与此无关。」",
    "2. 判定词后面最多再补一句话，不超过 28 个字，只能给方向，不能替玩家把答案说完整。",
    "3. 永远不要说出汤底里的关键结论、关键名词、关键情节。玩家问得准，就用「是。」或「部分正确。」肯定他，但不要把话补全；玩家已经把核心说破时，回答「部分正确。你离汤底只剩一层了，去按『我要猜汤底』把推理讲一遍。」",
    "4. 不要复述汤面，不要解释规则，不要写分析过程，不要用 Markdown，不要加引号，不要换行，不要自称 AI。",
    "5. 与故事无关的问题（现实知识、闲聊、问你是谁、要答案）一律「与此无关。」，可以补一句短话把话题拨回来。",
    "6. 玩家索要答案 → 「与此无关。汤底要自己熬出来。」",
    "7. 认领线索只看意思，不看用词：玩家用自己的话说中了某一条的实质，就要认领它；只沾一点边、说不准的，填 0。",
    "8. 认领了线索时，verdict 必须和那一条的判定完全一致，reply 用你自己的话重说，不要照抄原话。",
    "9. 只输出一个 JSON 对象，不要代码块、不要多余文字：",
    '   {"verdict":"yes","reply":"是。他确实在那天去过海边。","clue":3}',
    "   verdict 只能是 yes / no / partial / irr；clue 是认领到的线索编号（没认到就填 0）；reply 是给玩家看的那句话。"
  ].join("\n");
}

export function buildAskUser(puzzle, question, ctx) {
  var c = ctx || {};
  var lines = [];
  var hc = c.hintClue;
  if (hc && hc.text) {
    lines.push("【内部参考：关键词系统认为这句话可能对应第 " + hc.n + " 条线索（仅供参考）】");
    lines.push("那一条的汤主原话是：" + String(hc.text));
    lines.push("如果你判断玩家确实说中了它的实质，就认领第 " + hc.n + " 条；只是沾边或说不准，就不要认领。");
    lines.push("");
  }
  var revealed = (c.revealed || []).filter(Boolean);
  if (revealed.length) {
    lines.push("【玩家已经挖到的线索（他已知这些，可以顺着答；这些编号不要再认领）】");
    for (var i = 0; i < revealed.length; i++) lines.push("- " + revealed[i]);
    lines.push("");
  }
  var taken = (c.taken || []).filter(function (n) { return n > 0; });
  if (taken.length) lines.push("【已经挖走的编号】" + taken.join(" / ") + "（不要重复认领）\n");
  if (c.history && c.history.length) {
    lines.push("【最近的问答（保持连贯）】");
    for (var k = 0; k < c.history.length; k++) {
      var h = c.history[k] || {};
      lines.push("玩家：" + String(h.q || ""));
      lines.push("汤主：" + String(h.a || ""));
    }
    lines.push("");
  }
  lines.push("【玩家这次问】");
  lines.push(String(question || ""));
  lines.push("");
  lines.push("只输出一个 JSON 对象。");
  return lines.join("\n");
}

export function buildJudgeUser(puzzle, guess) {
  return [
    "【玩家的推理】",
    String(guess || ""),
    "",
    "判断这段推理离汤底还有多远，只输出一个 JSON 对象：",
    '{"level":"close","note":"已经很近了——你摸到了关键，但还差最后一层。"}',
    "level 只能是：solved（说破了汤底）/ close（摸到关键，差最后一层）/ vague（太短，说不清）/ no（方向不对）。",
    "note 是一句给玩家看的话，不超过 40 个字，不要泄露汤底原文。"
  ].join("\n");
}

const JUDGE_SYS = [
  "你是海龟汤游戏《深海汤屋》的汤主，只负责判断玩家的推理离汤底有多远。",
  "【本题汤面】", "{SURFACE}", "",
  "【本题汤底（绝对不可泄露原文）】", "{TRUTH}", "",
  "【铁律】",
  "1. 只输出一个 JSON 对象，不要代码块、不要多余文字。",
  "2. level 只能是 solved / close / vague / no。",
  "3. note 不超过 40 字，绝不能把汤底原文写出来。"
].join("\n");

export function buildJudgeSystem(puzzle) {
  var p = puzzle || {};
  return JUDGE_SYS
    .replace("{SURFACE}", String(p.surface || ""))
    .replace("{TRUTH}", String(p.truth || ""));
}

/* ---------------- 调用 ---------------- */

function extractText(kind, json) {
  if (!json) return "";
  if (kind === "anthropic") {
    var blocks = json.content || [];
    var out = "";
    for (var i = 0; i < blocks.length; i++) {
      if (blocks[i] && typeof blocks[i].text === "string") out += blocks[i].text;
    }
    return out;
  }
  var ch = (json.choices || [])[0] || {};
  var msg = ch.message || {};
  /* OpenAI 系：content 是字符串直接拿 */
  if (typeof msg.content === "string" && msg.content.trim()) return msg.content;
  /* content 是数组（多模态格式）：拼接 text 段 */
  if (Array.isArray(msg.content)) {
    var s = "";
    for (var j = 0; j < msg.content.length; j++) {
      var seg = msg.content[j];
      if (seg && typeof seg.text === "string") s += seg.text;
      else if (typeof seg === "string") s += seg;
    }
    if (s.trim()) return s;
  }
  /* DeepSeek-R1 等推理模型：正文在 reasoning_content 之外，content 可能为空，
     但如果 content 空了，宁可拿 reasoning_content 兜底也比空手强 */
  if (typeof msg.reasoning_content === "string" && msg.reasoning_content.trim()) {
    return msg.reasoning_content;
  }
  if (typeof ch.text === "string") return ch.text;
  /* 有些网关把回答塞在 json.output / json.response */
  if (typeof json.output === "string") return json.output;
  if (typeof json.response === "string") return json.response;
  return "";
}

/* 从模型回话里抠出第一个 JSON 对象（容忍 ```json 包裹、前后废话、单引号、尾逗号） */
export function pickJson(text) {
  var s = String(text || "").trim();
  if (!s) return null;
  /* 剥掉所有 ```json ... ``` 围栏，取最像一个 JSON 的段落 */
  s = s.replace(/```(?:json)?/gi, "").trim();
  var a = s.indexOf("{");
  var b = s.lastIndexOf("}");
  if (a === -1 || b === -1 || b <= a) return null;
  var cand = s.slice(a, b + 1);
  try { return JSON.parse(cand); } catch (e) { /* 继续兜底 */ }
  /* 兜底 1：去掉尾逗号 {...,} / [...,] */
  try {
    var fixed = cand.replace(/,\s*([}\]])/g, "$1");
    return JSON.parse(fixed);
  } catch (e) { /* 继续兜底 */ }
  /* 兜底 2：单引号换双引号（有些模型偷懒用单引号） */
  try {
    var dq = cand.replace(/,\s*([}\]])/g, "$1").replace(/'/g, '"');
    return JSON.parse(dq);
  } catch (e) { return null; }
}

export async function callModel(cfg, system, user) {
  var lastErr = null;
  /* 失败重试一次：网络抖动 / 网关偶发 5xx 不至于直接判「AI 掉线」 */
  for (var attempt = 0; attempt < 2; attempt++) {
    try {
      return await callModelOnce(cfg, system, user);
    } catch (e) {
      lastErr = e;
      /* 4xx 是配置错误（key 错、模型名错），重试没意义，直接抛 */
      if (e && /^HTTP_4\d\d/.test(String(e.message))) throw e;
    }
  }
  throw lastErr;
}

async function callModelOnce(cfg, system, user) {
  var base = String(cfg.baseUrl || "").replace(/\/+$/, "");
  var kind = cfg.kind === "anthropic" ? "anthropic" : "openai";
  var isAnthropic = kind === "anthropic";

  var url = isAnthropic ? base + "/messages" : base + "/chat/completions";
  var headers = isAnthropic
    ? { "content-type": "application/json", "x-api-key": cfg.apiKey, "anthropic-version": "2023-06-01" }
    : { "content-type": "application/json", "authorization": "Bearer " + cfg.apiKey };
  var body = isAnthropic
    ? { model: cfg.model, max_tokens: cfg.maxTokens || 400, temperature: cfg.temperature == null ? 0.4 : cfg.temperature, system: system, messages: [{ role: "user", content: user }] }
    : { model: cfg.model, temperature: cfg.temperature == null ? 0.4 : cfg.temperature, max_tokens: cfg.maxTokens || 400, messages: [{ role: "system", content: system }, { role: "user", content: user }] };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs || 40000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
    const text = await res.text();
    if (!res.ok) throw new Error("HTTP_" + res.status);
    let json = null;
    try { json = JSON.parse(text); } catch (e) { json = null; }
    const out = extractText(kind, json);
    if (!out) throw new Error("EMPTY_REPLY");
    return out;
  } finally {
    clearTimeout(timer);
  }
}
