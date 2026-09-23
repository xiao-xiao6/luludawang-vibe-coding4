/* ============================================================
 * 深海汤屋 · 房间（Durable Object）
 * ------------------------------------------------------------
 * 一个实例 = 一个房间。持有：
 *   - 房间状态机 phase: lobby → playing → revealed
 *   - 玩家列表（UID 分配、internalId 去重、昵称、准备态、在线态）
 *   - 本局题目、问答历史 qaLog、猜底冷却
 *
 * 判定全部在服务端（engine.js）：汤底不下发前端。
 * 第一版用 HTTP 轮询（前端 1.2s 拉一次 /state）。
 * ============================================================ */

import {
  getPuzzle,
  publicPuzzle,
  ask as engineAsk,
  judgeGuess,
  stars,
  puzzleLayer
} from "./engine.js";
import {
  buildSystemPrompt,
  buildAskUser,
  buildJudgeSystem,
  buildJudgeUser,
  pickJson,
  looseAnswer,
  looseJudge,
  callModel,
  isLocalOnlyUrl,
  LOCAL_URL_HINT,
  GATEWAY_BLOCKED_HINT
} from "./ai.js";

const UID_MAX = 8;              /* 单房最多 8 人 */
const NICK_MAX = 12;            /* 昵称 ≤12 字 */
const TURN_TIMEOUT_MS = 90000;  /* 顺序提问 90s 超时跳过 */
const COOLDOWN_IRR_MS = 180000; /* 猜底 🔴无关 180s 冷却（只算在猜的人身上） */
const COOLDOWN_CLOSE_MS = 60000;/* 猜底 🟡部分正确 60s 冷却（只算在猜的人身上） */

/* ---- 联机手感参数 ---- */
const ONLINE_MS = 35000;         /* 在线窗口：原 15s 太紧，手机切一下消息就被判离线 */
const DEAD_SEAT_MS = 60000;      /* 死座位：离线超 1 分钟，房主可请离释放座位 */
const NICK_TAKEOVER_MS = 60000;  /* 同名接管：同名成员离线超 60s，同昵称重进即接管原座 */
const ASK_LOCK_MS = 90000;       /* AI 飞行锁：一次提问最长锁 90s，期间连点只算一次 */
const QA_MAX = 200;              /* 问答日志上限 */
const CHAT_MAX = 200;            /* 聊天日志上限 */
const CHAT_LEN = 120;            /* 单条聊天字数上限 */
const CHAT_GAP_MS = 600;         /* 同一人两条聊天最小间隔，防刷屏 */

function now() { return Date.now(); }

/* 把服务端错误翻译成前端能直接上屏的 code + 说明，
   不再把「配置错 / 格式错 / 网络抖」全部归成 AI_OFFLINE。 */
function aiErrorCode(e) {
  const m = String((e && e.message) || e || "");
  if (m === "LOCAL_ONLY_URL") return "AI_LOCAL_UNREACHABLE";
  if (m === "EMPTY_REPLY") return "AI_EMPTY_REPLY";
  if (m === "GATEWAY_BLOCKED") return "AI_GATEWAY_BLOCKED";
  if (/^HTTP_4\d\d/.test(m)) return "AI_AUTH_OR_MODEL";
  if (/^HTTP_5\d\d/.test(m)) return "AI_UPSTREAM_5XX";
  if (/abort|aborted|timeout/i.test(m)) return "AI_TIMEOUT";
  if (/fetch failed|network|ENOTFOUND|ECONNREFUSED/i.test(m)) return "AI_NETWORK";
  return "AI_OFFLINE";
}

/* 中转站自家 WAF 拦截（多④）：这不是「key 错 / 模型名错」，别让玩家误改配置。
   GATEWAY_BLOCKED_HINT 文案统一在 ./ai.js 里维护。 */

function aiErrorNote(e) {
  const code = aiErrorCode(e);
  const m = String((e && e.message) || e || "").replace(/\s+/g, " ").trim();
  const map = {
    AI_LOCAL_UNREACHABLE: LOCAL_URL_HINT,
    AI_EMPTY_REPLY: "模型返回里没有可读正文（可能是 maxTokens 太小被截断，或该模型把正文放进了思考字段）",
    AI_GATEWAY_BLOCKED: GATEWAY_BLOCKED_HINT,
    AI_AUTH_OR_MODEL: "上游报 4xx（" + m.slice(0, 100) + "）。检查地址/模型名/Key；若提示「来源被拦截/策略拦截」，是该中转站封了 Cloudflare 机房 IP：请用内网穿透（cloudflared / ngrok / frp）把本地净化中转发成公网地址，或换直连服务商",
    AI_UPSTREAM_5XX: "上游服务暂时出错，等一会儿再问一次（" + m.slice(0, 100) + "）",
    AI_TIMEOUT: "请求超时，上游太慢或网络不稳",
    AI_NETWORK: "机房那边连不上这个地址，检查接口地址是否写错",
    AI_OFFLINE: m.slice(0, 120)
  };
  return map[code] || m.slice(0, 120);
}

/* 模型不守格式时带上一句更强的重申再要一次；也接受明文判定 */
const RETRY_HINT =
  "\n\n【上次的回答没被读懂，请重新回答】优先输出一个 JSON 对象：{\"verdict\":\"yes|no|partial|irr\",\"reply\":\"…\",\"clue\":0}；实在做不到 JSON，就只回一句话，以「是。」「不是。」「部分正确。」「与此无关。」其中之一开头。";

function json(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign({
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }, cors || {})
  });
}

export class Room {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.state = null;
    /* 写盘刻度：只有状态真的变了才落盘 */
    this._dirty = false;
  }

  /* ---------------- 持久化 ---------------- */

  async load() {
    if (this.state) return this.state;
    this.state = (await this.ctx.storage.get("state")) || null;
    return this.state;
  }

  async save() {
    if (this.state) await this.ctx.storage.put("state", this.state);
    this._dirty = false;
  }

  /* 状态变更统一走这里：rev +1（增量轮询的游标），并标脏等待落盘 */
  bump() {
    const s = this.state;
    if (!s) return;
    s.rev = (s.rev || 0) + 1;
    this._dirty = true;
  }

  /* ---------------- 初始化 ---------------- */

  /* 建房：房主固定 #1，昵称必填 ≤12 字 */
  async create({ roomCode, internalId, nickname, solo }) {
    this.state = {
      roomCode,
      solo: !!solo,                 /* 单人模式：无轮序、无准备，选完汤直接开问 */
      phase: "lobby",              /* lobby | playing | revealed */
      hostUid: 1,
      nextUid: 1,
      order: [],                   /* 开局后随机固定的提问顺序（uid 数组） */
      turnIdx: 0,
      turnDeadline: 0,
      puzzleId: null,
      revealed: [],                /* 全员共享的已挖线索编号（规格 #2） */
      qaLog: [],
      guessCooldowns: {},          /* uid → 冷却到期时间戳：每人独立，互不影响 */
      lastGuess: null,
      ai: null,                    /* 房主配置的 AI（key 只在服务端，规格 #11） */
      pendingAI: null,             /* 汤主正在熬的那一句（全桌可见的「思考中」） */
      chatLog: [],                 /* 房间聊天 */
      chatSeq: 0,
      rev: 1,                      /* 增量轮询游标：变了才推全量快照 */
      players: [],
      createdAt: now(),
      updatedAt: now()
    };
    await this.addPlayer({ internalId, nickname, isHost: true });
    await this.save();
    return this.snapshot(internalId);
  }

  /* ---------------- 玩家 ---------------- */

  async addPlayer({ internalId, nickname, isHost }) {
    const s = this.state;
    if (!s) return { error: "NO_ROOM" };
    const id = String(internalId || "").trim();
    const nick = String(nickname || "").trim();

    if (!nick) return { error: "NICKNAME_REQUIRED" };
    if (nick.length > NICK_MAX) return { error: "NICKNAME_TOO_LONG" };

    /* 同一 internalId 重复进房 → 视为重连，不重复占位 */
    const exist = s.players.filter((p) => p.internalId === id)[0];
    if (exist) {
      exist.online = true;
      exist.lastSeen = now();
      if (nick && nick !== exist.nickname) exist.nickname = nick;
      this.bump();
      return { player: exist };
    }

    /* 同名接管：页面被系统回收导致 internalId 换新时，同昵称重进
       直接接管原本那张椅子，而不是新开一个 —— 否则旧座位会变成永远占线的死位。 */
    const sameNick = s.players.filter((p) => p.nickname === nick)[0];
    if (sameNick && now() - (sameNick.lastSeen || 0) > NICK_TAKEOVER_MS) {
      sameNick.internalId = id;
      sameNick.online = true;
      sameNick.lastSeen = now();
      this.bump();
      return { player: sameNick, takeover: true };
    }

    if (s.players.length >= UID_MAX) return { error: "ROOM_FULL" };

    const uid = s.nextUid++;
    const p = {
      uid,
      internalId: id,
      nickname: nick,
      isHost: !!isHost || uid === s.hostUid,
      ready: false,
      online: true,
      lastSeen: now()
    };
    s.players.push(p);
    this.bump();
    return { player: p };
  }

  /* 把一个人从房间里拿掉，并修正轮次。返回被请离的人。 */
  removePlayer(s, uid) {
    const target = s.players.filter((x) => x.uid === Number(uid))[0];
    if (!target) return null;
    const wasTurn = s.order.length && s.order[s.turnIdx] === target.uid;
    s.players = s.players.filter((x) => x.uid !== target.uid);
    s.order = s.order.filter((u) => u !== target.uid);
    if (s.guessCooldowns) delete s.guessCooldowns[target.uid];
    if (!s.order.length) {
      s.turnIdx = 0;
      s.turnDeadline = 0;
    } else {
      if (s.turnIdx >= s.order.length) s.turnIdx = 0;
      /* 被请离的人正好轮到自己：把倒计时交给下一位 */
      if (wasTurn && s.phase === "playing") {
        s.turnDeadline = s.solo ? 0 : now() + TURN_TIMEOUT_MS;
      }
    }
    return target;
  }

  /* 房主请人：任意在座玩家都能请离（房主自己除外）。
     离线超过 1 分钟的人走「死座位」通道，其余走普通请离。 */
  async kick({ internalId, uid }) {
    const s = this.state;
    const me = s.players.filter((x) => x.internalId === internalId)[0];
    if (!me || !me.isHost) return { error: "ONLY_HOST" };
    const target = s.players.filter((x) => x.uid === Number(uid))[0];
    if (!target) return { error: "NO_SUCH_PLAYER" };
    if (target.isHost) return { error: "CANNOT_KICK_HOST" };
    const idle = now() - (target.lastSeen || 0) >= DEAD_SEAT_MS;
    this.removePlayer(s, target.uid);
    s.qaLog.push({
      kind: "sys",
      text: idle
        ? target.nickname + " 的座位被房主收回了（离线太久）。"
        : target.nickname + " 被房主请离了房间。",
      at: now()
    });
    this.bump();
    return { ok: true, uid: target.uid };
  }

  async setNick({ internalId, nickname }) {
    const s = this.state;
    const nick = String(nickname || "").trim();
    if (!nick) return { error: "NICKNAME_REQUIRED" };
    if (nick.length > NICK_MAX) return { error: "NICKNAME_TOO_LONG" };
    const p = s.players.filter((x) => x.internalId === internalId)[0];
    if (!p) return { error: "NOT_IN_ROOM" };
    p.nickname = nick;
    this.bump();
    return { player: p };
  }

  async heartbeat({ internalId }) {
    const p = this.state.players.filter((x) => x.internalId === internalId)[0];
    if (p) { p.online = true; p.lastSeen = now(); }
    return { ok: true };
  }

  /* 点「离开房间」就立刻从全桌名单里消失，不再留下占座位的幽灵。
     房主离开时，把房主交给还在的最小号，房间不用重开。 */
  async leave({ internalId }) {
    const s = this.state;
    if (!s) return { ok: true };
    const p = s.players.filter((x) => x.internalId === internalId)[0];
    if (!p) return { ok: true };
    const wasHost = !!p.isHost;
    this.removePlayer(s, p.uid);
    if (wasHost && s.players.length) {
      const next = s.players.slice().sort((a, b) => a.uid - b.uid)[0];
      s.players.forEach((x) => { x.isHost = x.uid === next.uid; });
      s.hostUid = next.uid;
      s.qaLog.push({ kind: "sys", text: "房主离开了，#" + next.uid + " " + next.nickname + " 接过房主。", at: now() });
    } else {
      s.qaLog.push({ kind: "sys", text: p.nickname + " 离开了房间。", at: now() });
    }
    this.bump();
    return { ok: true };
  }

  /* ---------------- 房间聊天（新①：右下角常驻小聊天框） ----------------
   * 与「问答记录」分开：聊天只是玩家之间的闲聊，不占轮次、不喂 AI。 */
  async say({ internalId, text, clientId }) {
    const s = this.state;
    const p = s.players.filter((x) => x.internalId === internalId)[0];
    if (!p) return { error: "NOT_IN_ROOM" };
    const raw = String(text || "").replace(/\s+/g, " ").trim().slice(0, CHAT_LEN);
    if (!raw) return { error: "EMPTY_TEXT" };
    const cid = String(clientId || "").trim().slice(0, 48);
    /* 幂等：同一条（同 clientId）重复送达只入账一次，网络重试不会刷屏 */
    if (cid) {
      const dup = s.chatLog.filter((x) => x.clientId === cid)[0];
      if (dup) return { ok: true, item: dup, dup: true };
    }
    const last = s.chatLog.filter((x) => x.uid === p.uid).slice(-1)[0];
    if (last && now() - last.at < CHAT_GAP_MS) return { error: "TOO_FAST" };
    const item = {
      kind: "chat",
      uid: p.uid,
      nickname: p.nickname,
      text: raw,
      clientId: cid,
      at: now()
    };
    s.chatLog.push(item);
    if (s.chatLog.length > CHAT_MAX) s.chatLog = s.chatLog.slice(-CHAT_MAX);
    s.chatSeq = (s.chatSeq || 0) + 1;
    item.seq = s.chatSeq;
    this.bump();
    return { ok: true, item };
  }

  /* ---------------- AI 配置（只有房主 #1 能配，规格 #11） ---------------- */

  async setAi({ internalId, config }) {
    const s = this.state;
    const p = s.players.filter((x) => x.internalId === internalId)[0];
    if (!p || !p.isHost) return { error: "ONLY_HOST" };
    const c = config || {};
    if (c.clear) {
      s.ai = null;
      return { ok: true, ai: null };
    }
    const cfg = {
      provider: String(c.provider || "custom").slice(0, 32),
      kind: c.kind === "anthropic" ? "anthropic" : "openai",
      baseUrl: String(c.baseUrl || "").trim().replace(/\/+$/, ""),
      model: String(c.model || "").trim(),
      apiKey: String(c.apiKey || "").trim()
    };
    if (!cfg.baseUrl || !cfg.model || !cfg.apiKey) return { error: "AI_CONFIG_INCOMPLETE" };
    s.ai = cfg;
    this.bump();
    return { ok: true, ai: { provider: cfg.provider, model: cfg.model } };
  }

  /* AI 是否就绪：掉线时返回 false，调用方回退关键词判定 */
  aiReady() {
    const a = this.state.ai;
    return !!(a && a.baseUrl && a.model && a.apiKey);
  }

  /* 测试连接：房主填完配置先验一发，免得保存了才发现是错的。
     只用一条极简 ping，不消耗房间题目上下文；返回真实错误原因。 */
  async aiTest({ internalId, config }) {
    const s = this.state;
    const p = s.players.filter((x) => x.internalId === internalId)[0];
    if (!p || !p.isHost) return { error: "ONLY_HOST" };
    const c = config || {};
    const cfg = {
      provider: String(c.provider || "custom").slice(0, 32),
      kind: c.kind === "anthropic" ? "anthropic" : "openai",
      baseUrl: String(c.baseUrl || "").trim().replace(/\/+$/, ""),
      model: String(c.model || "").trim(),
      apiKey: String(c.apiKey || "").trim(),
      timeoutMs: 20000
    };
    if (!cfg.baseUrl || !cfg.model || !cfg.apiKey) return { error: "AI_CONFIG_INCOMPLETE" };
    /* 本机地址对 Cloudflare 机房永远不可达：不如提前拦住，把可操作的提示直接给房主 */
    if (isLocalOnlyUrl(cfg.baseUrl)) return { error: "AI_LOCAL_UNREACHABLE", note: LOCAL_URL_HINT };
    try {
      const text = await callModel(cfg,
        "你是海龟汤游戏的汤主。只输出一个 JSON 对象。",
        "回复 {\"ok\":true}，不要输出别的。");
      if (!text) return { error: "AI_TEST_EMPTY", note: "模型回了空内容" };
      return { ok: true, sample: String(text).slice(0, 80) };
    } catch (e) {
      const msg = String((e && e.message) || e);
      if (msg === "LOCAL_ONLY_URL") return { error: "AI_LOCAL_UNREACHABLE", note: LOCAL_URL_HINT };
      if (msg === "GATEWAY_BLOCKED") return { error: "AI_GATEWAY_BLOCKED", note: GATEWAY_BLOCKED_HINT };
      if (msg === "EMPTY_REPLY") return { error: "AI_TEST_EMPTY", note: "模型返回里没有可读正文（可能是 maxTokens 太小被截断，或该模型把正文放进了思考字段）" };
      return { error: "AI_TEST_FAIL", note: msg.slice(0, 160) };
    }
  }

  /* 问 AI：失败返回 { error, note }（上层不再一律报掉线） */
  async aiAsk(puzzle, question, history) {
    if (!this.aiReady()) return { error: "AI_OFFLINE", note: "房间还没有配置 AI 汤主" };
    const cfg = this.state.ai;
    const taken = this.state.revealed.map((i) => i + 1);
    const ctx = {
      revealed: this.state.revealed.map((i) => "第 " + (i + 1) + " 条"),
      taken: taken,
      history: (history || []).slice(-6)
    };
    /* 关键词结果只作内部参考，不上屏 */
    const hint = engineAsk(puzzle, question, this.state.revealed);
    if (hint.kind === "clue" || hint.kind === "again") {
      ctx.hintClue = { n: hint.index + 1, type: hint.verdict, text: hint.reply };
    }
    try {
      const sys = buildSystemPrompt(puzzle);
      const usr = buildAskUser(puzzle, question, ctx);
      let text = await callModel(cfg, sys, usr);
      let j = pickJson(text) || looseAnswer(text);
      if (!j) {
        /* 带上更强的格式重申再要一次，别一枪就判死 */
        text = await callModel(cfg, sys, usr + RETRY_HINT);
        j = pickJson(text) || looseAnswer(text);
      }
      if (!j) return { error: "AI_BAD_FORMAT", note: "汤主两次都没给出可认的判定（已自动重试过）；这个模型输出太自由，建议房主换 deepseek-chat 等更守格式的模型" };
      /* verdict 宽松归一：模型可能回英文、中文、甚至带句号 */
      var rawV = String(j.verdict || j.result || j.answer || "").trim().toLowerCase();
      var verdict = "irr";
      if (/^yes|^是/.test(rawV)) verdict = "yes";
      else if (/^no|^不是/.test(rawV)) verdict = "no";
      else if (/^partial|^部分/.test(rawV)) verdict = "partial";
      else if (/^irr|^无关|与此无关/.test(rawV)) verdict = "irr";
      else if (["yes","no","partial","irr"].indexOf(rawV) !== -1) verdict = rawV;
      /* reply 兜底：模型没给 reply 时按判定给一句标准话，绝不上屏 undefined */
      var reply = String(j.reply || j.text || "").slice(0, 120).trim();
      if (!reply) reply = { yes: "是。", no: "不是。", partial: "部分正确。", irr: "与此无关。" }[verdict];
      let clueNo = Number(j.clue) || 0;
      if (clueNo < 0 || clueNo > (puzzle.clues || []).length) clueNo = 0;
      return { verdict, reply, clue: clueNo };
    } catch (e) {
      return { error: aiErrorCode(e), note: aiErrorNote(e) };
    }
  }

  /* 判推理：失败返回 { error, note } */
  async aiJudge(puzzle, guess) {
    if (!this.aiReady()) return { error: "AI_OFFLINE", note: "房间还没有配置 AI 汤主" };
    const cfg = this.state.ai;
    try {
      const sys = buildJudgeSystem(puzzle);
      const usr = buildJudgeUser(puzzle, guess);
      let text = await callModel(cfg, sys, usr);
      let j = pickJson(text) || looseJudge(text);
      if (!j) {
        text = await callModel(cfg, sys, usr + "\n\n【上次的回答没被读懂，请重新回答】只输出一个 JSON 对象：{\"level\":\"solved|close|vague|no\",\"note\":\"…\"}。");
        j = pickJson(text) || looseJudge(text);
      }
      if (!j) return { error: "AI_BAD_FORMAT", note: "汤主两次都没给出可读的判定（已自动重试过）；建议房主换更守格式的模型" };
      /* level 宽松归一 */
      var rawL = String(j.level || j.result || "").trim().toLowerCase();
      var level = "no";
      if (/^solved|^对|^猜对|^说破/.test(rawL)) level = "solved";
      else if (/^close|^接近|^很近/.test(rawL)) level = "close";
      else if (/^vague|^模糊|^太短/.test(rawL)) level = "vague";
      else if (["solved","close","vague","no"].indexOf(rawL) !== -1) level = rawL;
      var note = String(j.note || j.reply || "").slice(0, 120).trim();
      if (!note) note = { solved: "说破了。", close: "已经很近了。", vague: "再讲清楚一点。", no: "方向还不对。" }[level];
      return { level, note };
    } catch (e) {
      return { error: aiErrorCode(e), note: aiErrorNote(e) };
    }
  }

  /* ---------------- 准备 & 开局 ---------------- */

  async setReady({ internalId, ready }) {
    const s = this.state;
    const p = s.players.filter((x) => x.internalId === internalId)[0];
    if (!p) return { error: "NOT_IN_ROOM" };

    /* 已开局后点「取消准备」→ 整桌掀回大堂，全员重新准备（公平不坑人） */
    if (s.phase === "playing" && !ready) {
      s.phase = "lobby";
      s.order = [];
      s.turnIdx = 0;
      s.turnDeadline = 0;
      s.qaLog.push({ kind: "sys", text: p.nickname + " 撤回了准备，本锅回到大堂。", at: now() });
      s.players.forEach((x) => { x.ready = false; });
      return { ok: true, phase: s.phase };
    }

    /* 一锅打到一半、或已经揭底时进来的人：不能插进正在进行的这锅，
       但可以先准备，等这锅结束（或房主开下一锅）时直接算进下一锅。 */
    if (s.phase !== "lobby") {
      if (!ready) { p.ready = false; this.bump(); return { ok: true, phase: s.phase, queued: false }; }
      p.ready = true;
      this.bump();
      return { ok: true, phase: s.phase, queued: true };
    }
    p.ready = !!ready;

    /* 全员准备 + 已选好汤 才开局；没选汤时不许开局，否则 60s 超时轰炸 */
    const allReady = s.players.length > 0 && s.players.every((x) => x.ready);
    if (allReady && s.puzzleId) {
      /* 系统随机固定顺序，开局（规格 #6） */
      s.order = shuffle(s.players.map((x) => x.uid));
      s.turnIdx = 0;
      s.turnDeadline = s.solo ? 0 : now() + TURN_TIMEOUT_MS;
      s.phase = "playing";
    }
    this.bump();
    return { ok: true, phase: s.phase };
  }

  /* 房主选汤（规格 #5：只有 #1 能选） */
  async choosePuzzle({ internalId, puzzleId }) {
    const s = this.state;
    const p = s.players.filter((x) => x.internalId === internalId)[0];
    if (!p || !p.isHost) return { error: "ONLY_HOST" };
    if (!getPuzzle(puzzleId)) return { error: "NO_SUCH_PUZZLE" };
    s.puzzleId = puzzleId;
    /* 单人：选完汤立刻可问，不需要「准备」这一环 */
    if (s.solo) {
      s.order = s.players.map((x) => x.uid);
      s.turnIdx = 0;
      s.turnDeadline = 0;
      s.phase = "playing";
    }
    this.bump();
    return { ok: true, phase: s.phase };
  }

  /* ---------------- 提示通道（仅单人，规格 #14：多人房无提示） ---------------- */

  async hint({ internalId }) {
    const s = this.state;
    if (!s.solo) return { error: "NO_HINT_MULTI" };
    const puzzle = getPuzzle(s.puzzleId);
    if (!puzzle) return { error: "NO_PUZZLE" };
    const clues = puzzle.clues || [];
    /* 按顺序给更深的一条，跳过已挖到的 */
    let pick = null;
    for (let i = 0; i < clues.length; i++) {
      if (s.revealed.indexOf(i) === -1) { pick = i; break; }
    }
    if (pick === null) return { error: "NO_MORE_CLUES" };
    s.revealed.push(pick);
    s.hintsUsed = (s.hintsUsed || 0) + 1;
    this.bump();
    const c = clues[pick];
    return {
      ok: true,
      clue: { n: pick + 1, type: c.type, text: String(c.text || "") },
      hintsUsed: s.hintsUsed
    };
  }

  /* ---------------- 提问通道（每 60s 超时跳过，规格 #7） ---------------- */

  async ask({ internalId, question }) {
    const s = this.state;
    if (s.phase !== "playing") return { error: "NOT_PLAYING" };
    this.sweepTurn();

    const p = s.players.filter((x) => x.internalId === internalId)[0];
    if (!p) return { error: "NOT_IN_ROOM" };
    const cur = s.order[s.turnIdx];
    if (p.uid !== cur) return { error: "NOT_YOUR_TURN", turnUid: cur };

    /* 飞行锁（多①）：AI 正在想上一句时，后面所有重复请求一律拒掉。
       前端按钮已经禁用了，这一层是防脚本/防手滑的硬保险：
       连点 N 次只会产生 1 次上游调用，Key 不会被白白烧掉。 */
    if (s.askInFlightUntil && now() < s.askInFlightUntil) {
      return { error: "AI_BUSY", note: "上一句汤主还在熬，等它答完再问。", until: s.askInFlightUntil };
    }

    const puzzle = getPuzzle(s.puzzleId);
    const raw = String(question || "").slice(0, 200);
    if (!raw.trim()) return { error: "EMPTY_QUESTION" };

    let verdict = "irr";
    let reply = "与此无关。";
    let clueNo = 0;
    let viaAi = false;

    if (puzzle) {
      /* 规格 #11/#12：只走 AI；AI 没配或掉线 → 提示重问，不记账、不消耗回合 */
      if (this.aiReady()) {
        /* 上锁 + 全桌广播「思考中」 */
        s.askInFlightUntil = now() + ASK_LOCK_MS;
        s.pendingAI = { uid: p.uid, nickname: p.nickname, question: raw, at: now() };
        this.bump();
        try {
          const ai = await this.aiAsk(puzzle, raw, s.qaLog.filter((x) => x.kind === "ask").map((x) => ({ q: x.question, a: x.reply })));
          if (!ai || ai.error) {
            s.askInFlightUntil = 0;
            s.pendingAI = null;
            this.bump();
            return { error: (ai && ai.error) || "AI_OFFLINE", note: (ai && ai.note) || "" };
          }
          verdict = ai.verdict;
          reply = ai.reply;
          clueNo = ai.clue;
          if (clueNo > 0 && s.revealed.indexOf(clueNo - 1) === -1) s.revealed.push(clueNo - 1);
          viaAi = true;
        } finally {
          s.askInFlightUntil = 0;
          s.pendingAI = null;
        }
      } else if (puzzleLayer(s.puzzleId) === "lib") {
        /* 库层没有预设线索/关键词，关键词判定会瞎猜 → 必须房主先配 AI */
        return { error: "AI_REQUIRED_LIB" };
      } else {
        /* 未配 AI：精品层保留关键词汤主（规格 #14） */
        const res = engineAsk(puzzle, raw, s.revealed);
        verdict = res.kind === "empty" ? "irr" : (res.verdict || "irr");
        reply = (res.flavor ? res.flavor + " " : "") + String(res.reply || "与此无关。");
        if (res.kind === "clue" && typeof res.index === "number") {
          clueNo = res.index + 1;
          if (s.revealed.indexOf(res.index) === -1) s.revealed.push(res.index);
        } else if (res.kind === "again" && typeof res.index === "number") {
          clueNo = res.index + 1;
        }
      }
    }

    const item = {
      kind: "ask",
      uid: p.uid,
      nickname: p.nickname,
      question: raw,
      verdict,
      reply,
      clue: clueNo,
      viaAi,
      at: now()
    };
    s.qaLog.push(item);
    if (s.qaLog.length > QA_MAX) s.qaLog = s.qaLog.slice(-QA_MAX);
    this.advanceTurn();
    this.bump();
    return { ok: true, item, rev: s.rev };
  }

  advanceTurn() {
    const s = this.state;
    s.turnIdx = (s.turnIdx + 1) % Math.max(1, s.order.length);
    /* 单人：只有一个玩家，不设超时（否则会自己把自己跳过） */
    s.turnDeadline = s.solo ? 0 : now() + TURN_TIMEOUT_MS;
    this.bump();
  }

  sweepTurn() {
    const s = this.state;
    /* 没选汤 / 没在玩的局，不 sweep，否则空房间也会每 60s 弹「超时跳过」 */
    if (s.phase === "playing" && s.puzzleId && s.turnDeadline && now() > s.turnDeadline) {
      s.qaLog.push({
        kind: "timeout",
        uid: s.order[s.turnIdx],
        nickname: "",
        at: now(),
        reply: "超时，跳过"
      });
      this.advanceTurn();
    }
  }

  /* ---------------- 猜底通道（规格 #8） ---------------- */

  async guess({ internalId, text }) {
    const s = this.state;
    if (s.phase !== "playing") return { error: "NOT_PLAYING" };
    const p = s.players.filter((x) => x.internalId === internalId)[0];
    if (!p) return { error: "NOT_IN_ROOM" };
    /* 冷却只算在猜的人身上，别人不受影响 */
    if (!s.guessCooldowns) s.guessCooldowns = {};
    const until = s.guessCooldowns[p.uid] || 0;
    if (now() < until) {
      return { error: "COOLDOWN", until };
    }

    const puzzle = getPuzzle(s.puzzleId);
    const raw = String(text || "").slice(0, 500);
    if (!raw.trim()) return { error: "EMPTY_GUESS" };

    let level = "no";
    let note = "方向还不对。";
    let viaAi = false;

    if (puzzle) {
      if (this.aiReady()) {
        const ai = await this.aiJudge(puzzle, raw);
        if (!ai || ai.error) return { error: (ai && ai.error) || "AI_OFFLINE", note: (ai && ai.note) || "" };
        level = ai.level;
        note = ai.note;
        viaAi = true;
      } else if (puzzleLayer(s.puzzleId) === "lib") {
        return { error: "AI_REQUIRED_LIB" };
      } else {
        const j = judgeGuess(puzzle, raw);
        level = j.level;
        note = j.note;
      }
    }

    const item = {
      kind: "guess",
      uid: p.uid,
      nickname: p.nickname,
      text: raw,
      level,
      reply: note,
      viaAi,
      at: now()
    };
    s.qaLog.push(item);
    if (s.qaLog.length > QA_MAX) s.qaLog = s.qaLog.slice(-QA_MAX);
    s.lastGuess = { uid: p.uid, nickname: p.nickname, level, note, at: item.at };
    this.settleGuess(level, s, puzzle, p);
    this.bump();
    return { ok: true, item, level, note };
  }

  /* 结算：🔴/🟡 只给猜的人设冷却，🟢 揭汤底结束本锅 */
  settleGuess(level, s, puzzle, player) {
    if (!s.guessCooldowns) s.guessCooldowns = {};
    if (level === "no" || level === "vague") {
      s.guessCooldowns[player.uid] = now() + (level === "no" ? COOLDOWN_IRR_MS : COOLDOWN_CLOSE_MS);
    } else if (level === "close") {
      s.guessCooldowns[player.uid] = now() + COOLDOWN_CLOSE_MS;
    } else if (level === "solved") {
      s.phase = "revealed";
      s.guessCooldowns = {};
      s.winnerUid = player.uid;
      s.winnerNick = player.nickname;
      s.stars = puzzle ? stars(puzzle, s.qaLog.filter((x) => x.kind === "ask").length, 0) : 1;
    }
  }

  /* 下一锅：房间不散，全员重新准备（规格 #15） */
  async nextPuzzle({ internalId, puzzleId }) {
    const s = this.state;
    const p = s.players.filter((x) => x.internalId === internalId)[0];
    if (!p || !p.isHost) return { error: "ONLY_HOST" };
    s.phase = "lobby";
    s.puzzleId = puzzleId || null;
    s.qaLog = [];
    s.revealed = [];
    s.order = [];
    s.turnIdx = 0;
    s.turnDeadline = 0;
    s.guessCooldowns = {};
    s.lastGuess = null;
    s.winnerUid = 0;
    s.winnerNick = "";
    s.stars = 0;
    s.pendingAI = null;
    s.askInFlightUntil = 0;
    /* 这锅还在打时已经点过准备的人，下一锅直接算准备好；其余人重新准备。
       全员都准备好了就直接开下一锅，不用再干等。 */
    const queued = s.players.filter((x) => x.ready).map((x) => x.uid);
    if (queued.length && queued.length === s.players.length && s.puzzleId) {
      s.order = shuffle(queued.slice());
      s.turnIdx = 0;
      s.turnDeadline = s.solo ? 0 : now() + TURN_TIMEOUT_MS;
      s.phase = "playing";
    }
    this.bump();
    return { ok: true, phase: s.phase };
  }

  /* ---------------- 快照 & 路由 ---------------- */

  snapshot(meId) {
    const s = this.state;
    if (!s) return { exists: false };
    this.sweepTurn();
    /* 轮询即心跳：谁在拉快照，就把谁标回在线（前端 1.5s 一次 << 在线窗口） */
    const you = meId ? s.players.filter((p) => p.internalId === meId)[0] : null;
    if (you && (!you.online || now() - (you.lastSeen || 0) > 5000)) {
      you.online = true;
      you.lastSeen = now();
    }
    const out = {
      exists: true,
      rev: s.rev || 0,
      roomCode: s.roomCode,
      solo: !!s.solo,
      youUid: you ? you.uid : 0,
      phase: s.phase,
      hostUid: s.hostUid,
      order: s.order,
      turnIdx: s.turnIdx,
      turnUid: s.order.length ? s.order[s.turnIdx] : null,
      turnDeadline: s.turnDeadline,
      puzzleId: s.puzzleId,
      puzzle: s.puzzleId ? publicPuzzle(s.puzzleId) : null,
      revealed: s.revealed.slice(),
      /* 已解锁线索的文字：这些内容早已在问答里念给全场，不算泄露；
         未解锁的线索依旧只在服务端（规格 #12 汤底不下发） */
      revealedClues: s.revealed.map((i) => {
        const full = s.puzzleId ? getPuzzle(s.puzzleId) : null;
        const c = full && full.clues ? full.clues[i] : null;
        return { n: i + 1, type: c ? c.type : "irr", text: c ? String(c.text || "") : "" };
      }),
      clueTotal: s.puzzleId && getPuzzle(s.puzzleId) ? getPuzzle(s.puzzleId).clues.length : 0,
      /* 只下发「我自己」的冷却，别人的冷却不共享、也不泄露 */
      myGuessCooldownUntil: you && s.guessCooldowns ? (s.guessCooldowns[you.uid] || 0) : 0,
      lastGuess: s.lastGuess,
      /* 「汤主正在思考」：全桌可见，谁问的都一样，不在场的人也知道进度 */
      pendingAI: s.pendingAI ? {
        uid: s.pendingAI.uid,
        nickname: s.pendingAI.nickname,
        question: s.pendingAI.question,
        at: s.pendingAI.at
      } : null,
      ai: s.ai
        ? (you && you.isHost
            ? { provider: s.ai.provider, model: s.ai.model, baseUrl: s.ai.baseUrl, hasKey: !!s.ai.apiKey }
            /* 非房主只看到模型名；baseUrl 和 key 一样只留服务端（规格 #11/#12） */
            : { provider: s.ai.provider, model: s.ai.model })
        : null,
      winnerUid: s.winnerUid || 0,
      winnerNick: s.winnerNick || "",
      stars: s.stars || 0,
      qaLog: s.qaLog.slice(-QA_MAX),
      chatLog: (s.chatLog || []).slice(-CHAT_MAX),
      chatSeq: s.chatSeq || 0,
      players: s.players.map((p) => ({
        uid: p.uid,
        nickname: p.nickname,
        isHost: p.isHost,
        ready: p.ready,
        online: p.online && now() - (p.lastSeen || 0) < ONLINE_MS,
        /* 房主面板据此点亮「请离死座位」按钮 */
        seatRemovable: !p.isHost && now() - (p.lastSeen || 0) >= DEAD_SEAT_MS
      })),
      updatedAt: s.updatedAt
    };
    /* 汤底只在揭晓后下发 */
    if (s.phase === "revealed" && s.puzzleId) {
      const full = getPuzzle(s.puzzleId);
      out.truth = full ? full.truth : "";
    }
    return out;
  }

  async fetch(request) {
    await this.load();
    const url = new URL(request.url);
    const action = url.searchParams.get("action");
    let body = {};
    if (request.method === "POST") {
      try { body = await request.json(); } catch (e) { body = {}; }
    }
    /* 「我是谁」：轮询带 ?me=internalId，动作带 body.internalId */
    const meId = url.searchParams.get("me") || body.internalId || "";

    if (!this.state) {
      if (action === "create") {
        const out0 = await this.create(body);
        return json(out0, 200, this.cors());
      }
      return json({ exists: false }, 200, this.cors());
    }

    /* ---------- 增量轮询（新②）：rev 没变就只回一个极小的响应 ----------
     * 轮询频率可以放心提到 1.5s：绝大多数请求只有几十字节，
     * 对手感延时的贡献远小于整包快照的序列化 + 传输。
     * 只有真的有人提问 / 说话 / 状态变了，才回全量快照。
     */
    if (action === "state") {
      const since = Number(url.searchParams.get("since"));
      if (isFinite(since) && since > 0 && since === (this.state.rev || 0)) {
        /* 快路径也必须刷心跳：否则「一直没动作」的玩家会被误判离线。
           只更新 lastSeen，不动 rev，所以不会把别人也吵醒。 */
        const me = meId ? this.state.players.filter((p) => p.internalId === meId)[0] : null;
        if (me) { me.online = true; me.lastSeen = now(); }
        this.state.updatedAt = now();
        /* 兜底：若上一请求有未落盘的变更（中途抛错），这里顺手补写，避免丢失 */
        if (this._dirty) await this.save();
        return json({ exists: true, unchanged: true, rev: since }, 200, this.cors());
      }
      const out0 = this.snapshot(meId);
      this.state.updatedAt = now();
      if (this._dirty) await this.save();
      return json(out0, 200, this.cors());
    }

    let out;
    switch (action) {
      case "create":
        out = this.snapshot(meId);
        break;
      case "join":
        out = await this.addPlayer({ ...body, isHost: false });
        if (!out.error) out = this.snapshot(meId);
        break;
      case "set-nick":
        out = await this.setNick(body);
        break;
      case "heartbeat":
        out = await this.heartbeat(body);
        break;
      case "say":
        out = await this.say(body);
        break;
      case "kick":
        out = await this.kick(body);
        if (!out.error) out = this.snapshot(meId);
        break;
      case "leave":
        out = await this.leave(body);
        break;
      case "set-ai":
        out = await this.setAi(body);
        break;
      case "ai-test":
        out = await this.aiTest(body);
        break;
      case "ready":
        out = await this.setReady(body);
        if (!out.error) out = this.snapshot(meId);
        break;
      case "choose":
        out = await this.choosePuzzle(body);
        break;
      case "ask":
        out = await this.ask(body);
        break;
      case "hint":
        out = await this.hint(body);
        break;
      case "guess":
        out = await this.guess(body);
        if (!out.error) out = Object.assign({}, out, { snapshot: this.snapshot(meId) });
        break;
      case "next":
        out = await this.nextPuzzle(body);
        break;
      case "state":
        out = this.snapshot(meId);
        break;
      default:
        out = { error: "UNKNOWN_ACTION" };
    }

    this.state.updatedAt = now();
    /* 不脏不写：轮询和纯读动作不再反复把整个 state 写回存储 */
    if (this._dirty) await this.save();
    return json(out, out && out.error ? 400 : 200, this.cors());
  }

  cors() {
    return {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type"
    };
  }
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}
