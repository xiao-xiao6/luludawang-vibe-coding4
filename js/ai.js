/* ============================================================
 * 深海汤屋 · AI 汤主
 * ------------------------------------------------------------
 * 把「汤主」交给大模型：每一题都把汤面 + 汤底 + 关键真相词 +
 * 玩家已挖到的线索一起喂进去，让模型真正听懂人话，而不是撞关键词。
 *
 * 设计要点：
 *   1. 纯前端。服务商 / 模型 / 接口地址 / Key 全由玩家自己填，
 *      只存在本机 localStorage，不上传任何地方。
 *   2. 规则钉死。系统提示词把模型锁在「是 / 不是 / 部分正确 /
 *      与此无关」四种回答上，并明确禁止它把汤底说破。
 *   3. 出口把关。模型的话必须过 guardAnswer()：判定词对得上、
 *      长度可控、不含汤底原文（≥12 字重叠）。不合格就抛错，
 *      由界面回退到关键词汤主，绝不会把汤底漏给玩家。
 *   4. 可测试。__setTransport() 能把网络层整个换掉，
 *      自检脚本和真机探针都不需要真 Key。
 * ============================================================ */

(function (root) {
  "use strict";

  var E = root.SoupEngine;
  var STORE_KEY = "deepsea_soup_ai_v1";

  var VERDICTS = ["yes", "no", "partial", "irr"];
  var LEAD_OF = { yes: "是", no: "不是", partial: "部分正确", irr: "与此无关" };
  var LEVELS = ["solved", "close", "no"];

  /* 服务商预设：除 Anthropic 外都走 OpenAI 兼容的 /chat/completions */
  var PROVIDERS = [
    { id: "deepseek", label: "DeepSeek", kind: "openai", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", note: "国内直连、便宜，浏览器可直连" },
    { id: "moonshot", label: "Moonshot / Kimi", kind: "openai", baseUrl: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k", note: "长上下文，浏览器可直连" },
    { id: "dashscope", label: "通义千问", kind: "openai", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus", note: "阿里云百炼的兼容模式" },
    { id: "zhipu", label: "智谱 GLM", kind: "openai", baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-flash", note: "flash 档免费额度够玩" },
    { id: "siliconflow", label: "硅基流动", kind: "openai", baseUrl: "https://api.siliconflow.cn/v1", model: "Qwen/Qwen2.5-7B-Instruct", note: "聚合站，模型名要写全" },
    { id: "openai", label: "OpenAI", kind: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", note: "官方接口对浏览器直连不友好，建议自建代理" },
    { id: "anthropic", label: "Anthropic Claude", kind: "anthropic", baseUrl: "https://api.anthropic.com/v1", model: "claude-3-5-haiku-latest", note: "已带上浏览器直连所需的请求头" },
    { id: "tokenrhythm", label: "TokenRhythm（需本地运行）", kind: "openai", local: true, baseUrl: "http://127.0.0.1:8787/v1", model: "deepseek-v4-flash", note: "⚠ 仅限本机：需要先在这台电脑上跑起本地 CORS 桥（127.0.0.1:8787）。普通访客和手机选它一定连不上——不确定就别选，直接用 DeepSeek / Kimi 这些能直连的服务商。" },
    { id: "custom", label: "自定义（OpenAI 兼容）", kind: "openai", baseUrl: "", model: "", note: "填自己的代理地址，注意服务端要允许 CORS" }
  ];

  var DEFAULTS = {
    enabled: false,
    provider: "deepseek",
    kind: "openai",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    apiKey: "",
    timeoutMs: 20000,
    maxTokens: 1200,
    temperature: 0.4
  };

  /* ---------------- 配置 ---------------- */

  var cache = null;

  function providerOf(id) {
    for (var i = 0; i < PROVIDERS.length; i++) {
      if (PROVIDERS[i].id === id) return PROVIDERS[i];
    }
    return PROVIDERS[PROVIDERS.length - 1];
  }

  function defaults() {
    var o = {};
    for (var k in DEFAULTS) if (Object.prototype.hasOwnProperty.call(DEFAULTS, k)) o[k] = DEFAULTS[k];
    return o;
  }

  function clean(cfg) {
    var d = defaults();
    var o = cfg && typeof cfg === "object" ? cfg : {};
    var out = {
      enabled: !!o.enabled,
      provider: typeof o.provider === "string" && providerOf(o.provider).id === o.provider ? o.provider : d.provider,
      kind: "",
      baseUrl: typeof o.baseUrl === "string" ? o.baseUrl.trim().replace(/\/+$/, "") : d.baseUrl,
      model: typeof o.model === "string" ? o.model.trim() : d.model,
      apiKey: typeof o.apiKey === "string" ? o.apiKey.trim() : "",
      timeoutMs: clampNum(o.timeoutMs, 3000, 120000, d.timeoutMs),
      maxTokens: clampNum(o.maxTokens, 64, 4000, d.maxTokens),
      temperature: clampNum(o.temperature, 0, 1.5, d.temperature)
    };
    out.kind = providerOf(out.provider).kind === "anthropic" ? "anthropic" : "openai";
    return out;
  }

  function clampNum(v, lo, hi, dft) {
    var n = Number(v);
    if (!isFinite(n)) return dft;
    return Math.max(lo, Math.min(hi, n));
  }

  function load() {
    if (cache) return cache;
    var raw = null;
    try { raw = root.localStorage ? root.localStorage.getItem(STORE_KEY) : null; } catch (e) { raw = null; }
    var obj = null;
    if (raw) { try { obj = JSON.parse(raw); } catch (e) { obj = null; } }
    cache = clean(obj);
    return cache;
  }

  /* 配置变更通知：app 层靠它刷新状态条，避免“存了但界面没变” */
  var watchers = [];

  function onChange(fn) {
    if (typeof fn === "function" && watchers.indexOf(fn) === -1) watchers.push(fn);
  }

  function emit(cfg) {
    for (var i = 0; i < watchers.length; i++) {
      try { watchers[i](cfg); } catch (e) { /* 监听方出错不影响存取 */ }
    }
    try {
      if (root.dispatchEvent && typeof root.CustomEvent === "function") {
        root.dispatchEvent(new root.CustomEvent("soup-ai-change", { detail: cfg }));
      }
    } catch (e) { /* 忽略 */ }
  }

  function save(cfg) {
    cache = clean(cfg);
    try { if (root.localStorage) root.localStorage.setItem(STORE_KEY, JSON.stringify(cache)); } catch (e) { /* 隐私模式：忽略 */ }
    emit(cache);
    return cache;
  }

  function config() {
    return load();
  }

  function setConfig(patch) {
    var cur = load();
    var next = {};
    for (var k in cur) if (Object.prototype.hasOwnProperty.call(cur, k)) next[k] = cur[k];
    if (patch && typeof patch === "object") {
      for (var j in patch) if (Object.prototype.hasOwnProperty.call(patch, j)) next[j] = patch[j];
    }
    if (patch && patch.provider && !patch.baseUrl && !patch.model) {
      var pre = providerOf(patch.provider);
      next.baseUrl = pre.baseUrl;
      next.model = pre.model;
    }
    return save(next);
  }

  function isReady(cfg) {
    var c = cfg ? clean(cfg) : load();
    return !!(c.enabled && c.baseUrl && c.model && c.apiKey);
  }

  function maskKey(key) {
    var k = String(key || "");
    if (!k) return "";
    if (k.length <= 8) return k.slice(0, 2) + "***";
    return k.slice(0, 4) + "***" + k.slice(-4);
  }

  /* ---------------- 提示词：把规则钉死 ---------------- */

  function listText(arr, cap) {
    var a = (arr || []).slice(0, cap || 40);
    return a.length ? a.join(" / ") : "（无）";
  }

  function buildSystemPrompt(puzzle) {
    var p = puzzle || {};
    var clues = p.clues || [];
    var clueLines = [];
    for (var i = 0; i < clues.length; i++) {
      clueLines.push((i + 1) + ". [" + (LEAD_OF[clues[i].type] || "线索") + "] " + String(clues[i].text || ""));
    }
    /* 汤库层没有预设线索清单：不要输出空清单标题，也不要把 clue 置成非 0 */
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

  function buildAskUser(puzzle, question, ctx) {
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
    var hist = (c.history || []).slice(-6);
    if (hist.length) {
      lines.push("【最近的问答（保持前后一致）】");
      for (var j = 0; j < hist.length; j++) {
        lines.push("玩家：" + hist[j].q);
        lines.push("汤主：" + hist[j].a);
      }
      lines.push("");
    }
    lines.push("【玩家这一轮的提问】");
    lines.push(String(question || ""));
    lines.push("");
    lines.push("按铁律回答，只输出 JSON。");
    return lines.join("\n");
  }

  function buildGuessUser(puzzle, guess) {
    return [
      "【玩家提交的完整推理】",
      String(guess || ""),
      "",
      "对照上面的汤底，判断玩家有没有把真相讲清楚：",
      "- 核心因果链讲对了 → solved",
      "- 摸到关键但还缺一层 → close",
      "- 方向不对 → no",
      "",
      "给玩家的短评不超过 40 字，不要补充玩家没说到的真相细节，不要剧透。",
      '只输出 JSON：{"level":"close","note":"你已经摸到关键了，再想想他是怎么活下来的。"}',
      "level 只能是 solved / close / no。"
    ].join("\n");
  }

  /* ---------------- 出口把关 ---------------- */

  function sanitize(text) {
    var s = String(text == null ? "" : text);
    /* 推理模型常把思考块一起吐出来：不剥掉会导致「判定词不在开头」判不过关，整句直接判掉线 */
    s = s.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, " ");
    s = s.replace(/```[a-zA-Z]*/g, "").replace(/```/g, "");
    s = s.replace(/\*\*/g, "").replace(/^[#>\s]+/, "");
    s = s.replace(/[\r\n]+/g, " ");
    s = s.replace(/\s{2,}/g, " ");
    s = s.replace(/^["'「『]+/, "").replace(/["'」』]+$/, "");
    return s.trim();
  }

  function leadKey(text) {
    /* 判定词后允许句号 / 逗号 / 顿号 / 冒号 / 破折号 / 分号，也允许「是！/ 不是！」这类语气收尾；
       但「是不是有人进过房间」这种反问仍然判不过关。 */
    var m = String(text || "").match(/^(与此无关|部分正确|不是|是)[。.，,、！!？?：:；;—－~～\s]/);
    if (!m) return "";
    for (var i = 0; i < VERDICTS.length; i++) {
      if (LEAD_OF[VERDICTS[i]] === m[1]) return VERDICTS[i];
    }
    return "";
  }

  /* 汤底原文泄漏检测：归一化后 ≥12 字连续重叠就判为剧透 */
  function truthOverlap(puzzle, text, minLen) {
    var t = E ? E.normalize(puzzle && puzzle.truth) : "";
    var n = E ? E.normalize(text) : "";
    if (!t || !n) return "";
    var L0 = Math.max(12, minLen || 12);
    for (var L = Math.max(L0, 14); L >= L0; L--) {
      for (var k = 0; k + L <= t.length; k++) {
        var seg = t.substr(k, L);
        if (n.indexOf(seg) !== -1) return seg;
      }
    }
    return "";
  }

  function guardAnswer(puzzle, ans) {
    if (!ans || typeof ans !== "object") return { ok: false, reason: "empty" };
    var reply = sanitize(ans.reply);
    if (!reply) return { ok: false, reason: "empty" };
    var v = String(ans.verdict || "").toLowerCase();
    if (VERDICTS.indexOf(v) === -1) return { ok: false, reason: "verdict" };
    if (reply.length > 160) return { ok: false, reason: "too-long" };
    var lk = leadKey(reply);
    if (!lk) return { ok: false, reason: "lead-missing" };
    if (lk !== v) return { ok: false, reason: "lead-mismatch" };

    /* 线索认领：越界直接拒；判定不一致时以题库记录为准重写开头 */
    var clues = (puzzle && puzzle.clues) || [];
    var ci = parseInt(ans.clue, 10);
    if (!isFinite(ci) || ci < 0) ci = 0;
    if (ci > clues.length) return { ok: false, reason: "clue-range" };
    if (ci > 0) {
      var ct = clues[ci - 1].type;
      if (VERDICTS.indexOf(ct) === -1) return { ok: false, reason: "clue-type" };
      if (ct !== v) {
        v = ct;
        var rest = sanitize(String(reply).replace(/^(与此无关|部分正确|不是|是)[。.，,、！!？?：:；;—－~～\s]*/, ""));
        reply = rest ? (LEAD_OF[ct] || "是") + "。" + rest : (LEAD_OF[ct] || "是") + "。";
      }
    }

    if (truthOverlap(puzzle, reply)) return { ok: false, reason: "spoiler-truth" };
    return { ok: true, verdict: v, reply: reply, clue: ci };
  }

  function guardGuess(puzzle, res) {
    if (!res || typeof res !== "object") return { ok: false, reason: "empty" };
    var level = String(res.level || "").toLowerCase();
    if (LEVELS.indexOf(level) === -1) return { ok: false, reason: "level" };
    var note = sanitize(res.note);
    if (!note) return { ok: false, reason: "empty" };
    if (note.length > 120) note = note.slice(0, 118) + "…";
    if (truthOverlap(puzzle, note)) return { ok: false, reason: "spoiler-truth" };
    return { ok: true, level: level, note: note };
  }

  /* ---------------- 解析模型输出 ---------------- */

  var VERDICT_ALIAS = {
    yes: "yes", y: "yes", "是": "yes", "对": "yes", "正确": "yes",
    no: "no", n: "no", "不是": "no", "否": "no", "不对": "no",
    partial: "partial", part: "partial", "部分正确": "partial", "部分": "partial",
    irr: "irr", irrelevant: "irr", unrelated: "irr", "与此无关": "irr", "无关": "irr"
  };

  /* 宽松解析：尾逗号 / 单引号都能救回来（有些中转会把 JSON 序列化坏） */
  function tryParseLoose(seg) {
    var t = String(seg || "");
    try { return JSON.parse(t); } catch (e) { /* 继续 */ }
    try { return JSON.parse(t.replace(/,\s*([}\]])/g, "$1")); } catch (e2) { /* 继续 */ }
    try { return JSON.parse(t.replace(/,\s*([}\]])/g, "$1").replace(/'/g, '"')); } catch (e3) { return null; }
  }

  /* 从「混着思考的整段回复」里挑出最像答案的那个顶层 JSON 对象。
     推理模型的正文可能全在 reasoning_content 里，前面还夹着一堆举例，
     所以按「像不像答案」打分，同分取最后一个。 */
  function pickAnswerObject(text) {
    var s = String(text || "");
    var stack = [];
    var segs = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (c === "{") { stack.push(i); }
      else if (c === "}") {
        if (stack.length) {
          var start = stack.pop();
          if (!stack.length) segs.push(s.slice(start, i + 1));
        }
      }
    }
    function score(o) {
      if (!o || typeof o !== "object") return 0;
      var n = 0;
      if (o.reply != null || o.note != null) n += 3;
      if (o.verdict != null || o.level != null) n += 2;
      if (o.clue != null) n += 1;
      return n;
    }
    var best = null, bestScore = 0;
    for (var j = 0; j < segs.length; j++) {
      var o = tryParseLoose(segs[j]);
      var sc = score(o);
      if (o && sc > 0 && sc >= bestScore) { best = o; bestScore = sc; }
    }
    return best;
  }

  function parseAnswer(raw) {
    if (raw == null) return null;
    var text = String(raw).trim();
    if (!text) return null;
    /* 先剥思考块，再去围栏；有些中转还会把 ``` 夹在句子中间 */
    text = text.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, " ").trim();
    text = text.replace(/^```[a-zA-Z]*\s*/, "").replace(/```\s*$/, "").trim();
    text = text.replace(/```[a-zA-Z]*/g, "").trim();

    var obj = pickAnswerObject(text);
    if (!obj) {
      var s = text.indexOf("{");
      var e = text.lastIndexOf("}");
      if (s !== -1 && e > s) obj = tryParseLoose(text.slice(s, e + 1));
    }
    if (obj && typeof obj === "object") {
      var reply = sanitize(obj.reply != null ? obj.reply : (obj.text != null ? obj.text : ""));
      var vRaw = String(obj.verdict == null ? "" : obj.verdict).trim().toLowerCase();
      var v = VERDICT_ALIAS[vRaw] || leadKey(reply);
      var ci = parseInt(obj.clue != null ? obj.clue : 0, 10);
      if (!isFinite(ci) || ci < 0) ci = 0;
      if (!reply) return null;
      return { verdict: v || "", reply: reply, clue: ci };
    }

    var plain = sanitize(text);
    if (!plain) return null;
    var lk = leadKey(plain);
    /* 纯文本模式下没有判定词，就等于没说清楚，交给上层当格式错误处理 */
    if (!lk) return null;
    return { verdict: lk, reply: plain, clue: 0 };
  }

  function parseGuess(raw) {
    if (raw == null) return null;
    var text = String(raw).trim();
    if (!text) return null;
    text = text.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, " ").trim();
    text = text.replace(/^```[a-zA-Z]*\s*/, "").replace(/```\s*$/, "").trim();
    text = text.replace(/```[a-zA-Z]*/g, "").trim();
    var obj = pickAnswerObject(text);
    if (!obj) {
      var s = text.indexOf("{");
      var e = text.lastIndexOf("}");
      if (s !== -1 && e > s) obj = tryParseLoose(text.slice(s, e + 1));
    }
    if (obj && typeof obj === "object") {
      var level = String(obj.level == null ? "" : obj.level).trim().toLowerCase();
      var note = sanitize(obj.note != null ? obj.note : (obj.reply != null ? obj.reply : ""));
      if (!note) return null;
      return { level: level, note: note };
    }
    var plain = sanitize(text);
    return plain ? { level: "", note: plain } : null;
  }

  /* ---------------- 网络层 ---------------- */

  function aiError(code, message) {
    var e = new Error(message || code);
    e.code = code;
    return e;
  }

  function describeError(err) {
    if (!err) return "未知错误";
    if (err.code === "not-configured") return "还没填好服务商或 Key";
    if (err.code === "unparsable") return "模型没按格式回答（要的是 JSON，模型回的不是；可在设置里换更听话的模型，如 deepseek-chat）";
    if (err.code === "empty-reply") return "模型回了空内容（多半是 maxTokens 太小被截断，或该模型把正文放在思考字段里）";
    if (err.code === "timeout") return "请求超时";
    if (err.code === "http") return err.message || "接口报错";
    if (err.code === "network") {
      var m = String(err.message || "");
      if (/failed to fetch|networkerror|load failed|fetch failed/i.test(m)) {
        return "浏览器连不上这个地址：多半是对方没开 CORS 跨域（面板里换 DeepSeek 等预设服务商，或自建代理），也可能是地址写错或断网";
      }
      return err.message || "网络请求失败";
    }
    if (err.code && String(err.code).indexOf("guarded:") === 0) {
      var why = String(err.code).slice(8);
      var map = {
        empty: "模型没给出回答",
        verdict: "判定词不合法",
        "too-long": "回答太长",
        "lead-missing": "判定词没放在开头",
        "lead-mismatch": "判定词和前三字对不上",
        "clue-range": "认领了不存在的线索",
        "clue-type": "线索判定非法",
        "spoiler-truth": "回答里带了汤底原文"
      };
      return "回答没通过把关（" + (map[why] || why) + "）";
    }
    return err.message || String(err);
  }

  function httpTransport(req) {
    if (typeof root.fetch !== "function") return Promise.reject(aiError("no-fetch", "浏览器不支持 fetch"));
    var ctrl = typeof root.AbortController === "function" ? new root.AbortController() : null;
    var done = false;
    var timer = setTimeout(function () {
      done = true;
      if (ctrl) { try { ctrl.abort(); } catch (e) { /* 忽略 */ } }
    }, req.timeoutMs || DEFAULTS.timeoutMs);

    return root.fetch(req.url, {
      method: "POST",
      headers: req.headers,
      body: JSON.stringify(req.body),
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
      return res.text().then(function (t) {
        clearTimeout(timer);
        return { status: res.status, text: t };
      });
    }, function (err) {
      clearTimeout(timer);
      if (done) throw aiError("timeout", "请求超时（" + Math.round((req.timeoutMs || DEFAULTS.timeoutMs) / 1000) + " 秒）");
      throw aiError("network", (err && err.message) || "网络请求失败");
    });
  }

  var transport = httpTransport;

  function setTransport(fn) {
    transport = typeof fn === "function" ? fn : httpTransport;
    return transport;
  }

  function buildRequest(cfg, system, user) {
    var base = cfg.baseUrl.replace(/\/+$/, "");
    if (cfg.kind === "anthropic") {
      return {
        url: base + "/messages",
        timeoutMs: cfg.timeoutMs,
        headers: {
          "content-type": "application/json",
          "x-api-key": cfg.apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true"
        },
        body: {
          model: cfg.model,
          max_tokens: cfg.maxTokens,
          temperature: cfg.temperature,
          system: system,
          messages: [{ role: "user", content: user }]
        }
      };
    }
    return {
      url: base + "/chat/completions",
      timeoutMs: cfg.timeoutMs,
      headers: {
        "content-type": "application/json",
        "authorization": "Bearer " + cfg.apiKey
      },
      body: {
        model: cfg.model,
        temperature: cfg.temperature,
        max_tokens: cfg.maxTokens,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ]
      }
    };
  }

  function extractText(cfg, res) {
    var json = null;
    try { json = JSON.parse(res.text); } catch (e) { json = null; }
    if (!json) return "";
    if (cfg.kind === "anthropic") {
      var blocks = json.content || [];
      var out = "";
      for (var i = 0; i < blocks.length; i++) {
        if (blocks[i] && typeof blocks[i].text === "string") out += blocks[i].text;
      }
      return out;
    }
    var ch = (json.choices || [])[0] || {};
    var msg = ch.message || {};
    if (typeof msg.content === "string" && msg.content.trim()) return msg.content;
    if (Array.isArray(msg.content)) {
      var s = "";
      for (var j = 0; j < msg.content.length; j++) {
        var seg = msg.content[j];
        if (seg && typeof seg.text === "string") s += seg.text;
        else if (typeof seg === "string") s += seg;
      }
      if (s.trim()) return s;
    }
    /* 推理模型（DeepSeek-R1 / Qwen 思考版等）：正文可能落在这些字段里，
       空 content 时宁可拿它们兜底，也比直接判「掉线」强 */
    if (typeof msg.reasoning_content === "string" && msg.reasoning_content.trim()) return msg.reasoning_content;
    if (typeof msg.reasoning === "string" && msg.reasoning.trim()) return msg.reasoning;
    if (typeof ch.text === "string" && ch.text.trim()) return ch.text;
    if (typeof json.output_text === "string" && json.output_text.trim()) return json.output_text;
    if (typeof json.output === "string" && json.output.trim()) return json.output;
    if (typeof json.response === "string" && json.response.trim()) return json.response;
    /* 有些中转把文字塞进 choices[].message.content 之外的自定义字段 */
    if (typeof json.text === "string" && json.text.trim()) return json.text;
    return "";
  }

  function shortBody(text) {
    var s = String(text || "").replace(/\s+/g, " ").trim();
    return s.length > 160 ? s.slice(0, 158) + "…" : s;
  }

  function callModel(cfg, system, user) {
    var req = buildRequest(cfg, system, user);
    return transport(req).then(function (res) {
      if (!res || res.status < 200 || res.status >= 300) {
        throw aiError("http", "接口返回 " + ((res && res.status) || "?") + (res && res.text ? "：" + shortBody(res.text) : ""));
      }
      var text = extractText(cfg, res);
      /* 把「结构里压根没有正文」和「有正文但内容为空」分开报，方便定位 */
      if (!text) throw aiError("empty-reply", "模型返回里没有可读正文（content 为空）");
      return text;
    });
  }

  /* ---------------- 对外接口 ---------------- */

  /* 模型偶尔不守规矩：格式错或没过把关时，带上更硬的提醒再要一次 */
  var RETRY_HINT = "\n\n【上次的回答不合规，请重新回答】必须严格只输出一个 JSON 对象，verdict 只能用 yes / no / partial / irr，reply 必须以对应的判定词开头（是。/ 不是。/ 部分正确。/ 与此无关。）。";

  function tryTwice(run) {
    return run(false).catch(function (err) {
      var c = String((err && err.code) || "");
      /* 空正文、格式不对、没过把关、一把超时，都值得再要一次；
         只有配置类错误（没填、HTTP 4xx）不重试 */
      var retryable = c === "unparsable" || c === "empty-reply" || c === "timeout" || c.indexOf("guarded:") === 0;
      if (!retryable) throw err;
      return run(true);
    });
  }

  function ask(puzzle, question, ctx) {
    var cfg = load();
    if (!isReady(cfg)) return Promise.reject(aiError("not-configured"));
    if (!puzzle) return Promise.reject(aiError("no-puzzle"));
    var sys = buildSystemPrompt(puzzle);
    var usr = buildAskUser(puzzle, question, ctx);
    return tryTwice(function (again) {
      return callModel(cfg, sys, again ? usr + RETRY_HINT : usr).then(function (raw) {
        var parsed = parseAnswer(raw);
        if (!parsed) throw aiError("unparsable", "模型没按格式回答");
        var g = guardAnswer(puzzle, parsed);
        if (!g.ok) throw aiError("guarded:" + g.reason, "回答没通过把关");
        return { verdict: g.verdict, reply: g.reply, clue: g.clue, source: "ai", model: cfg.model };
      });
    });
  }

  function judgeGuess(puzzle, guess) {
    var cfg = load();
    if (!isReady(cfg)) return Promise.reject(aiError("not-configured"));
    if (!puzzle) return Promise.reject(aiError("no-puzzle"));
    var sys = buildSystemPrompt(puzzle);
    var usr = buildGuessUser(puzzle, guess);
    return tryTwice(function (again) {
      return callModel(cfg, sys, again ? usr + RETRY_HINT : usr).then(function (raw) {
        var parsed = parseGuess(raw);
        if (!parsed) throw aiError("unparsable", "模型没按格式回答");
        var g = guardGuess(puzzle, parsed);
        if (!g.ok) throw aiError("guarded:" + g.reason, "判定没通过把关");
        return { level: g.level, note: g.note, source: "ai", model: cfg.model };
      });
    });
  }

  function test() {
    var cfg = load();
    if (!cfg.baseUrl || !cfg.model || !cfg.apiKey) {
      return Promise.resolve({ ok: false, message: "先填好接口地址、模型和 API Key" });
    }
    var sys = "你是一个连通性测试助手。只输出 JSON：{\"ok\":true}";
    var usr = "回一个 JSON：{\"ok\":true}";
    return callModel(cfg, sys, usr).then(function (raw) {
      var t = sanitize(raw).slice(0, 60);
      return { ok: true, message: "连上了（" + cfg.model + "）：" + (t || "（空回复）") };
    }, function (err) {
      return { ok: false, message: describeError(err) };
    });
  }

  var api = {
    PROVIDERS: PROVIDERS,
    DEFAULTS: DEFAULTS,
    STORE_KEY: STORE_KEY,
    defaults: defaults,
    clean: clean,
    providerOf: providerOf,
    load: load,
    save: save,
    config: config,
    setConfig: setConfig,
    isReady: isReady,
    onChange: onChange,
    maskKey: maskKey,
    buildSystemPrompt: buildSystemPrompt,
    buildAskUser: buildAskUser,
    buildGuessUser: buildGuessUser,
    sanitize: sanitize,
    leadKey: leadKey,
    truthOverlap: truthOverlap,
    guardAnswer: guardAnswer,
    guardGuess: guardGuess,
    parseAnswer: parseAnswer,
    parseGuess: parseGuess,
    buildRequest: buildRequest,
    extractText: extractText,
    describeError: describeError,
    ask: ask,
    judgeGuess: judgeGuess,
    test: test,
    __setTransport: setTransport,
    __resetTransport: function () { transport = httpTransport; }
  };

  root.SoupAI = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
