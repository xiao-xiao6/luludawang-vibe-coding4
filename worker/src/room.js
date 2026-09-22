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
  callModel
} from "./ai.js";

const UID_MAX = 8;              /* 单房最多 8 人 */
const NICK_MAX = 12;            /* 昵称 ≤12 字 */
const TURN_TIMEOUT_MS = 60000;  /* 顺序提问 60s 超时跳过 */
const COOLDOWN_IRR_MS = 180000; /* 猜底 🔴无关 180s 冷却 */
const COOLDOWN_CLOSE_MS = 60000;/* 猜底 🟡部分正确 60s 冷却 */

function now() { return Date.now(); }

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
  }

  /* ---------------- 持久化 ---------------- */

  async load() {
    if (this.state) return this.state;
    this.state = (await this.ctx.storage.get("state")) || null;
    return this.state;
  }

  async save() {
    if (this.state) await this.ctx.storage.put("state", this.state);
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
      guessCooldownUntil: 0,
      lastGuess: null,
      ai: null,                    /* 房主配置的 AI（key 只在服务端，规格 #11） */
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
      return { player: exist };
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
    return { player: p };
  }

  async setNick({ internalId, nickname }) {
    const s = this.state;
    const nick = String(nickname || "").trim();
    if (!nick) return { error: "NICKNAME_REQUIRED" };
    if (nick.length > NICK_MAX) return { error: "NICKNAME_TOO_LONG" };
    const p = s.players.filter((x) => x.internalId === internalId)[0];
    if (!p) return { error: "NOT_IN_ROOM" };
    p.nickname = nick;
    return { player: p };
  }

  async heartbeat({ internalId }) {
    const p = this.state.players.filter((x) => x.internalId === internalId)[0];
    if (p) { p.online = true; p.lastSeen = now(); }
    return { ok: true };
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
      apiKey:[REDACTED] || "").trim(),
      timeoutMs: 20000
    };
    if (!cfg.baseUrl || !cfg.model || !cfg.apiKey) return { error: "AI_CONFIG_INCOMPLETE" };
    try {
      const text = await callModel(cfg,
        "你是海龟汤游戏的汤主。只输出一个 JSON 对象。",
        "回复 {\"ok\":true}，不要输出别的。");
      if (!text) return { error: "AI_TEST_EMPTY", note: "模型回了空内容" };
      return { ok: true, sample: String(text).slice(0, 80) };
    } catch (e) {
      return { error: "AI_TEST_FAIL", note: String((e && e.message) || e).slice(0, 120) };
    }
  }

  /* 问 AI：失败返回 null（=掉线），调用方负责「不记账、不消耗回合」 */
  async aiAsk(puzzle, question, history) {
    if (!this.aiReady()) return null;
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
      const text = await callModel(cfg, buildSystemPrompt(puzzle), buildAskUser(puzzle, question, ctx));
      const j = pickJson(text);
      if (!j) return null;
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
      return null;
    }
  }

  /* 判推理：失败返回 null */
  async aiJudge(puzzle, guess) {
    if (!this.aiReady()) return null;
    const cfg = this.state.ai;
    try {
      const text = await callModel(cfg, buildJudgeSystem(puzzle), buildJudgeUser(puzzle, guess));
      const j = pickJson(text);
      if (!j) return null;
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
      return null;
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

    if (s.phase !== "lobby") return { error: "NOT_IN_LOBBY" };
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
        const ai = await this.aiAsk(puzzle, raw, s.qaLog.filter((x) => x.kind === "ask").map((x) => ({ q: x.question, a: x.reply })));
        if (!ai) return { error: "AI_OFFLINE" };
        verdict = ai.verdict;
        reply = ai.reply;
        clueNo = ai.clue;
        if (clueNo > 0 && s.revealed.indexOf(clueNo - 1) === -1) s.revealed.push(clueNo - 1);
        viaAi = true;
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
    this.advanceTurn();
    return { ok: true, item };
  }

  advanceTurn() {
    const s = this.state;
    s.turnIdx = (s.turnIdx + 1) % Math.max(1, s.order.length);
    /* 单人：只有一个玩家，不设超时（否则会自己把自己跳过） */
    s.turnDeadline = s.solo ? 0 : now() + TURN_TIMEOUT_MS;
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
    if (now() < s.guessCooldownUntil) {
      return { error: "COOLDOWN", until: s.guessCooldownUntil };
    }
    const p = s.players.filter((x) => x.internalId === internalId)[0];
    if (!p) return { error: "NOT_IN_ROOM" };

    const puzzle = getPuzzle(s.puzzleId);
    const raw = String(text || "").slice(0, 500);
    if (!raw.trim()) return { error: "EMPTY_GUESS" };

    let level = "no";
    let note = "方向还不对。";
    let viaAi = false;

    if (puzzle) {
      if (this.aiReady()) {
        const ai = await this.aiJudge(puzzle, raw);
        if (!ai) return { error: "AI_OFFLINE" };
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
    s.lastGuess = { uid: p.uid, nickname: p.nickname, level, note, at: item.at };
    this.settleGuess(level, s, puzzle, p);
    return { ok: true, item, level, note };
  }

  /* 结算：🔴/🟡 设冷却，🟢 揭汤底结束本锅 */
  settleGuess(level, s, puzzle, player) {
    if (level === "no" || level === "vague") {
      s.guessCooldownUntil = now() + (level === "no" ? COOLDOWN_IRR_MS : COOLDOWN_CLOSE_MS);
    } else if (level === "close") {
      s.guessCooldownUntil = now() + COOLDOWN_CLOSE_MS;
    } else if (level === "solved") {
      s.phase = "revealed";
      s.guessCooldownUntil = 0;
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
    s.guessCooldownUntil = 0;
    s.lastGuess = null;
    s.winnerUid = 0;
    s.winnerNick = "";
    s.stars = 0;
    s.players.forEach((x) => { x.ready = false; });
    return { ok: true, phase: s.phase };
  }

  /* ---------------- 快照 & 路由 ---------------- */

  snapshot(meId) {
    const s = this.state;
    if (!s) return { exists: false };
    this.sweepTurn();
    /* 轮询即心跳：谁在拉快照，就把谁标回在线（前端 1.2s 一次 < 15s 阈值） */
    const you = meId ? s.players.filter((p) => p.internalId === meId)[0] : null;
    if (you) { you.online = true; you.lastSeen = now(); }
    const out = {
      exists: true,
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
      guessCooldownUntil: s.guessCooldownUntil,
      lastGuess: s.lastGuess,
      ai: s.ai ? { provider: s.ai.provider, model: s.ai.model } : null,
      winnerUid: s.winnerUid || 0,
      winnerNick: s.winnerNick || "",
      stars: s.stars || 0,
      qaLog: s.qaLog.slice(-200),
      players: s.players.map((p) => ({
        uid: p.uid,
        nickname: p.nickname,
        isHost: p.isHost,
        ready: p.ready,
        online: p.online && now() - p.lastSeen < 15000
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
    await this.save();
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
