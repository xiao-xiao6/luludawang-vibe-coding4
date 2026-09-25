/* ============================================================
 * 深海汤屋 · 服务端 AI 汤主
 * ------------------------------------------------------------
 * 规格 #11 / #12：判定走 AI，**key 只存服务端**（房间级配置，
 * 只有房主 #1 能配）。与前端 js/ai.js 同一套提示词口径。
 * ============================================================ */

const LEAD_OF = { yes: "是", no: "不是", partial: "部分正确", irr: "与此无关" };

/* 思考链出口硬过滤：命中这些痕迹说明模型把内部分析吐出来了，整段丢弃，绝不展示给玩家。
   与前端 js/ai.js 的 REASON_TAIL 保持同一口径。 */
export const REASON_TAIL = /(根据(汤底|题目|故事|设定|材料|题面)|汤底(说|写|里|中|表明|显示)|让我(们)?(先)?(想|分析|看|梳理|猜|盘)|我先(想|分析|看|梳理)|首先|其次|综上|分析一下|分析过程|分析如下|推理(过程|一下|链)|思考(过程|一下)|真正的答案|解释一下|举个?例|也就是说)/;

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
    "   verdict 只能是 yes / no / partial / irr；clue 是认领到的线索编号（没认到就填 0）；reply 是给玩家看的那句话。",
    "10. 玩家只能看到汤面，所以他是基于汤面进行猜测的。例如玩家说「他喝的不是海龟汤」，是在问汤面里他喝的是不是海龟汤——即使汤底里他曾经喝过别的汤，你也应该判定汤面里那碗。",
    "11. 思考、分析、逐条排除、「让我想想」这类内部草稿，无论出现在 JSON 内外、任何字段里，都绝对禁止输出；输出前必须全部删干净，只留最终判定和一句短答。"
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
  "3. note 不超过 40 字，绝不能把汤底原文写出来，也不要解释你是怎么判断的。"
].join("\n");

export function buildJudgeSystem(puzzle) {
  var p = puzzle || {};
  return JUDGE_SYS
    .replace("{SURFACE}", String(p.surface || ""))
    .replace("{TRUTH}", String(p.truth || ""));
}

/* ---------------- 调用 ---------------- */

/* 多人房的 AI 请求是从 Cloudflare 机房发出的，永远访问不到玩家本机的回环 /
   内网地址。碰到这种配置要直接给出可操作的提示，而不是抛一句笼统的网络错误。 */
export function isLocalOnlyUrl(u) {
  var s = String(u || "").trim().toLowerCase();
  if (!s) return false;
  if (/^https?:\/\/(127\.|localhost\b|0\.0\.0\.0|\[::1\])/.test(s)) return true;
  if (/^https?:\/\/(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(s)) return true;
  return false;
}

export const LOCAL_URL_HINT =
  "多人房的 AI 请求从 Cloudflare 机房发出：本机地址（127.0.0.1 / 192.168.x.x / 10.x）永远访问不到；而且很多中转站（如 cofi）还会按来源 IP 拦截机房请求（报「当前请求来源已被系统策略拦截」就是这种）。可行做法：① 用 cloudflared / ngrok / frp 把你本地的净化中转（如 8123）穿透成公网地址再填进来，请求从你家宽带发出就不会被拦；② 或换机房能直连的服务商（DeepSeek / Kimi 官方等）。";

/* 中转站自家 WAF 拦掉了机房来源：这不是「key 错 / 模型名错」，
   处置方式是换站或换直连，而不是反复改配置。 */
export const GATEWAY_BLOCKED_HINT =
  "该中转站的防火墙拦掉了服务器来源（机房 IP + 非浏览器请求特征），已带上浏览器伪装头仍被拦。这不是 key 或模型名的问题：建议换一个中转站，或换直连服务商（DeepSeek / Kimi 官方等）。";

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
  if (typeof msg.reasoning === "string" && msg.reasoning.trim()) return msg.reasoning;
  if (typeof ch.text === "string" && ch.text.trim()) return ch.text;
  /* 有些网关把回答塞在 json.output / json.response */
  if (typeof json.output_text === "string" && json.output_text.trim()) return json.output_text;
  if (typeof json.output === "string" && json.output.trim()) return json.output;
  if (typeof json.response === "string" && json.response.trim()) return json.response;
  if (typeof json.text === "string" && json.text.trim()) return json.text;
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

/* 明文兜底：很多模型不守 JSON 格式，直接回「是的，……」这类中文整句。
   pickJson 认不出时用它尽力捞一把，认不出判定就返回 null 交给上层重试。 */
export function looseAnswer(text) {
  var t = String(text || "")
    .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, " ")
    .replace(/```[a-zA-Z]*/g, " ")
    .trim();
  if (!t) return null;
  var j = pickJson(t);
  if (j && (j.verdict != null || j.reply != null || j.result != null)) return j;
  var verdict = "";
  if (t.indexOf("与此无关") !== -1 || t.indexOf("无关") !== -1) verdict = "irr";
  else if (t.indexOf("部分正确") !== -1 || t.indexOf("部分对") !== -1 || t.indexOf("接近") !== -1 || t.indexOf("很近") !== -1) verdict = "partial";
  else {
    var idx = t.indexOf("不是");
    while (idx !== -1 && t.charAt(idx - 1) === "是") idx = t.indexOf("不是", idx + 1);
    if (idx !== -1 || t.indexOf("不对") !== -1) verdict = "no";
    else if (t.indexOf("是的") !== -1) verdict = "yes";
  }
  if (!verdict) return null;
  /* 判定词之前的整段思考直接扔掉，之后也只取第一短句；带分析痕迹则只回标准短句 */
  var lw = LEAD_OF[verdict] || "";
  var vi = lw ? t.indexOf(lw) : -1;
  if (vi > 0) t = t.slice(vi);
  var rest = t.replace(/^(是的?|不是的?|部分正确|与此无关|无关|对|不对|正确|否)[。.，,、！!？?：:；;—－~～\s]*/, "").replace(/\s+/g, " ").trim();
  var mF = rest.match(/^[^。！？；]{0,28}/);
  rest = (mF ? mF[0] : "").replace(/\s+$/, "");
  if (!rest || REASON_TAIL.test(rest)) return { verdict: verdict, reply: lw + "。", clue: 0 };
  return { verdict: verdict, reply: lw + "。" + rest, clue: 0 };
}

/* 猜底判定的明文兜底：从整句里认 solved / close / vague，认不出就按 no 处理。 */
export function looseJudge(text) {
  var t = String(text || "")
    .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, " ")
    .replace(/```[a-zA-Z]*/g, " ")
    .trim();
  if (!t) return null;
  var j = pickJson(t);
  if (j && (j.level != null || j.note != null)) return j;
  var level = "no";
  if (/说破|完全正确|就是他|就是这些|猜对/.test(t)) level = "solved";
  else if (/接近|很近|部分|方向对|就差/.test(t)) level = "close";
  else if (/模糊|太短|讲清楚|说清楚|再具体/.test(t)) level = "vague";
  return { level: level, note: t.replace(/\s+/g, " ").slice(0, 110) };
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
      /* 中转站 WAF 拦的，重试也是一样的结果 */
      if (e && String(e.message) === "GATEWAY_BLOCKED") throw e;
      /* 本机地址对机房永远不可达，重试也没意义 */
      if (e && String(e.message) === "LOCAL_ONLY_URL") throw e;
      /* 空正文重试一次，多半是思考模型把正文写进了思考字段或 max_tokens 截断 */
    }
  }
  throw lastErr;
}

async function callModelOnce(cfg, system, user) {
  var base = String(cfg.baseUrl || "").replace(/\/+$/, "");
  if (isLocalOnlyUrl(base)) throw new Error("LOCAL_ONLY_URL");
  var kind = cfg.kind === "anthropic" ? "anthropic" : "openai";
  var isAnthropic = kind === "anthropic";

  var url = isAnthropic ? base + "/messages" : base + "/chat/completions";
  /* 完整浏览器伪装头：很多中转站前挂了 WAF，看到「机房 IP + 非浏览器 UA」
     就直接拦（返回自家防火墙的拦截页）。把请求装得像普通浏览器发出的，
     能救活其中相当一部分中转站；纯 IP 黑名单依旧救不了（会报 GATEWAY_BLOCKED）。 */
  var browserHeaders = {
    "accept": "application/json, text/plain, */*",
    "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "origin": base,
    "referer": base + "/"
  };
  var headers = isAnthropic
    ? Object.assign({ "content-type": "application/json", "x-api-key": cfg.apiKey, "anthropic-version": "2023-06-01" }, browserHeaders)
    : Object.assign({ "content-type": "application/json", "authorization": "Bearer " + cfg.apiKey }, browserHeaders);
  /* 默认放宽到 1200：思考型模型 400 token 很容易把正文截断，导致空 content 直接判掉线 */
  var maxTokens = Number(cfg.maxTokens) > 0 ? Number(cfg.maxTokens) : 1200;
  var temperature = cfg.temperature == null ? 0.4 : cfg.temperature;
  var body = isAnthropic
    ? { model: cfg.model, max_tokens: maxTokens, temperature: temperature, system: system, messages: [{ role: "user", content: user }] }
    : { model: cfg.model, temperature: temperature, max_tokens: maxTokens, messages: [{ role: "system", content: system }, { role: "user", content: user }] };

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
    if (!res.ok) {
      /* WAF / 防火墙拦截：报自家拦截文案（如 sensitive_words_detected），
         而不是上游模型错误——两者处置方式完全不同 */
      if (looksLikeGatewayBlock(res.status, text)) throw new Error("GATEWAY_BLOCKED");
      throw new Error("HTTP_" + res.status + (text ? "_" + String(text).slice(0, 120) : ""));
    }
    let json = null;
    try { json = JSON.parse(text); } catch (e) { json = null; }
    const out = extractText(kind, json);
    if (!out) throw new Error("EMPTY_REPLY");
    return out;
  } finally {
    clearTimeout(timer);
  }
}

/* 判断这包响应是不是中转站自家 WAF 的拦截页。
   特征：403/406 且正文里出现防火墙/策略拦截类文案，或者正文根本不是 JSON。 */
function looksLikeGatewayBlock(status, text) {
  const t = String(text || "");
  const s = t.toLowerCase();
  if (/sensitive_words_detected|waf|cloudflare|access denied|request blocked|blocked by|数据包被拦截|来源已被系统策略拦截|来源被拦截|策略拦截/.test(s)) return true;
  if (status === 403 || status === 406) return true;
  /* 200 也可能返回一个 HTML 拦截页：不是 JSON 且含 html 标签 */
  if (/<html|<head|<body/.test(s) && t.trim().indexOf("{") !== 0) return true;
  return false;
}
